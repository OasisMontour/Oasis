// AI providers shared by the `ai-grade` and `ai-questions` Edge Functions: which ones exist, how to call one,
// and how long to park one after an error. No Deno or Supabase imports, so it's unit tested with vitest.
//
// Every provider here was picked because its API terms say it doesn't train on what we send and doesn't keep
// it (see docs/SETUP.md "AI grading"). Don't add one without checking that first.

export type Provider = {
  name: string
  url: string
  key: string
  model: string
  /** Units per UTC day we allow ourselves, set below the provider's free limit. One grade = 1 unit. */
  dailyCap: number
  /** Provider-specific request fields (e.g. reasoning_effort). */
  extra?: Record<string, unknown>
  /**
   * Units one question-generation call takes from dailyCap. Generating reads a whole transcript, so it costs
   * the provider many times what one grade does; charging it as 1 would let generation eat grading's budget.
   */
  questionUnits: number
}

/** NFKC, drop control / zero-width / bidi characters, collapse runs of blank lines. */
export function clean(text: string): string {
  return text
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex, no-misleading-character-class
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFB]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Seconds to park a provider after an error. 0 = just try the next one. */
export function cooldownFor(status: number, retryAfter: string | null): number {
  if (status === 429) {
    const s = Number(retryAfter)
    return Number.isFinite(s) && s > 0 ? Math.min(Math.ceil(s), 86400) : 600
  }
  if (status === 401 || status === 402 || status === 403) return 3600 // bad key, or free quota/billing wall
  if (status === 400 || status === 404 || status === 422) return 900 // misconfigured model/params; don't hammer
  // 413 (one request too big, e.g. a long transcript) says nothing about the next request: don't park.
  return 0 // 5xx, timeouts: transient
}

export type CallResult =
  | { ok: true; content: unknown }
  | { ok: false; cooldownS: number; error: string }

export type CallOptions = { fetch: typeof fetch; timeoutMs: number; maxTokens: number; temperature: number }

/** One chat-completions call (all three providers speak the OpenAI format). Never throws. */
export async function callProvider(p: Provider, messages: unknown, o: CallOptions): Promise<CallResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs)
  try {
    const res = await o.fetch(p.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...p.extra, model: p.model, messages, temperature: o.temperature, max_tokens: o.maxTokens, stream: false }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      return { ok: false, cooldownS: cooldownFor(res.status, res.headers.get('retry-after')), error: `HTTP ${res.status}` }
    }
    const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null
    return { ok: true, content: body?.choices?.[0]?.message?.content }
  } catch (e) {
    return { ok: false, cooldownS: 0, error: (e as Error).name === 'AbortError' ? 'timeout' : 'network error' }
  } finally {
    clearTimeout(timer)
  }
}

const intOr = (v: string | undefined, d: number) => {
  const n = Number(v)
  return v !== undefined && Number.isInteger(n) && n >= 0 ? n : d
}

/**
 * Providers that have keys set, in order. `orderKey` lets a function use its own order
 * (e.g. AI_QUESTIONS_PROVIDER_ORDER); it falls back to AI_PROVIDER_ORDER, then cloudflare,groq,cerebras.
 *
 * Daily caps default to well under each free tier, so we stop before the provider does.
 *   Cloudflare Workers AI free: 10,000 neurons/day; a grade on gemma-4-26b is ~3-4 neurons, generating questions
 *   from a transcript is roughly 40x that.
 *   Groq / Cerebras free: per-model request and token limits (Groq gpt-oss-120b: 1,000 requests/day, 200K tokens/day).
 */
export function providersFromEnv(get: (k: string) => string | undefined, orderKey = 'AI_PROVIDER_ORDER'): Provider[] {
  const env = (k: string) => get(k)?.trim() || undefined
  const all: Record<string, Provider | null> = {
    cloudflare:
      env('CLOUDFLARE_ACCOUNT_ID') && env('CLOUDFLARE_AI_TOKEN')
        ? {
            name: 'cloudflare',
            url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env('CLOUDFLARE_ACCOUNT_ID')!)}/ai/v1/chat/completions`,
            key: env('CLOUDFLARE_AI_TOKEN')!,
            model: env('CLOUDFLARE_AI_MODEL') ?? '@cf/google/gemma-4-26b-a4b-it',
            dailyCap: intOr(env('CLOUDFLARE_AI_DAILY_CAP'), 2000),
            questionUnits: intOr(env('CLOUDFLARE_QUESTION_UNITS'), 40),
          }
        : null,
    groq: env('GROQ_API_KEY')
      ? {
          name: 'groq',
          url: 'https://api.groq.com/openai/v1/chat/completions',
          key: env('GROQ_API_KEY')!,
          model: env('GROQ_MODEL') ?? 'openai/gpt-oss-120b',
          dailyCap: intOr(env('GROQ_DAILY_CAP'), 800),
          extra: { reasoning_effort: 'low' },
          questionUnits: intOr(env('GROQ_QUESTION_UNITS'), 15),
        }
      : null,
    cerebras: env('CEREBRAS_API_KEY')
      ? {
          name: 'cerebras',
          url: 'https://api.cerebras.ai/v1/chat/completions',
          key: env('CEREBRAS_API_KEY')!,
          model: env('CEREBRAS_MODEL') ?? 'gpt-oss-120b',
          dailyCap: intOr(env('CEREBRAS_DAILY_CAP'), 800),
          extra: { reasoning_effort: 'low' },
          questionUnits: intOr(env('CEREBRAS_QUESTION_UNITS'), 15),
        }
      : null,
  }
  const order = env(orderKey) ?? env('AI_PROVIDER_ORDER') ?? 'cloudflare,groq,cerebras'
  const seen = new Set<string>()
  return order
    .split(',')
    .map((s) => s.trim())
    .filter((s) => !seen.has(s) && seen.add(s))
    .map((s) => all[s])
    .filter((p): p is Provider => !!p)
}
