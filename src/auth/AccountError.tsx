import { useAuth } from './AuthProvider'

/** Shown when the account lookup failed, instead of treating it as "no account" or "not allowed". */
export function AccountError() {
  const { refreshProfile, signOut } = useAuth()
  return (
    <main className="page narrow">
      <p className="error" role="alert">Couldn't load your account. Check your connection and try again.</p>
      <p className="row">
        <button className="primary" onClick={refreshProfile}>Try again</button>
        <button onClick={() => void signOut()}>Sign out</button>
      </p>
    </main>
  )
}
