// Supabase Edge Function: suggest questions for a lesson from its video's transcript. Logic lives in
// _shared/aiQuestions.ts; providers, caps and keys are shared with ai-grade (_shared/aiProviders.ts).
//
// Uses the same secrets as ai-grade (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN, GROQ_API_KEY, CEREBRAS_API_KEY,
// any you have). Optional: AI_QUESTIONS_PROVIDER_ORDER (else AI_PROVIDER_ORDER), <PROVIDER>_QUESTION_UNITS.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleAiQuestions, type GenClaim } from '../_shared/aiQuestions.ts'
import { providersFromEnv } from '../_shared/aiProviders.ts'

const env = (k: string) => Deno.env.get(k)?.trim() || undefined

const url = env('SUPABASE_URL')!
const anon = env('SUPABASE_ANON_KEY')!
// Service role is used ONLY for the refund and provider bookkeeping functions, which nobody else can call.
const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const asCaller = (authHeader: string) =>
  createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })

const providers = providersFromEnv(env, 'AI_QUESTIONS_PROVIDER_ORDER')

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
  const res = await handleAiQuestions(req, {
    fetch,
    providers,
    nonce: () => crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    now: () => Date.now(),
    random: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
    async getCaller(authHeader) {
      const c = asCaller(authHeader)
      const { data } = await c.auth.getUser()
      if (!data.user) return null
      const { data: isTeacher } = await c.rpc('is_teacher')
      return { id: data.user.id, isTeacher: isTeacher === true }
    },
    async claim(authHeader) {
      return must(await asCaller(authHeader).rpc('ai_claim_generation')) as GenClaim
    },
    async refund(teacherId) {
      must(await admin.rpc('ai_refund_generation', { p_teacher: teacherId }))
    },
    async providerTake(name, dailyCap, units) {
      return must(await admin.rpc('ai_provider_take', { p_provider: name, p_daily_cap: dailyCap, p_units: units })) === true
    },
    async providerFail(name, cooldownS, error) {
      must(await admin.rpc('ai_provider_fail', { p_provider: name, p_cooldown_s: cooldownS, p_error: error }))
    },
  })
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
  return res
})
