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
