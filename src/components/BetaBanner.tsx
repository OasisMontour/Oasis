import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

/**
 * Slim "this is a beta" strip at the top of every page.
 * Hidden in the lesson player: it owns the whole screen (fullscreen anti-cheat, 1366x768 Chromebooks).
 */
export function BetaBanner() {
  const { pathname, search } = useLocation()
  const { session } = useAuth()
  if (pathname.startsWith('/student/assignments/')) return null
  return (
    <div className="beta-banner" role="note">
      <span className="beta-pill">Beta</span>
      <span>Oasis is in beta, so expect a few rough edges.</span>
      {session && pathname !== '/report' && (
        <Link to={`/report?from=${encodeURIComponent(pathname + search)}`}>Report a bug</Link>
      )}
    </div>
  )
}
