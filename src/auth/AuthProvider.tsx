import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Profile } from '../lib/supabase'
import { CLASSROOM_SCOPES } from '../../supabase/functions/_shared/scopes.ts'

type AuthState = {
  loading: boolean
  session: Session | null
  profile: Profile | null
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  /** Teacher-only: re-run Google sign-in asking for Classroom access (stored server-side for syncing). */
  connectClassroom: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setProfile(null)
        setLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // The profile row is created by a database trigger on first sign-in.
  // Role comes from the teacher allowlist, never from the browser.
  useEffect(() => {
    if (!session) return
    let cancelled = false
    setLoading(true)
    supabase
      .from('profiles')
      .select('id, role, name, email')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('Could not load profile', error)
        setProfile((data as Profile) ?? null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  const signInWithGoogle = async () => {
    const hd = import.meta.env.VITE_GOOGLE_HOSTED_DOMAIN as string | undefined
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        // Basic scopes only. Classroom scopes are requested later, teacher-only, when they connect Classroom.
        queryParams: { prompt: 'select_account', ...(hd ? { hd } : {}) },
      },
    })
    if (error) throw error
  }

  const connectClassroom = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/teacher?classroom=1`,
        scopes: CLASSROOM_SCOPES.join(' '),
        // offline + consent: Google only returns a refresh token on a fresh consent.
        queryParams: { access_type: 'offline', prompt: 'consent', ...(profile?.email ? { login_hint: profile.email } : {}) },
      },
    })
    if (error) throw error
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ loading, session, profile, signInWithGoogle, signOut, connectClassroom }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
