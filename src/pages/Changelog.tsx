import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { ChangelogEntry } from '../lib/bugs'
import Brand from '../components/Brand'

// Fixes the team has published. Only the fix note is shown, never the original report.
export function Changelog() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  // Back means back: an admin who came from /admin returns there, not to /student (audit #2).
  // React Router keeps an index in history.state; 0 means this tab opened straight onto the changelog.
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
  const home = profile?.role === 'teacher' ? '/teacher' : '/student'
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    supabase.rpc('changelog').then(({ data, error }) => {
      // On failure show only the error, not "Nothing here yet" under it.
      if (error) setError(`Couldn't load the changelog: ${error.message}`)
      else setEntries((data as ChangelogEntry[]) ?? [])
    })
  }, [])
  return (
    <main className="page narrow">
      <header className="bar">
        <Brand />
        <Link to="/report">Report a bug</Link>
        {isAdmin && <Link to="/admin">Admin</Link>}
        {canGoBack ? (
          <button onClick={() => navigate(-1)}>Back</button>
        ) : (
          <Link className="button" to={home}>Back</Link>
        )}
      </header>
      <h1>What we fixed</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {entries && entries.length === 0 && <p className="muted">Nothing here yet.</p>}
      <ul className="cards">
        {entries?.map((e, i) => (
          <li key={i} className="card">
            <span className="muted small">{new Date(e.fixed_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <p className="prompt">{e.note}</p>
          </li>
        ))}
      </ul>
    </main>
  )
}
