// CORS for the browser-facing Edge Functions.
// APP_ORIGIN may list several origins, comma-separated (e.g. the production URL and a second Vercel URL).
// The first one is where Classroom links point. Trailing slashes are ignored, since a typo there would
// otherwise make the browser block every call.

export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

export function corsFor(origins: string[], requestOrigin: string | null): Record<string, string> {
  const o = (requestOrigin ?? '').replace(/\/+$/, '')
  return {
    'Access-Control-Allow-Origin': origins.length === 0 ? '*' : origins.includes(o) ? o : origins[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}
