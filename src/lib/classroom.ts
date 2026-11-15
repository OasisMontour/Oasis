// Reads the teacher's Google Classroom courses and rosters in the browser, using the Google
// access token Supabase hands back right after the teacher grants Classroom access.
// The token is never sent to our database.

export const CLASSROOM_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
].join(' ')

export type ImportCourse = { id: string; name: string; section: string; students: { email: string; name: string }[] }

export class ClassroomAuthError extends Error {}

const API = 'https://classroom.googleapis.com/v1'

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401 || res.status === 403) throw new ClassroomAuthError('Google Classroom access expired or was not granted.')
  if (!res.ok) throw new Error(`Google Classroom returned ${res.status}.`)
  return res.json() as Promise<T>
}

async function all<T>(token: string, path: string, key: string): Promise<T[]> {
  const out: T[] = []
  let pageToken = ''
  for (let i = 0; i < 50; i++) {
    const sep = path.includes('?') ? '&' : '?'
    const page = await get<Record<string, unknown>>(token, `${path}${sep}pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`)
    out.push(...((page[key] as T[] | undefined) ?? []))
    pageToken = (page.nextPageToken as string | undefined) ?? ''
    if (!pageToken) break
  }
  return out
}

type GCourse = { id: string; name: string; section?: string }
type GStudent = { profile: { emailAddress?: string; name?: { fullName?: string } } }

/** Every active course the signed-in teacher teaches, with its students. */
export async function fetchClassroomRosters(token: string): Promise<ImportCourse[]> {
  const courses = await all<GCourse>(token, '/courses?teacherId=me&courseStates=ACTIVE', 'courses')
  return Promise.all(
    courses.map(async (c) => {
      const students = await all<GStudent>(token, `/courses/${encodeURIComponent(c.id)}/students`, 'students')
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
