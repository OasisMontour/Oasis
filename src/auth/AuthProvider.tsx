import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Profile } from '../lib/supabase'
import { startUsageTracking } from '../lib/usage'
import { CLASSROOM_SCOPES } from '../../supabase/functions/_shared/scopes.ts'

type AuthState = {
  loading: boolean
  session: Session | null
  profile: Profile | null
  /** UI hint only (shows the Admin link). Every admin RPC re-checks on the server. */
  isAdmin: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  /**
   * Re-run Google sign-in asking for Classroom access (stored server-side for syncing). Teachers use it to connect;
   * anyone uses it to sign up as a teacher (returnTo = '/teacher/signup'). Students are never sent here otherwise.
   */
  connectClassroom: (returnTo?: string) => Promise<void>
  /** Re-read the profile, e.g. after the server made this account a teacher. */
  refreshProfile: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [profileVersion, setProfileVersion] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setProfile(null)
        setIsAdmin(false)
        setLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // The profile row is created by a database trigger on first sign-in.
  // Role is decided in the database (allowlist, or claim_teacher_for via the classroom function), never by the browser.
  //
  // Keyed on the user id, not the session object: supabase-js hands us a new session object on every
  // token refresh (about hourly, and when a tab comes back after a while). Re-loading the profile on each
  // one flipped `loading`, which made RequireRole unmount the whole page and wiped unsaved work.
  const userId = session?.user.id ?? null
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      supabase.from('profiles').select('id, role, name, email').eq('id', userId).single(),
      supabase.rpc('is_admin'),
    ]).then(([p, a]) => {
      if (cancelled) return
      if (p.error) console.error('Could not load profile', p.error)
      setProfile((p.data as Profile) ?? null)
      setIsAdmin(a.data === true)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [userId, profileVersion])

  // Usage analytics for the admin page, once the account exists.
  const profileId = profile?.id ?? null
  useEffect(() => (profileId ? startUsageTracking(profileId) : undefined), [profileId])

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

  const connectClassroom = async (returnTo = '/teacher') => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${returnTo}?classroom=1`,
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
    <AuthContext.Provider
      value={{ loading, session, profile, isAdmin, signInWithGoogle, signOut, connectClassroom, refreshProfile: () => setProfileVersion((v) => v + 1) }}
    >
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
