// Remembers where a signed-out user was headed (e.g. a Classroom link to /student/assignments/:id),
// across the Google sign-in round trip, which always comes back to the site root.

const KEY = 'oasis.next'

export function rememberNext(path: string | undefined | null): void {
  if (path) sessionStorage.setItem(KEY, path)
}

/**
 * Pages anyone signed in may be headed to. Their own route guards decide access (e.g. /admin checks the
 * admin list), so sign-in shouldn't throw these destinations away (audit #25).
 */
const SHARED = ['/admin', '/report', '/changelog']

/** Where to send a freshly signed-in user. Only same-site paths inside their own area or a shared page are honored. */
export function safeNext(next: string | null, role: 'teacher' | 'student'): string {
  const home = role === 'teacher' ? '/teacher' : '/student'
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return home
  const path = next.split(/[?#]/)[0]
  if (next.startsWith(`${home}/`)) return next
  if (SHARED.some((p) => path === p || path.startsWith(`${p}/`))) return next
  return home
}

export function takeNext(role: 'teacher' | 'student'): string {
  const next = sessionStorage.getItem(KEY)
  sessionStorage.removeItem(KEY)
  return safeNext(next, role)
}
