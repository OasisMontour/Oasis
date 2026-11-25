// The `classroom` Edge Function's logic, with every outside dependency injected so it can be unit tested.
//
// POST { action: 'claim_teacher', refresh_token } -> any signed-in user: asks Google whether this account teaches
//                                                  Classroom courses, lets the database decide the role
//                                                  (claim_teacher_for), and on success stores the token and syncs
// POST { action: 'connect', refresh_token } -> verifies + stores the teacher's Google refresh token, then syncs
// POST { action: 'sync' }                   -> imports Classroom courses + rosters with the stored token
// POST { action: 'disconnect' }             -> revokes the token at Google and deletes it
// POST { action: 'post', assignment_id }    -> posts an Oasis assignment to its Classroom course (idempotent)
// POST { action: 'push_grades', assignment_id } -> writes finished, fully graded students' scores to Classroom as draft + assigned grades
//                                               (teachers still press Return in Classroom for students to see them)
//
// Business errors (and Google refusals) come back as 200 { ok: false, error } so the browser can show a message.

import { CLASSROOM_SCOPES } from './scopes.ts'
import { decryptToken, encryptToken } from './tokenCrypto.ts'
import {
  createCoursework,
  fetchClassroomProfile,
  fetchClassroomRosters,
  fetchHostedDomain,
  findCourseworkByLink,
  GoogleApiError,
  InvalidGrantError,
  listCourseStudentIds,
  listSubmissions,
  refreshAccessToken,
  revokeToken,
  setSubmissionGrade,
  type ImportCourse,
} from './google.ts'

export type SyncResult = { created: number; updated: number; newly_enrolled: number; removed: number; skipped: string[]; hidden_emails?: number }

export type AssignmentToPost = { id: string; lessonTitle: string; courseId: string; dueAt: string | null; courseworkId: string | null }

export type GradesToPush = {
  courseId: string
  courseworkId: string | null
  /** ungraded = short answers the teacher hasn't marked yet. Those count as wrong in the score, so they're held back. */
  grades: { email: string; score: number; ungraded?: number }[]
}

/** What Google said about the account, passed to claim_teacher_for. The database decides; this never grants anything. */
export type TeacherEvidence = {
  google_email: string
  hosted_domain: string | null
  verified_teacher: boolean
  can_create_courses: boolean
  active_courses: number
  students: number
  course_names: string[]
}

export type ClaimResult =
  | { status: 'granted'; via?: string; reason?: string }
  | { status: 'pending'; reason: string }
  | { status: 'refused'; reason: string }

export type Deps = {
  fetch: typeof fetch
  env: { clientId: string; clientSecret: string; encKey: string; appOrigin: string }
  /** Resolves the caller from their Supabase JWT; null if not signed in. */
  getCaller(authHeader: string): Promise<{ id: string; email: string; isTeacher: boolean } | null>
  /** Calls claim_teacher_for with the service role. */
  claimTeacher(userId: string, evidence: TeacherEvidence): Promise<ClaimResult>
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

const hiddenEmails = (courses: ImportCourse[]) => courses.reduce((n, c) => n + (c.hidden_emails ?? 0), 0)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export async function handleClassroom(req: Request, d: Deps): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const auth = req.headers.get('Authorization') ?? ''
  const caller = auth ? await d.getCaller(auth) : null
  if (!caller) return json({ ok: false, error: 'not signed in' }, 401)

  let body: { action?: string; refresh_token?: string; assignment_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'bad request' }, 400)
  }
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'bad request' }, 400)
  // Signing up is the one thing a non-teacher can do here.
  if (!caller.isTeacher && body.action !== 'claim_teacher') return json({ ok: false, error: 'teachers only' }, 403)

  /** Fresh access token from a refresh token the browser just got from Google, with every Classroom scope. */
  const freshAccess = async (rt: unknown): Promise<{ token: string; scopes: string[] } | { res: Response }> => {
    if (!rt || typeof rt !== 'string' || rt.length > 2048) return { res: json({ ok: false, error: 'missing refresh token' }, 400) }
    let token
    try {
      token = await refreshAccessToken(d.fetch, d.env.clientId, d.env.clientSecret, rt)
    } catch (e) {
      if (e instanceof InvalidGrantError) return { res: json({ ok: false, error: 'reconnect' }) }
      throw e
    }
    const missing = CLASSROOM_SCOPES.filter((s) => !token.scopes.includes(s))
    if (missing.length) return { res: json({ ok: false, error: 'missing_scopes', missing }) }
    return { token: token.accessToken, scopes: token.scopes }
  }

  const sync = async (accessToken: string) => {
    const courses = await fetchClassroomRosters(d.fetch, accessToken)
    const result = await d.importClassroom(caller.id, courses)
    await d.markUsed(caller.id)
    return json({ ok: true, courses: courses.length, students: courses.reduce((n, c) => n + c.students.length, 0), hidden_emails: hiddenEmails(courses), ...result })
  }

  const decryptOrNull = async (enc: string): Promise<string | null> => {
    try {
      return await decryptToken(enc, d.env.encKey, caller.id)
    } catch {
      console.error('classroom: stored token failed to decrypt (TOKEN_ENCRYPTION_KEY changed?)')
      return null
    }
  }

  /** Access token from the stored refresh token, or a ready-made "reconnect"/"not_connected" response. */
  const storedAccess = async (): Promise<{ token: string } | { res: Response }> => {
    const enc = await d.loadToken(caller.id)
    if (!enc) return { res: json({ ok: false, error: 'not_connected' }) }
    const rt = await decryptOrNull(enc)
    if (rt === null) {
      // Key changed or row corrupted: unusable either way. Drop it so Connect works again.
      await d.deleteToken(caller.id)
      return { res: json({ ok: false, error: 'reconnect' }) }
    }
    try {
      const t = await refreshAccessToken(d.fetch, d.env.clientId, d.env.clientSecret, rt)
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
    if (body.action === 'claim_teacher') {
      const t = await freshAccess(body.refresh_token)
      if ('res' in t) return t.res
      const rt = body.refresh_token as string
      const [profile, hd, courses] = await Promise.all([
        fetchClassroomProfile(d.fetch, t.token),
        fetchHostedDomain(d.fetch, t.token),
        fetchClassroomRosters(d.fetch, t.token),
      ])
      const r = await d.claimTeacher(caller.id, {
        google_email: profile.email,
        hosted_domain: hd,
        verified_teacher: profile.verifiedTeacher,
        can_create_courses: profile.canCreateCourses,
        active_courses: courses.length,
        students: courses.reduce((n, c) => n + c.students.length, 0),
        course_names: courses.slice(0, 5).map((c) => [c.name, c.section].filter(Boolean).join(' · ')),
      })
      if (r.status === 'refused') {
        // Don't keep access we won't use. Not for wrong_account: that token is someone else's grant.
        if (r.reason !== 'wrong_account') await revokeToken(d.fetch, rt)
        return json({ ok: true, status: 'refused', reason: r.reason })
      }
      // Pending users keep an encrypted token so an admin's approval needs no second Google screen.
      await d.saveToken(caller.id, await encryptToken(rt, d.env.encKey, caller.id), t.scopes.join(' '))
      if (r.status === 'pending') return json({ ok: true, status: 'pending', reason: r.reason })
      // The role is already granted: an import problem must not read as a failed sign-up. The dashboard's
      // Sync button retries it.
      try {
        const result = await d.importClassroom(caller.id, courses)
        await d.markUsed(caller.id)
        return json({ ok: true, status: 'granted', via: r.via ?? null, courses: courses.length, students: courses.reduce((n, c) => n + c.students.length, 0), ...result })
      } catch (e) {
        console.error('claim_teacher: import failed after grant', e)
        return json({ ok: true, status: 'granted', via: r.via ?? null, courses: 0, students: 0, import_error: (e as Error).message })
      }
    }

    if (body.action === 'connect') {
      const t = await freshAccess(body.refresh_token)
      if ('res' in t) return t.res
      // Only the teacher's own Google account. Otherwise any teacher could import someone else's classes.
      const profile = await fetchClassroomProfile(d.fetch, t.token)
      if (profile.email !== caller.email.toLowerCase()) return json({ ok: false, error: 'wrong_account' })
      await d.saveToken(caller.id, await encryptToken(body.refresh_token as string, d.env.encKey, caller.id), t.scopes.join(' '))
      return await sync(t.token)
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
      if (!d.env.appOrigin) return json({ ok: false, error: 'not_configured' })
      const a = await storedAccess()
      if ('res' in a) return a.res
      const link = studentAssignmentUrl(d.env.appOrigin, asg.id)
      // A previous call may have created it and then lost the response (school Wi-Fi, timeout): reuse it
      // rather than give students two copies.
      const cwid =
        (await findCourseworkByLink(d.fetch, a.token, asg.courseId, link)) ??
        (await createCoursework(d.fetch, a.token, asg.courseId, {
          title: asg.lessonTitle,
          description: 'Video lesson in Oasis. Open the link, watch the whole video, and answer the questions as they come up.',
          link,
          // A retry after the due date would send Classroom a date in the past; post without one instead.
          dueAt: asg.dueAt && new Date(asg.dueAt).getTime() > Date.now() ? asg.dueAt : null,
        }))
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
      const needsGrading: string[] = []
      const failed: { email: string; error: string }[] = []
      const todo: { email: string; submissionId: string; grade: number }[] = []
      for (const { email, score, ungraded } of g.grades) {
        // An ungraded short answer counts as wrong until the teacher marks it, so sending now would put a
        // too-low grade in the Classroom gradebook. Hold it back and say who.
        if (ungraded) {
          needsGrading.push(email)
          continue
        }
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
      return json({ ok: true, pushed, not_in_classroom: notInClassroom, needs_grading: needsGrading, failed })
    }

    if (body.action === 'disconnect') {
      const enc = await d.loadToken(caller.id)
      if (enc) {
        const rt = await decryptOrNull(enc)
        if (rt) await revokeToken(d.fetch, rt).catch(() => undefined)
        await d.deleteToken(caller.id)
      }
      return json({ ok: true })
    }

    return json({ ok: false, error: 'unknown action' }, 400)
  } catch (e) {
    console.error('classroom function failed', e)
    // 200 so the browser gets the reason instead of supabase-js's generic "non-2xx status code".
    if (e instanceof GoogleApiError) return json({ ok: false, error: e.message, google_status: e.status, google_reason: e.reason })
    return json({ ok: false, error: (e as Error).message })
  }
}
