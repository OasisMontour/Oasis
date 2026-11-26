import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import { AccountError } from './AccountError'

// Hides the admin page from non-admins. This is UX only: every admin RPC checks the admins table itself.
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { loading, session, profile, isAdmin, profileError, adminError } = useAuth()
  const location = useLocation()
  if (loading) return <p className="muted center">Loading…</p>
  if (!session) return <Navigate to="/" replace state={{ from: location.pathname + location.search }} />
  // A failed check isn't a "no": don't bounce a real admin to their home page.
  if ((!profile && profileError) || adminError) return <AccountError />
  if (!profile) return <p className="muted center">Setting up your account… refresh in a moment.</p>
  if (!isAdmin) return <Navigate to={profile.role === 'teacher' ? '/teacher' : '/student'} replace />
  return <>{children}</>
}
