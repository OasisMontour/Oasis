// Supabase Edge Function: AI question drafts for the lesson builder. Logic lives in _shared/aiDrafter.ts.
// Same providers and secrets as ai-grade (see _shared/aiProviders.ts). Caps and the on/off switch are in
// ai_settings (gen_enabled, gen_teacher_daily_cap, gen_global_monthly_cap; `enabled` stops all AI).
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleAiDraft, type GenClaim } from '../_shared/aiDrafter.ts'
import { env, providers } from '../_shared/aiProviders.ts'
import { corsFor, parseOrigins } from '../_shared/cors.ts'

const url = env('SUPABASE_URL')!
const anon = env('SUPABASE_ANON_KEY')!
// Service role is used ONLY for the refund and the per-provider budget functions.
const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const asCaller = (authHeader: string) =>
  createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })

const origins = parseOrigins(env('APP_ORIGIN'))

const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message)
  return r.data
}

Deno.serve(async (req) => {
  const cors = corsFor(origins, req.headers.get('Origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const res = await handleAiDraft(req, {
    fetch,
    providers,
    nonce: () => crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    async getCaller(authHeader) {
      const c = asCaller(authHeader)
      const { data } = await c.auth.getUser()
      if (!data.user) return null
      const { data: isTeacher } = await c.rpc('is_teacher')
      return { id: data.user.id, isTeacher: isTeacher === true }
    },
    async claim(authHeader) {
      return must(await asCaller(authHeader).rpc('ai_gen_claim')) as GenClaim
    },
    async refund(teacherId) {
      must(await admin.rpc('ai_gen_refund', { p_teacher: teacherId }))
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
