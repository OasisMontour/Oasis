import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { ChangelogEntry } from '../lib/bugs'

// Fixes the team has published. Only the fix note is shown, never the original report.
export function Changelog() {
  const { profile } = useAuth()
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    supabase.rpc('changelog').then(({ data, error }) => {
      if (error) setError(error.message)
      setEntries((data as ChangelogEntry[]) ?? [])
    })
  }, [])
  return (
    <main className="page narrow">
      <header className="bar">
        <strong>Oasis</strong>
        <Link to="/report">Report a bug</Link>
        <Link className="button" to={profile?.role === 'teacher' ? '/teacher' : '/student'}>Back</Link>
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
