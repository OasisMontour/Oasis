// The `classroom` Edge Function's logic, with every outside dependency injected so it can be unit tested.
//
// POST { action: 'connect', refresh_token } -> verifies + stores the teacher's Google refresh token, then syncs
// POST { action: 'sync' }                   -> imports Classroom courses + rosters with the stored token
// POST { action: 'disconnect' }             -> revokes the token at Google and deletes it
// POST { action: 'post', assignment_id }    -> posts an Oasis assignment to its Classroom course (idempotent)
// POST { action: 'push_grades', assignment_id } -> writes finished students' scores to Classroom as draft + assigned grades
//                                               (teachers still press Return in Classroom for students to see them)
//
// Business errors come back as 200 { ok: false, error } so the browser can show a message.

import { CLASSROOM_SCOPES } from './scopes.ts'
import { decryptToken, encryptToken } from './tokenCrypto.ts'
import {
  createCoursework,
  fetchClassroomRosters,
  InvalidGrantError,
  listCourseStudentIds,
  listSubmissions,
  refreshAccessToken,
  revokeToken,
  setSubmissionGrade,
  type ImportCourse,
} from './google.ts'

export type SyncResult = { created: number; updated: number; newly_enrolled: number; removed: number; skipped: string[] }

export type AssignmentToPost = { id: string; lessonTitle: string; courseId: string; dueAt: string | null; courseworkId: string | null }

export type GradesToPush = { courseId: string; courseworkId: string | null; grades: { email: string; score: number }[] }

export type Deps = {
  fetch: typeof fetch
  env: { clientId: string; clientSecret: string; encKey: string; appOrigin: string }
  /** Resolves the caller from their Supabase JWT; null if not signed in. */
  getCaller(authHeader: string): Promise<{ id: string; isTeacher: boolean } | null>
  loadToken(userId: string): Promise<string | null>
  saveToken(userId: string, enc: string, scopes: string): Promise<void>
  deleteToken(userId: string): Promise<void>
  markUsed(userId: string): Promise<void>
  /**
   * Calls import_classroom_for with the service role. Only this function may write rosters, and only with
   * data it just fetched from Google using the teacher's own token, for the teacher id it verified.
   */
  importClassroom(teacherId: string, courses: ImportCourse[]): Promise<SyncResult>
  /** Read as the caller, so RLS guarantees it's their own assignment. null if not found/not theirs. */
  getAssignment(authHeader: string, assignmentId: string): Promise<AssignmentToPost | null>
  /** Read as the caller. null if not found/not theirs. Only finished attempts with a score. */
  getGradesToPush(authHeader: string, assignmentId: string): Promise<GradesToPush | null>
  /** Written as the caller. */
  setCourseworkId(authHeader: string, assignmentId: string, courseworkId: string): Promise<void>
}

/** Where a Classroom assignment sends students. The student player must serve this route. */
export const studentAssignmentUrl = (origin: string, assignmentId: string) => `${origin.replace(/\/$/, '')}/student/assignments/${assignmentId}`

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export async function handleClassroom(req: Request, d: Deps): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const auth = req.headers.get('Authorization') ?? ''
  const caller = auth ? await d.getCaller(auth) : null
  if (!caller) return json({ ok: false, error: 'not signed in' }, 401)
  if (!caller.isTeacher) return json({ ok: false, error: 'teachers only' }, 403)

  let body: { action?: string; refresh_token?: string; assignment_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'bad request' }, 400)
  }

  const sync = async (accessToken: string) => {
    const courses = await fetchClassroomRosters(d.fetch, accessToken)
    const result = await d.importClassroom(caller.id, courses)
    await d.markUsed(caller.id)
    return json({ ok: true, courses: courses.length, students: courses.reduce((n, c) => n + c.students.length, 0), ...result })
  }

  /** Access token from the stored refresh token, or a ready-made "reconnect"/"not_connected" response. */
  const storedAccess = async (): Promise<{ token: string } | { res: Response }> => {
    const enc = await d.loadToken(caller.id)
    if (!enc) return { res: json({ ok: false, error: 'not_connected' }) }
    try {
      const t = await refreshAccessToken(d.fetch, d.env.clientId, d.env.clientSecret, await decryptToken(enc, d.env.encKey, caller.id))
      return { token: t.accessToken }
    } catch (e) {
      if (e instanceof InvalidGrantError) {
        await d.deleteToken(caller.id)
        return { res: json({ ok: false, error: 'reconnect' }) }
      }
      throw e
    }
  }

  try {
    if (body.action === 'connect') {
      const rt = body.refresh_token
      if (!rt || typeof rt !== 'string' || rt.length > 2048) return json({ ok: false, error: 'missing refresh token' }, 400)
      let token
      try {
        token = await refreshAccessToken(d.fetch, d.env.clientId, d.env.clientSecret, rt)
      } catch (e) {
        if (e instanceof InvalidGrantError) return json({ ok: false, error: 'reconnect' })
        throw e
      }
      const missing = CLASSROOM_SCOPES.filter((s) => !token.scopes.includes(s))
      if (missing.length) return json({ ok: false, error: 'missing_scopes', missing })
      await d.saveToken(caller.id, await encryptToken(rt, d.env.encKey, caller.id), token.scopes.join(' '))
      return await sync(token.accessToken)
    }

    if (body.action === 'sync') {
      const a = await storedAccess()
      return 'res' in a ? a.res : await sync(a.token)
    }

    if (body.action === 'post') {
      const id = body.assignment_id
      if (!id || typeof id !== 'string') return json({ ok: false, error: 'missing assignment_id' }, 400)
      const asg = await d.getAssignment(auth, id)
      if (!asg) return json({ ok: false, error: 'not your assignment' }, 404)
      if (asg.courseworkId) return json({ ok: true, coursework_id: asg.courseworkId, already: true })
      const a = await storedAccess()
      if ('res' in a) return a.res
      const cwid = await createCoursework(d.fetch, a.token, asg.courseId, {
        title: asg.lessonTitle,
        description: 'Video lesson in Oasis. Open the link, watch the whole video, and answer the questions as they come up.',
        link: studentAssignmentUrl(d.env.appOrigin, asg.id),
        dueAt: asg.dueAt,
      })
      await d.setCourseworkId(auth, asg.id, cwid)
      await d.markUsed(caller.id)
      return json({ ok: true, coursework_id: cwid })
    }

    if (body.action === 'push_grades') {
      const id = body.assignment_id
      if (!id || typeof id !== 'string') return json({ ok: false, error: 'missing assignment_id' }, 400)
      const g = await d.getGradesToPush(auth, id)
      if (!g) return json({ ok: false, error: 'not your assignment' }, 404)
      if (!g.courseworkId) return json({ ok: false, error: 'not_posted' })
      const courseworkId = g.courseworkId
      const a = await storedAccess()
      if ('res' in a) return a.res
      const userIds = await listCourseStudentIds(d.fetch, a.token, g.courseId)
      const subByUser = new Map((await listSubmissions(d.fetch, a.token, g.courseId, courseworkId)).map((s) => [s.userId, s.id]))
      const notInClassroom: string[] = []
      const failed: { email: string; error: string }[] = []
      const todo: { email: string; submissionId: string; grade: number }[] = []
      for (const { email, score } of g.grades) {
        const userId = userIds.get(email.toLowerCase())
        const submissionId = userId ? subByUser.get(userId) : undefined
        if (!submissionId) notInClassroom.push(email)
        else todo.push({ email, submissionId, grade: Math.round(score * 10) / 10 })
      }
      let pushed = 0
      let next = 0
      const worker = async () => {
        while (next < todo.length) {
          const t = todo[next++]
          try {
            await setSubmissionGrade(d.fetch, a.token, g.courseId, courseworkId, t.submissionId, t.grade)
            pushed++
          } catch (e) {
            failed.push({ email: t.email, error: (e as Error).message })
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(5, todo.length) }, worker))
      await d.markUsed(caller.id)
      return json({ ok: true, pushed, not_in_classroom: notInClassroom, failed })
    }

    if (body.action === 'disconnect') {
      const enc = await d.loadToken(caller.id)
      if (enc) {
        await revokeToken(d.fetch, await decryptToken(enc, d.env.encKey, caller.id)).catch(() => undefined)
        await d.deleteToken(caller.id)
      }
      return json({ ok: true })
    }

    return json({ ok: false, error: 'unknown action' }, 400)
  } catch (e) {
    console.error('classroom function failed', e)
    return json({ ok: false, error: (e as Error).message }, 500)
  }
}
