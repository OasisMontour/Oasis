// Supabase Edge Function: Google Classroom connection + roster sync. Logic lives in _shared/classroomHandler.ts.
// Secrets (supabase secrets set ...): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY, APP_ORIGIN.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleClassroom, type ClaimResult, type RecheckTarget, type SyncResult } from '../_shared/classroomHandler.ts'
import { corsFor, parseOrigins } from '../_shared/cors.ts'

const url = Deno.env.get('SUPABASE_URL')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
// Service role is used ONLY for the google_tokens table, claim_teacher_for, roster_recheck_target and import_classroom_for (rosters must come from
// Google, so browsers can't call it). Everything else runs as the caller.
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const asCaller = (authHeader: string) =>
  createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })

const origins = parseOrigins(Deno.env.get('APP_ORIGIN'))

const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message)
  return r.data
}

Deno.serve(async (req) => {
  const cors = corsFor(origins, req.headers.get('Origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!origins[0]) {
    // Without it, Classroom links would point nowhere. Say so instead of crashing on the first post.
    console.error('classroom: APP_ORIGIN secret is not set')
    return new Response(JSON.stringify({ ok: false, error: 'Oasis server setup: APP_ORIGIN is not set.' }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  const res = await handleClassroom(req, {
    fetch,
    env: {
      clientId: Deno.env.get('GOOGLE_CLIENT_ID')!,
      clientSecret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      encKey: Deno.env.get('TOKEN_ENCRYPTION_KEY')!,
      appOrigin: origins[0],
    },
    async getCaller(authHeader) {
      const c = asCaller(authHeader)
      const { data } = await c.auth.getUser()
      if (!data.user) return null
      const { data: isTeacher } = await c.rpc('is_teacher')
      return { id: data.user.id, email: (data.user.email ?? '').toLowerCase(), isTeacher: isTeacher === true }
    },
    async claimTeacher(userId, evidence) {
      // Service role: the role grant is only callable from here, with evidence fetched from Google just now.
      return must(await admin.rpc('claim_teacher_for', { p_user: userId, p_ev: evidence })) as ClaimResult
    },
    async loadToken(userId) {
      const row = must(await admin.from('google_tokens').select('refresh_token_enc').eq('user_id', userId).maybeSingle())
      return row?.refresh_token_enc ?? null
    },
    async saveToken(userId, enc, scopes) {
      must(await admin.from('google_tokens').upsert({ user_id: userId, refresh_token_enc: enc, scopes, connected_at: new Date().toISOString() }))
    },
    async deleteToken(userId) {
      must(await admin.from('google_tokens').delete().eq('user_id', userId))
    },
    async markUsed(userId) {
      must(await admin.from('google_tokens').update({ last_used_at: new Date().toISOString() }).eq('user_id', userId))
    },
    async recheckTarget(studentId, assignmentId) {
      return must(await admin.rpc('roster_recheck_target', { p_student: studentId, p_assignment: assignmentId })) as RecheckTarget
    },
    async importClassroom(teacherId, courses) {
      return must(await admin.rpc('import_classroom_for', { p_teacher: teacherId, p_courses: courses })) as SyncResult
    },
    async getAssignment(authHeader, id) {
      const row = must(
        await asCaller(authHeader)
          .from('assignments')
          .select('id, due_at, instructions, google_coursework_id, lessons(title), classes(google_course_id, teacher_id)')
          .eq('id', id)
          .maybeSingle(),
      ) as null | {
        id: string
        due_at: string | null
        instructions: string
        google_coursework_id: string | null
        lessons: { title: string }
        classes: { google_course_id: string }
      }
      if (!row) return null
      return {
        id: row.id,
        lessonTitle: row.lessons.title,
        courseId: row.classes.google_course_id,
        dueAt: row.due_at,
        courseworkId: row.google_coursework_id,
        instructions: row.instructions,
      }
    },
    async getGradesToPush(authHeader, id) {
      // Scores aren't readable over REST (students would see their own); grades_to_push checks the caller teaches the class.
      const g = must(await asCaller(authHeader).rpc('grades_to_push', { p_assignment: id })) as null | {
        course_id: string
        coursework_id: string | null
        grades: { email: string; score: number; ungraded: number }[]
      }
      if (!g) return null
      return {
        courseId: g.course_id,
        courseworkId: g.coursework_id,
        grades: g.grades.map((x) => ({ email: x.email, score: Number(x.score), ungraded: Number(x.ungraded) })),
      }
    },
    async setCourseworkId(authHeader, id, cwid, status) {
      // Only if still empty, so a late duplicate call can't overwrite the id Classroom students already have.
      must(
        await asCaller(authHeader)
          .from('assignments')
          .update({ google_coursework_id: cwid, google_coursework_state: status.state, google_coursework_url: status.url })
          .eq('id', id)
          .is('google_coursework_id', null),
      )
    },
    async setCourseworkStatus(authHeader, id, status) {
      must(await asCaller(authHeader).from('assignments').update({ google_coursework_state: status.state, google_coursework_url: status.url }).eq('id', id))
    },
  })
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
  return res
})
