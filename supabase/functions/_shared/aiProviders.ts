// AI providers for the ai-grade and ai-draft Edge Functions (Deno only: reads Deno.env).
//
// Providers are tried in AI_PROVIDER_ORDER (default cloudflare,groq,cerebras). A provider with no key set is
// skipped. All three were picked because their API terms say they don't train on what you send and don't
// keep it by default (see docs/SETUP.md "AI grading"). Don't add a provider without checking that first:
// these are minors' answers and teachers' material. Never put a payment card on these accounts.
import type { Provider } from './aiGrader.ts'

export const env = (k: string) => Deno.env.get(k)?.trim() || undefined
export const cap = (k: string, d: number) => {
  const n = Number(env(k))
  return Number.isInteger(n) && n >= 0 ? n : d
}

// Daily caps default to well under each free tier, so we stop before the provider does.
//   Cloudflare Workers AI free: 10,000 neurons/day; a grade on gemma-4-26b is ~3-4 neurons.
//   Groq / Cerebras free: per-model request limits (Groq gpt-oss-120b: 1,000 requests/day).
const all: Record<string, Provider | null> = {
  cloudflare:
    env('CLOUDFLARE_ACCOUNT_ID') && env('CLOUDFLARE_AI_TOKEN')
      ? {
          name: 'cloudflare',
          url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env('CLOUDFLARE_ACCOUNT_ID')!)}/ai/v1/chat/completions`,
          key: env('CLOUDFLARE_AI_TOKEN')!,
          model: env('CLOUDFLARE_AI_MODEL') ?? '@cf/google/gemma-4-26b-a4b-it',
          dailyCap: cap('CLOUDFLARE_AI_DAILY_CAP', 2000),
        }
      : null,
  groq: env('GROQ_API_KEY')
    ? {
        name: 'groq',
        url: 'https://api.groq.com/openai/v1/chat/completions',
        key: env('GROQ_API_KEY')!,
        model: env('GROQ_MODEL') ?? 'openai/gpt-oss-120b',
        dailyCap: cap('GROQ_DAILY_CAP', 800),
        extra: { reasoning_effort: 'low' },
      }
    : null,
  cerebras: env('CEREBRAS_API_KEY')
    ? {
        name: 'cerebras',
        url: 'https://api.cerebras.ai/v1/chat/completions',
        key: env('CEREBRAS_API_KEY')!,
        model: env('CEREBRAS_MODEL') ?? 'gpt-oss-120b',
        dailyCap: cap('CEREBRAS_DAILY_CAP', 800),
        extra: { reasoning_effort: 'low' },
      }
    : null,
}
export const providers: Provider[] = (env('AI_PROVIDER_ORDER') ?? 'cloudflare,groq,cerebras')
  .split(',')
  .map((s) => all[s.trim()])
  .filter((p): p is Provider => !!p)

