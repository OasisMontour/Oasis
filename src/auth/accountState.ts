import type { Profile } from '../lib/supabase'

type Res<T> = { data: T | null; error: { code?: string; message?: string } | null }

export type AccountState = {
  profile: Profile | null
  isAdmin: boolean
  /** The profile lookup itself failed (network, server). Not the same as "no profile yet". */
  profileError: boolean
  /** is_admin failed, so we don't actually know. */
  adminError: boolean
}

/**
 * Turns the two sign-in lookups into state. A failed lookup used to look exactly like "not an admin" or
 * "no account yet", which stranded signed-in users or bounced real admins (audit #26). PGRST116 is
 * PostgREST's "no rows": the profile trigger hasn't run yet, which isn't an error.
 */
export function accountState(p: Res<Profile>, a: Res<boolean>): AccountState {
  const profileError = !!p.error && p.error.code !== 'PGRST116'
  return { profile: p.data ?? null, isAdmin: a.data === true, profileError, adminError: !!a.error }
}
