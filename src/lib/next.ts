// Remembers where a signed-out user was headed (e.g. a Classroom link to /student/assignments/:id),
// across the Google sign-in round trip, which always comes back to the site root.

const KEY = 'oasis.next'

export function rememberNext(path: string | undefined | null): void {
  if (path) sessionStorage.setItem(KEY, path)
}

/** Where to send a freshly signed-in user. Only same-site paths inside their own area are honored. */
export function safeNext(next: string | null, role: 'teacher' | 'student'): string {
  const home = role === 'teacher' ? '/teacher' : '/student'
  if (!next || !next.startsWith(`${home}/`) || next.startsWith('//') || next.includes('\\')) return home
  return next
}

export function takeNext(role: 'teacher' | 'student'): string {
  const next = sessionStorage.getItem(KEY)
  sessionStorage.removeItem(KEY)
  return safeNext(next, role)
}
