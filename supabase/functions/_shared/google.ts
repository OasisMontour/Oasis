// Google OAuth token refresh/revoke + Classroom roster reads. Plain fetch so it runs in Deno and Node tests.

export class InvalidGrantError extends Error {}

/** A Google API refusal, with Google's own status + message, so teachers (and we) can see why. */
export class GoogleApiError extends Error {
  constructor(
    public status: number,
    public reason: string,
    message: string,
  ) {
    super(message)
  }
}

async function googleError(res: Response, what: string): Promise<GoogleApiError> {
  const b = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } }
  const reason = b.error?.status ?? String(res.status)
  const msg = b.error?.message ? `: ${b.error.message.slice(0, 300)}` : ''
  return new GoogleApiError(res.status, reason, `Google Classroom refused ${what} (${res.status} ${reason})${msg}`)
}

/** GET with one or two retries on 429/503 (Classroom quotas), honoring Retry-After up to 5s. */
async function getWithRetry(f: typeof fetch, url: string, token: string, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await f(url, { headers: { Authorization: `Bearer ${token}` } })
    if ((res.status !== 429 && res.status !== 503) || i >= 2) return res
    const after = Number(res.headers.get('Retry-After'))
    await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 5) * 1000 : 1000 * (i + 1))
  }
}

/** Runs fn over items with at most `limit` in flight, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export async function refreshAccessToken(
  f: typeof fetch,
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; scopes: string[] }> {
  const res = await f('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  })
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; scope?: string; error?: string }
  // invalid_grant = revoked, expired, or the teacher changed their password. They need to reconnect.
  if (body.error === 'invalid_grant') throw new InvalidGrantError('Google access was revoked or expired')
  if (!res.ok || !body.access_token) throw new Error(`Google token refresh failed (${res.status} ${body.error ?? ''})`)
  return { accessToken: body.access_token, scopes: (body.scope ?? '').split(' ').filter(Boolean) }
}

export async function revokeToken(f: typeof fetch, token: string): Promise<void> {
  await f('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined) // best effort: we delete our copy either way
}

/** Who the Classroom token belongs to, and whether their school's Google admin verified them as a teacher. */
export async function fetchClassroomProfile(
  f: typeof fetch,
  token: string,
): Promise<{ email: string; verifiedTeacher: boolean; canCreateCourses: boolean }> {
  const res = await getWithRetry(f, 'https://classroom.googleapis.com/v1/userProfiles/me', token)
  if (!res.ok) throw await googleError(res, 'userProfiles/me')
  const p = (await res.json()) as { emailAddress?: string; verifiedTeacher?: boolean; permissions?: { permission?: string }[] }
  if (!p.emailAddress) throw new Error('Google Classroom did not return an email for this account')
  return {
    email: p.emailAddress.toLowerCase(),
    // Google: "always false if the user is not a member of a Google Workspace for Education domain".
    verifiedTeacher: p.verifiedTeacher === true,
    canCreateCourses: (p.permissions ?? []).some((x) => x.permission === 'CREATE_COURSE'),
  }
}

/**
 * The account's Workspace domain (OpenID `hd`), or null for a personal Google account. Uses the `email` scope
 * Supabase always asks for. If the call fails we return null, which only ever makes the account look *less* trusted.
 */
export async function fetchHostedDomain(f: typeof fetch, token: string): Promise<string | null> {
  try {
    const res = await f('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return null
    const u = (await res.json()) as { hd?: string }
    return typeof u.hd === 'string' && u.hd ? u.hd.toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * hidden_emails = students Google listed without an email (directory/contact-sharing settings). They can't be
 * matched to an Oasis account, and import_classroom_for won't unenroll anyone from a course that has them.
 */
export type ImportCourse = { id: string; name: string; section: string; students: { email: string; name: string }[]; hidden_emails: number }

/** import_classroom_for takes at most this many courses. */
export const MAX_COURSES = 100

const API = 'https://classroom.googleapis.com/v1'

async function getAll<T>(f: typeof fetch, token: string, path: string, key: string): Promise<T[]> {
  const out: T[] = []
  let pageToken = ''
  for (let i = 0; i < 50; i++) {
    const sep = path.includes('?') ? '&' : '?'
    const res = await getWithRetry(f, `${API}${path}${sep}pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, token)
    if (!res.ok) throw await googleError(res, path.split('?')[0])
    const page = (await res.json()) as Record<string, unknown>
    out.push(...((page[key] as T[] | undefined) ?? []))
    pageToken = (page.nextPageToken as string | undefined) ?? ''
    if (!pageToken) break
  }
  return out
}

type GCourse = { id: string; name: string; section?: string; updateTime?: string; creationTime?: string }
type GStudent = { profile: { emailAddress?: string; name?: { fullName?: string } } }

/**
 * The teacher's active courses with their students: the MAX_COURSES most recently updated (teachers rarely
 * archive, so veterans can have hundreds). Roster reads go 5 at a time to stay under Classroom's quotas.
 */
export async function fetchClassroomRosters(f: typeof fetch, token: string): Promise<ImportCourse[]> {
  const courses = (await getAll<GCourse>(f, token, '/courses?teacherId=me&courseStates=ACTIVE', 'courses'))
    .sort((a, b) => (b.updateTime ?? b.creationTime ?? '').localeCompare(a.updateTime ?? a.creationTime ?? ''))
    .slice(0, MAX_COURSES)
  return mapLimit(courses, 5, async (c) => {
    const students = await getAll<GStudent>(f, token, `/courses/${encodeURIComponent(c.id)}/students`, 'students')
    const withEmail = students.filter((s) => s.profile?.emailAddress)
    return {
      id: c.id,
      name: c.name,
      section: c.section ?? '',
      students: withEmail.map((s) => ({ email: s.profile.emailAddress!, name: s.profile.name?.fullName ?? '' })),
      hidden_emails: students.length - withEmail.length,
    }
  })
}

/**
 * Coursework in this course that already links to `link`, if any. Classroom has no idempotency key, so this is
 * how a retry after a lost response avoids posting the same assignment twice.
 */
export async function findCourseworkByLink(f: typeof fetch, token: string, courseId: string, link: string): Promise<string | null> {
  const cws = await getAll<{ id: string; materials?: { link?: { url?: string } }[] }>(
    f,
    token,
    `/courses/${encodeURIComponent(courseId)}/courseWork?courseWorkStates=PUBLISHED&courseWorkStates=DRAFT&orderBy=updateTime%20desc`,
    'courseWork',
  )
  return cws.find((c) => c.materials?.some((m) => m.link?.url === link))?.id ?? null
}

export type CourseworkInput = { title: string; description: string; link: string; dueAt: string | null }

/**
 * Posts an assignment to a Classroom course. Due dates go to Classroom in UTC, which is what its API wants.
 * maxPoints is 100 so grade sync can pass the Oasis score straight through.
 */
export async function createCoursework(f: typeof fetch, token: string, courseId: string, cw: CourseworkInput): Promise<string> {
  const body: Record<string, unknown> = {
    title: cw.title.slice(0, 3000),
    description: cw.description,
    materials: [{ link: { url: cw.link } }],
    workType: 'ASSIGNMENT',
    state: 'PUBLISHED',
    maxPoints: 100,
  }
  if (cw.dueAt) {
    const d = new Date(cw.dueAt)
    body.dueDate = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
    body.dueTime = { hours: d.getUTCHours(), minutes: d.getUTCMinutes() }
  }
  const res = await f(`https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/courseWork`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await googleError(res, 'the assignment')
  const out = (await res.json().catch(() => ({}))) as { id?: string }
  if (!out.id) throw new Error(`Google Classroom didn't return an id for the new assignment (${res.status})`)
  return out.id
}

type GStudentId = { userId: string; profile: { emailAddress?: string } }

/** Map of lowercased student email -> Classroom userId for a course. */
export async function listCourseStudentIds(f: typeof fetch, token: string, courseId: string): Promise<Map<string, string>> {
  const students = await getAll<GStudentId>(f, token, `/courses/${encodeURIComponent(courseId)}/students`, 'students')
  const out = new Map<string, string>()
  for (const s of students) if (s.profile?.emailAddress && s.userId) out.set(s.profile.emailAddress.toLowerCase(), s.userId)
  return out
}

/** Every student submission for a piece of coursework. */
export async function listSubmissions(f: typeof fetch, token: string, courseId: string, courseworkId: string): Promise<{ id: string; userId: string }[]> {
  const subs = await getAll<{ id: string; userId: string }>(
    f,
    token,
    `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseworkId)}/studentSubmissions`,
    'studentSubmissions',
  )
  return subs.map((s) => ({ id: s.id, userId: s.userId }))
}

/** Sets both the draft and assigned grade. Students only see it once the teacher presses Return in Classroom. */
export async function setSubmissionGrade(
  f: typeof fetch,
  token: string,
  courseId: string,
  courseworkId: string,
  submissionId: string,
  grade: number,
): Promise<void> {
  const url = `${API}/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseworkId)}/studentSubmissions/${encodeURIComponent(submissionId)}?updateMask=assignedGrade,draftGrade`
  const res = await f(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignedGrade: grade, draftGrade: grade }),
  })
  if (!res.ok) {
    const out = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(`Google Classroom refused the grade (${res.status}${out.error?.message ? `: ${out.error.message}` : ''})`)
  }
}
