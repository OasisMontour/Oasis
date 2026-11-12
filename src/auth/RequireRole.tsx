import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import type { Role } from '../lib/supabase'

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { loading, session, profile } = useAuth()
  if (loading) return <p className="muted center">Loading…</p>
  if (!session) return <Navigate to="/" replace />
  if (!profile) return <p className="muted center">Setting up your account… refresh in a moment.</p>
  if (profile.role !== role) return <Navigate to={profile.role === 'teacher' ? '/teacher' : '/student'} replace />
  return <>{children}</>
}
