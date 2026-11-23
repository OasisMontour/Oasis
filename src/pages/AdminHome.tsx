import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { looksLikeEmail, teacherStatus, type AdminDashboard, type AdminTeacher, type AdminUsage } from '../lib/admin'
import { formatDuration } from '../lib/duration'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '–')
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '–')

// Admin page for the Oasis team. Read-only overview plus the teacher allowlist.
// Students are minors: the server only ever sends counts for them, never names or emails.
export function AdminHome() {
  const { profile, signOut } = useAuth()
  const [data, setData] = useState<AdminDashboard | null>(null)
  const [usage, setUsage] = useState<AdminUsage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [d, u] = await Promise.all([supabase.rpc('admin_dashboard'), supabase.rpc('admin_usage')])
    const err = d.error?.message ?? u.error?.message
    if (err) setError(`Couldn't load the admin dashboard: ${err}`)
    if (!d.error) setData(d.data as AdminDashboard)
    if (!u.error) setUsage(u.data as AdminUsage)
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

      {usage && <Usage usage={usage} />}

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
        usage={usage?.teachers ?? []}
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

function Usage({ usage }: { usage: AdminUsage }) {
  const a = usage.active
  const max = Math.max(1, ...usage.daily.map((d) => d.students + d.teachers))
  const [showTable, setShowTable] = useState(false)
  return (
    <section>
      <h2>Usage</h2>
      <ul className="stats" aria-label="Usage">
        <Stat label="Active today" value={a.today_students + a.today_teachers} note={`${a.today_students} students · ${a.today_teachers} teachers`} />
        <Stat label="Active, last 7 days" value={a.week_students + a.week_teachers} note={`${a.week_students} students · ${a.week_teachers} teachers`} />
        <Stat label="Active, last 30 days" value={a.month_students + a.month_teachers} note={`${a.month_students} students · ${a.month_teachers} teachers`} />
        <Stat label="Visits, last 30 days" value={a.visits_30d} note={`${a.visits_total} all time`} />
        <Stat label="Time in app, last 30 days" text={formatDuration(a.active_s_30d)} note={`${formatDuration(a.active_s_total)} all time`} />
        <Stat
          label="Per active student, last 7 days"
          text={formatDuration(usage.students_week.avg_active_s)}
          note={`average · median ${formatDuration(usage.students_week.median_active_s)}`}
        />
        <Stat label="Video watched" text={formatDuration(usage.video.watched_s_total)} note={`${usage.video.answers_total} answers`} />
      </ul>

      <figure className="dau">
        <figcaption className="small">
          Daily active users, last 30 days{' '}
          <button className="small" onClick={() => setShowTable((v) => !v)}>{showTable ? 'Hide table' : 'Show table'}</button>
        </figcaption>
        <div className="bars" role="img" aria-label={`Daily active users, peak ${max}`}>
          {usage.daily.map((d) => {
            const n = d.students + d.teachers
            return (
              <div key={d.day} className="bar-col" tabIndex={0}>
                <span className="bar" style={{ height: `${(n / max) * 100}%` }} />
                <span className="tip" role="tooltip">
                  <strong>{shortDay(d.day)}</strong>
                  <br />
                  {d.students} students · {d.teachers} teachers
                  <br />
                  {d.visits} visits · {formatDuration(d.active_s)}
                </span>
              </div>
            )
          })}
        </div>
        <div className="bars-axis small muted">
          <span>{shortDay(usage.daily[0]?.day)}</span>
          <span>peak {max}</span>
          <span>today</span>
        </div>
        {showTable && (
          <table className="results-table small">
            <thead>
              <tr><th>Day</th><th>Students</th><th>Teachers</th><th>Visits</th><th>Time in app</th></tr>
            </thead>
            <tbody>
              {[...usage.daily].reverse().map((d) => (
                <tr key={d.day}>
                  <td>{shortDay(d.day)}</td><td>{d.students}</td><td>{d.teachers}</td><td>{d.visits}</td><td>{formatDuration(d.active_s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </figure>
      <p className="muted small">
        Time in app counts only while an Oasis tab is open and visible. Students are counted, never listed by name here.
      </p>
    </section>
  )
}

// "2026-11-23" is a calendar day; don't let the browser's time zone shift it.
function shortDay(iso: string | undefined) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function Stat({ label, value, text, of, note }: { label: string; value?: number; text?: string; of?: number; note?: string }) {
  return (
    <li className="stat">
      <span className="muted small">{label}</span>
      <strong>
        {text ?? value}
        {of !== undefined && <span className="of"> / {of}</span>}
      </strong>
      {note && <span className="muted small">{note}</span>}
    </li>
  )
}

function Teachers({
  teachers,
  usage,
  onChange,
  onError,
}: {
  teachers: AdminTeacher[] | null
  usage: AdminUsage['teachers']
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
                <th>Last seen</th>
                <th>Time in app (7 days)</th>
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
                const u = usage.find((x) => x.email === t.email)
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
                    <td>{when(u?.last_seen ?? null)}</td>
                    <td>{u ? formatDuration(u.active_s_7d) : '–'}</td>
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
