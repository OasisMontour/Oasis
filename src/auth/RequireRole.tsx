import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import { AccountError } from './AccountError'
import type { Role } from '../lib/supabase'

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { loading, session, profile, profileError } = useAuth()
  const location = useLocation()
  if (loading) return <p className="muted center">Loading…</p>
  // Keep the deep link (e.g. a Classroom assignment) so sign-in can send them back to it.
  if (!session) return <Navigate to="/" replace state={{ from: location.pathname + location.search + location.hash }} />
  if (!profile && profileError) return <AccountError />
  if (!profile) return <p className="muted center">Setting up your account… refresh in a moment.</p>
  if (profile.role !== role) return <Navigate to={profile.role === 'teacher' ? '/teacher' : '/student'} replace />
  return <>{children}</>
}

// Any signed-in user, whatever their role (bug reports, changelog).
export function RequireSignedIn({ children }: { children: ReactNode }) {
  const { loading, session, profile, profileError } = useAuth()
  const location = useLocation()
  if (loading) return <p className="muted center">Loading…</p>
  if (!session) return <Navigate to="/" replace state={{ from: location.pathname + location.search + location.hash }} />
  if (!profile && profileError) return <AccountError />
  if (!profile) return <p className="muted center">Setting up your account… refresh in a moment.</p>
  return <>{children}</>
}
