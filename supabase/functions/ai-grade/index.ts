// Supabase Edge Function: AI grading of short answers. Logic lives in _shared/aiGrader.ts.
//
// Providers are tried in AI_PROVIDER_ORDER (default cloudflare,groq,cerebras). A provider with no key set is
// skipped. All three were picked because their API terms say they don't train on what you send and don't
// keep it by default (see docs/SETUP.md "AI grading"). Don't add a provider without checking that first:
// these are minors' answers.
//
// Secrets (supabase secrets set ...), all optional, at least one provider needed:
//   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN   [CLOUDFLARE_AI_MODEL, CLOUDFLARE_AI_DAILY_CAP]
//   GROQ_API_KEY                                 [GROQ_MODEL, GROQ_DAILY_CAP]
//   CEREBRAS_API_KEY                             [CEREBRAS_MODEL, CEREBRAS_DAILY_CAP]
//   AI_PROVIDER_ORDER, <PROVIDER>_QUESTION_UNITS (see _shared/aiProviders.ts)
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleAiGrade, type ClaimResult } from '../_shared/aiGrader.ts'
import { providersFromEnv } from '../_shared/aiProviders.ts'

const env = (k: string) => Deno.env.get(k)?.trim() || undefined

const url = env('SUPABASE_URL')!
const anon = env('SUPABASE_ANON_KEY')!
// Service role is used ONLY for the three ai_* bookkeeping functions, which nobody else can call.
const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const asCaller = (authHeader: string) =>
  createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })

// Caps and defaults are in _shared/aiProviders.ts.
const providers = providersFromEnv(env)

const cors = {
  'Access-Control-Allow-Origin': env('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message)
  return r.data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const res = await handleAiGrade(req, {
    fetch,
    providers,
    nonce: () => crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    now: () => Date.now(),
    async getCaller(authHeader) {
      const c = asCaller(authHeader)
      const { data } = await c.auth.getUser()
      if (!data.user) return null
      const { data: isTeacher } = await c.rpc('is_teacher')
      return { id: data.user.id, isTeacher: isTeacher === true }
    },
    async claim(authHeader, assignmentId, limit) {
      return must(await asCaller(authHeader).rpc('ai_claim_answers', { p_assignment: assignmentId, p_limit: limit })) as ClaimResult
    },
    async record(teacherId, item, outcome, correct, reason, model) {
      must(
        await admin.rpc('ai_record_grade', {
          p_teacher: teacherId,
          p_attempt: item.attempt_id,
          p_question: item.question_id,
          p_outcome: outcome,
          p_correct: correct,
          p_reason: reason,
          p_model: model,
        }),
      )
    },
    async providerTake(name, dailyCap) {
      return must(await admin.rpc('ai_provider_take', { p_provider: name, p_daily_cap: dailyCap })) === true
    },
    async providerFail(name, cooldownS, error) {
      must(await admin.rpc('ai_provider_fail', { p_provider: name, p_cooldown_s: cooldownS, p_error: error }))
    },
  })
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
  return res
})
