// Supabase Edge Function: Google Classroom connection + roster sync. Logic lives in _shared/classroomHandler.ts.
// Secrets (supabase secrets set ...): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleClassroom, type SyncResult } from '../_shared/classroomHandler.ts'

const url = Deno.env.get('SUPABASE_URL')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
// Service role is used ONLY for the google_tokens table and import_classroom_for (rosters must come from
// Google, so browsers can't call it). Everything else runs as the caller.
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const asCaller = (authHeader: string) =>
  createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message)
  return r.data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const res = await handleClassroom(req, {
    fetch,
    env: {
      clientId: Deno.env.get('GOOGLE_CLIENT_ID')!,
      clientSecret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      encKey: Deno.env.get('TOKEN_ENCRYPTION_KEY')!,
      appOrigin: Deno.env.get('APP_ORIGIN')!,
    },
    async getCaller(authHeader) {
      const c = asCaller(authHeader)
      const { data } = await c.auth.getUser()
      if (!data.user) return null
      const { data: isTeacher } = await c.rpc('is_teacher')
      return { id: data.user.id, isTeacher: isTeacher === true }
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
    async importClassroom(teacherId, courses) {
      return must(await admin.rpc('import_classroom_for', { p_teacher: teacherId, p_courses: courses })) as SyncResult
    },
    async getAssignment(authHeader, id) {
      const row = must(
        await asCaller(authHeader)
          .from('assignments')
          .select('id, due_at, google_coursework_id, lessons(title), classes(google_course_id, teacher_id)')
          .eq('id', id)
          .maybeSingle(),
      ) as null | { id: string; due_at: string | null; google_coursework_id: string | null; lessons: { title: string }; classes: { google_course_id: string } }
      if (!row) return null
      return { id: row.id, lessonTitle: row.lessons.title, courseId: row.classes.google_course_id, dueAt: row.due_at, courseworkId: row.google_coursework_id }
    },
    async getGradesToPush(authHeader, id) {
      const row = must(
        await asCaller(authHeader)
          .from('assignments')
          .select('id, google_coursework_id, classes(google_course_id), attempts(score, finished_at, profiles(email), answers(is_correct))')
          .eq('id', id)
          .maybeSingle(),
      ) as null | {
        google_coursework_id: string | null
        classes: { google_course_id: string }
        attempts: { score: number | null; finished_at: string | null; profiles: { email: string } | null; answers: { is_correct: boolean | null }[] }[]
      }
      if (!row) return null
      const grades = row.attempts.flatMap((a) =>
        a.finished_at && a.score !== null && a.profiles?.email
          ? [{ email: a.profiles.email, score: Number(a.score), ungraded: (a.answers ?? []).filter((x) => x.is_correct === null).length }]
          : [],
      )
      return { courseId: row.classes.google_course_id, courseworkId: row.google_coursework_id, grades }
    },
    async setCourseworkId(authHeader, id, cwid) {
      must(await asCaller(authHeader).from('assignments').update({ google_coursework_id: cwid }).eq('id', id))
    },
  })
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
  return res
})
