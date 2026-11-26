import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { reportPage, STATUS_LABEL, type MyBug } from '../lib/bugs'
import Brand from '../components/Brand'

// Anyone signed in can report a bug. The server ranks it and rate limits it.
export function ReportBug() {
  const { profile } = useAuth()
  const [params] = useSearchParams()
  const page = reportPage(params.get('from'))
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [mine, setMine] = useState<MyBug[]>([])
  const [historyError, setHistoryError] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_bug_reports')
    // On failure keep whatever was showing and say so, instead of an empty list (audit #30).
    setHistoryError(!!error)
    if (!error) setMine((data as MyBug[]) ?? [])
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('submit_bug_report', {
      p_description: text,
      p_page: page,
      p_user_agent: navigator.userAgent.slice(0, 300),
    })
    setBusy(false)
    if (error) return setError(error.message)
    setText('')
    setSent(true)
    load()
  }

  const home = profile?.role === 'teacher' ? '/teacher' : '/student'
  return (
    <main className="page narrow">
      <header className="bar">
        <Brand />
        <Link to="/changelog">What we fixed</Link>
        <Link className="button" to={page || home}>Back</Link>
      </header>
      <h1>Report a bug</h1>
      {sent && (
        <p className="ok" role="status">
          Thanks, we got it. You can check on it below.
        </p>
      )}
      <form className="stack" onSubmit={submit}>
        <label>
          What went wrong?
          <textarea
            rows={6}
            maxLength={2000}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setSent(false)
            }}
            placeholder="What were you doing, what happened, and what did you expect?"
            required
            minLength={5}
          />
        </label>
        <p className="muted small">
          Don't include passwords or other people's personal info. {page && <>We'll note you were on <code>{page}</code>.</>}
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy || text.trim().length < 5}>{busy ? 'Sending…' : 'Send report'}</button>
      </form>

      {historyError && (
        <p className="error" role="alert">
          Couldn't load your past reports.{sent ? ' Your new report was sent.' : ''}{' '}
          <button className="small" onClick={() => load()}>Try again</button>
        </p>
      )}
      {mine.length > 0 && (
        <section>
          <h2>Your reports</h2>
          <ul className="cards">
            {mine.map((b) => (
              <li key={b.id} className="card">
                <div className="qhead">
                  <span className="muted small">{new Date(b.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                  <span className={b.status === 'fixed' ? 'tag ok-tag' : 'tag'}>{STATUS_LABEL[b.status]}</span>
                </div>
                <p className="prompt">{b.description}</p>
                {b.fix_note && <p className="muted small">Fix: {b.fix_note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
