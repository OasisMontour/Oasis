import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'

// Hides the admin page from non-admins. This is UX only: every admin RPC checks the admins table itself.
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { loading, session, profile, isAdmin } = useAuth()
  const location = useLocation()
  if (loading) return <p className="muted center">Loading…</p>
  if (!session) return <Navigate to="/" replace state={{ from: location.pathname + location.search }} />
  if (!profile) return <p className="muted center">Setting up your account… refresh in a moment.</p>
  if (!isAdmin) return <Navigate to={profile.role === 'teacher' ? '/teacher' : '/student'} replace />
  return <>{children}</>
}
