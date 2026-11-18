// Google OAuth token refresh/revoke + Classroom roster reads. Plain fetch so it runs in Deno and Node tests.

export class InvalidGrantError extends Error {}

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

export type ImportCourse = { id: string; name: string; section: string; students: { email: string; name: string }[] }

const API = 'https://classroom.googleapis.com/v1'

async function getAll<T>(f: typeof fetch, token: string, path: string, key: string): Promise<T[]> {
  const out: T[] = []
  let pageToken = ''
  for (let i = 0; i < 50; i++) {
    const sep = path.includes('?') ? '&' : '?'
    const res = await f(`${API}${path}${sep}pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Google Classroom returned ${res.status} for ${path.split('?')[0]}`)
    const page = (await res.json()) as Record<string, unknown>
    out.push(...((page[key] as T[] | undefined) ?? []))
    pageToken = (page.nextPageToken as string | undefined) ?? ''
    if (!pageToken) break
  }
  return out
}

type GCourse = { id: string; name: string; section?: string }
type GStudent = { profile: { emailAddress?: string; name?: { fullName?: string } } }

/** Every active course the teacher teaches, with its students. */
export async function fetchClassroomRosters(f: typeof fetch, token: string): Promise<ImportCourse[]> {
  const courses = await getAll<GCourse>(f, token, '/courses?teacherId=me&courseStates=ACTIVE', 'courses')
  return Promise.all(
    courses.map(async (c) => {
      const students = await getAll<GStudent>(f, token, `/courses/${encodeURIComponent(c.id)}/students`, 'students')
      return {
        id: c.id,
        name: c.name,
        section: c.section ?? '',
        students: students
          .filter((s) => s.profile.emailAddress)
          .map((s) => ({ email: s.profile.emailAddress!, name: s.profile.name?.fullName ?? '' })),
      }
    }),
  )
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
  const out = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
  if (!res.ok || !out.id) throw new Error(`Google Classroom couldn't post the assignment (${res.status}${out.error?.message ? `: ${out.error.message}` : ''})`)
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
