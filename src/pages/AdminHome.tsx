import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { looksLikeEmail, teacherStatus, type AdminDashboard, type AdminTeacher } from '../lib/admin'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '–')
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '–')

// Admin page for the Oasis team. Read-only overview plus the teacher allowlist.
// Students are minors: the server only ever sends counts for them, never names or emails.
export function AdminHome() {
  const { profile, signOut } = useAuth()
  const [data, setData] = useState<AdminDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_dashboard')
    if (error) setError(`Couldn't load the admin dashboard: ${error.message}`)
    else setData(data as AdminDashboard)
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const t = data?.totals

  return (
    <main className="page admin">
      <header className="bar">
        <strong>Oasis admin</strong>
        <span className="muted">{profile?.email}</span>
        <Link className="button" to={profile?.role === 'teacher' ? '/teacher' : '/student'}>Back to app</Link>
        <button onClick={signOut}>Sign out</button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="ok" role="status">{notice}</p>}

      {t && (
        <ul className="stats" aria-label="Totals">
          <Stat label="Teachers" value={t.teachers} />
          <Stat label="Students signed in" value={t.students} />
          <Stat label="Classes" value={t.classes} />
          <Stat label="Lessons" value={t.lessons} />
          <Stat label="Assignments" value={t.assignments} />
          <Stat label="Attempts finished" value={t.attempts_finished} of={t.attempts_started} />
          <Stat label="Flagged attempts" value={t.flagged_attempts} />
        </ul>
      )}

      <Teachers
        teachers={data?.teachers ?? null}
        onChange={async (msg) => {
          setError(null)
          setNotice(msg)
          await load()
        }}
        onError={(msg) => {
          setNotice(null)
          setError(msg)
        }}
      />

      <section>
        <h2>Assignments</h2>
        {data && data.assignments.length === 0 && <p className="muted">No assignments yet.</p>}
        {data && data.assignments.length > 0 && (
          <div className="table-wrap">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Assigned</th>
                  <th>Teacher</th>
                  <th>Class</th>
                  <th>Lesson</th>
                  <th>Started</th>
                  <th>Finished</th>
                  <th>Avg score</th>
                  <th>Flagged</th>
                </tr>
              </thead>
              <tbody>
                {data.assignments.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {day(a.created_at)}
                      {a.due_at && <div className="muted small">due {day(a.due_at)}</div>}
                    </td>
                    <td>{a.teacher}</td>
                    <td>{a.class}</td>
                    <td>
                      {a.lesson}
                      {!a.posted_to_classroom && <div className="muted small">not posted to Classroom</div>}
                    </td>
                    <td>{a.started} / {a.students}</td>
                    <td>{a.finished} / {a.students}</td>
                    <td>{a.avg_score ?? '–'}</td>
                    <td>
                      {a.flagged > 0 ? (
                        <span className="tag warn" title={`${a.focus_events} times away from the video`}>{a.flagged} students</span>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">Newest 200. Student-level results stay on each teacher's results page.</p>
      </section>

      <section>
        <h2>Allowlist changes</h2>
        {data && data.audit.length === 0 && <p className="muted">No changes made from this page yet.</p>}
        <ul className="assigned">
          {data?.audit.map((x, i) => (
            <li key={i} className="small">
              <span className="muted">{when(x.at)}</span> {x.actor} {x.action === 'add_teacher' ? 'added' : 'removed'} <strong>{x.target}</strong>
              {x.detail && <span className="muted"> ({x.detail})</span>}
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

function Stat({ label, value, of }: { label: string; value: number; of?: number }) {
  return (
    <li className="stat">
      <span className="muted small">{label}</span>
      <strong>
        {value}
        {of !== undefined && <span className="of"> / {of}</span>}
      </strong>
    </li>
  )
}

function Teachers({
  teachers,
  onChange,
  onError,
}: {
  teachers: AdminTeacher[] | null
  onChange: (msg: string) => Promise<void>
  onError: (msg: string) => void
}) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!looksLikeEmail(email)) return onError('That doesn’t look like an email address.')
    setBusy(true)
    const { data, error } = await supabase.rpc('admin_add_teacher', { p_email: email })
    setBusy(false)
    if (error) return onError(error.message)
    const r = data as { email: string; already_listed: boolean; promoted: boolean }
    setEmail('')
    await onChange(
      r.already_listed
        ? `${r.email} was already on the list.`
        : r.promoted
          ? `${r.email} added. They'd already signed in, so their account is now a teacher account.`
          : `${r.email} added. They'll be a teacher the first time they sign in with Google.`,
    )
  }

  const remove = async (target: string) => {
    setConfirming(null)
    setBusy(true)
    const { data, error } = await supabase.rpc('admin_remove_teacher', { p_email: target })
    setBusy(false)
    if (error) return onError(error.message)
    const r = data as { email: string; demoted: boolean }
    await onChange(
      r.demoted
        ? `${r.email} removed and is no longer a teacher. Their classes, lessons and results are kept.`
        : `${r.email} removed from the allowlist.`,
    )
  }

  return (
    <section>
      <div className="section-head">
        <h2>Teachers</h2>
        <form className="row" onSubmit={add}>
          <label className="sr-only" htmlFor="new-teacher">Teacher's school Google email</label>
          <input
            id="new-teacher"
            className="text"
            type="email"
            placeholder="teacher@district.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button className="primary" disabled={busy}>Add teacher</button>
        </form>
      </div>
      {teachers && teachers.length === 0 && <p className="muted">Nobody on the allowlist yet.</p>}
      {teachers && teachers.length > 0 && (
        <div className="table-wrap">
          <table className="results-table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Status</th>
                <th>Last Classroom sync</th>
                <th>Classes</th>
                <th>Students</th>
                <th>Lessons</th>
                <th>Assignments</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => {
                const s = teacherStatus(t)
                return (
                  <tr key={t.email}>
                    <td>
                      <div>{t.name || <span className="muted">–</span>}</div>
                      <div className="muted small">{t.email}</div>
                    </td>
                    <td>
                      <span className={s.warn ? 'tag warn' : 'tag'}>{s.label}</span>
                      {t.added_by && <div className="muted small">added by {t.added_by}</div>}
                    </td>
                    <td>{when(t.last_synced_at)}</td>
                    <td>{t.classes}</td>
                    <td>{t.students}</td>
                    <td>{t.lessons}</td>
                    <td>{t.assignments}</td>
                    <td>
                      {confirming === t.email ? (
                        <span className="row">
                          <button className="small danger" disabled={busy} onClick={() => remove(t.email)}>Confirm remove</button>
                          <button className="small" onClick={() => setConfirming(null)}>Cancel</button>
                        </span>
                      ) : (
                        <button className="small danger" disabled={busy} onClick={() => setConfirming(t.email)} aria-label={`Remove ${t.email}`}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Removing a teacher takes them off the allowlist and turns their account back into a student account. Their classes, lessons and
        student results stay.
      </p>
    </section>
  )
}
