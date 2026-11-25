import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AdminAssignments } from './AdminAssignments'
import { supabase } from '../lib/supabase'
import { looksLikeEmail, teacherStatus, VIA_LABEL, type AdminAiUsage, type AdminDashboard, type AdminTeacher, type AdminUsage } from '../lib/admin'
import { formatDuration } from '../lib/duration'
import { AdminBugs } from './AdminBugs'
import { AdminSignups } from './AdminSignups'
import Brand from '../components/Brand'

// "Nov 23, 7 AM": enough to spot a stale sync or a teacher who's gone quiet, and keeps the table narrow.
const whenShort = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' }) : '–')
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '–')

// Admin page for the Oasis team. Overview, teacher sign-ups, and teacher access (approve, pre-approve, remove).
// Students are minors: the server only ever sends counts for them, never names or emails.
export function AdminHome() {
  const { profile, signOut } = useAuth()
  const [data, setData] = useState<AdminDashboard | null>(null)
  const [usage, setUsage] = useState<AdminUsage | null>(null)
  const [ai, setAi] = useState<AdminAiUsage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [d, u, a] = await Promise.all([supabase.rpc('admin_dashboard'), supabase.rpc('admin_usage'), supabase.rpc('admin_ai_usage')])
    const err = d.error?.message ?? u.error?.message ?? a.error?.message
    if (err) setError(`Couldn't load the admin dashboard: ${err}`)
    if (!d.error) setData(d.data as AdminDashboard)
    if (!u.error) setUsage(u.data as AdminUsage)
    if (!a.error) setAi(a.data as AdminAiUsage)
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const t = data?.totals
  const reportError = useCallback((msg: string) => {
    setNotice(null)
    setError(msg)
  }, [])
  const changed = async (msg: string) => {
    setError(null)
    setNotice(msg)
    await load()
  }

  return (
    <main className="page admin">
      <header className="bar">
        <Brand suffix="admin" />
        <span className="muted">{profile?.email}</span>
        <Link to="/changelog">Changelog</Link>
        <Link className="button" to={profile?.role === 'teacher' ? '/teacher' : '/student'}>Back to app</Link>
        <button onClick={signOut}>Sign out</button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="ok" role="status">{notice}</p>}

      {data && <AdminSignups part="waiting" data={data} onChange={changed} onError={reportError} />}

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

      {ai && <AiUsage ai={ai} onChange={changed} onError={reportError} />}

      <Teachers
        teachers={data?.teachers ?? null}
        usage={usage?.teachers ?? []}
        onChange={changed}
        onError={reportError}
      />

      {data && <AdminSignups part="access" data={data} onChange={changed} onError={reportError} />}

      <AdminBugs onError={reportError} />

      <AdminAssignments assignments={data?.assignments ?? null} />

      <section>
        <h2>Admin changes</h2>
        {data && data.audit.length === 0 && <p className="muted">No changes made from this page yet.</p>}
        <ul className="assigned">
          {data?.audit.map((x, i) => (
            <li key={i} className="small">
              <span className="muted">{when(x.at)}</span> {x.actor} {AUDIT_VERB[x.action] ?? x.action} <strong>{x.target}</strong>
              {x.detail && <span className="muted"> ({x.detail})</span>}
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

// Every admin_audit action. Anything unknown is shown as-is rather than as the wrong verb.
const AUDIT_VERB: Record<string, string> = {
  add_teacher: 'pre-approved',
  remove_teacher: 'removed teacher',
  approve_teacher: 'approved',
  deny_teacher: 'denied',
  unblock_teacher: 'unblocked',
  add_domain: 'added trusted domain',
  remove_domain: 'removed trusted domain',
  ai_on: 'turned on',
  ai_off: 'turned off',
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

// AI grading spend check. Counts only: which answers were graded and for whom stays on the teachers' results pages.
function AiUsage({ ai, onChange, onError }: { ai: AdminAiUsage; onChange: (msg: string) => Promise<void>; onError: (msg: string) => void }) {
  const pct = ai.global_monthly_cap > 0 ? Math.round((ai.month_answers / ai.global_monthly_cap) * 100) : 0
  const [busy, setBusy] = useState(false)
  // The kill switch. Turning it off sends every teacher back to grading short answers by hand.
  const flip = async () => {
    if (ai.enabled && !window.confirm('Turn AI grading off for every teacher? Short answers will wait for teachers to grade them by hand.')) return
    setBusy(true)
    const { error } = await supabase.rpc('admin_set_ai_enabled', { p_enabled: !ai.enabled })
    setBusy(false)
    if (error) return onError(`Couldn't change AI grading: ${error.message}`)
    await onChange(ai.enabled ? 'AI grading is off for everyone.' : 'AI grading is back on.')
  }
  return (
    <section>
      <div className="section-head">
        <h2>
          AI grading <span className={ai.enabled ? 'tag' : 'tag warn'}>{ai.enabled ? 'on' : 'off'}</span>
        </h2>
        <button className={ai.enabled ? 'small danger' : 'small primary'} disabled={busy} onClick={flip}>
          {ai.enabled ? 'Turn AI grading off' : 'Turn AI grading on'}
        </button>
      </div>
      <ul className="stats" aria-label="AI grading">
        <Stat label="Answers graded today" value={ai.today_answers} note={`cap ${ai.teacher_daily_cap} per teacher per day`} />
        <Stat label="Answers graded this month" value={ai.month_answers} of={ai.global_monthly_cap} note={`${pct}% of the monthly cap`} />
        {ai.providers.map((p) => {
          const parked = p.cooldown_until && new Date(p.cooldown_until) > new Date()
          return (
            <Stat
              key={p.provider}
              label={`${p.provider} calls today`}
              value={p.calls}
              note={
                parked
                  ? `paused until ${new Date(p.cooldown_until!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                  : `${p.failures} failed`
              }
            />
          )
        })}
      </ul>
      {ai.providers.length === 0 && <p className="muted small">No AI calls yet today.</p>}
      {pct >= 80 && <p className="error small">Over 80% of this month's AI cap is used. Once it's hit, short answers stay ungraded until their teacher grades them.</p>}
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
          : `${r.email} pre-approved. They'll be a teacher the first time they sign in with Google.`,
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
        ? `${r.email} removed and blocked from signing up again. Their classes, lessons and results are kept.`
        : `${r.email} removed from pre-approved and blocked.`,
    )
  }

  return (
    <section>
      <div className="section-head">
        <h2>Teachers</h2>
        <form className="row" onSubmit={add}>
          <label className="sr-only" htmlFor="new-teacher">Pre-approve a teacher's Google email (optional)</label>
          <input
            id="new-teacher"
            className="text"
            type="email"
            placeholder="teacher@district.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button className="primary" disabled={busy} title="Optional. Makes them a teacher at sign-in without the Classroom check.">Pre-approve</button>
        </form>
      </div>
      {teachers && teachers.length === 0 && <p className="muted">No teachers yet.</p>}
      {teachers && teachers.length > 0 && (
        <div className="table-wrap">
          <table className="results-table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Status</th>
                <th>Last seen</th>
                <th>Classroom sync</th>
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
                      {t.via && <div className="muted small">{VIA_LABEL[t.via]}{t.added_by ? ` (${t.added_by})` : ''}</div>}
                    </td>
                    <td>
                      {whenShort(u?.last_seen ?? null)}
                      {u && <div className="muted small">{formatDuration(u.active_s_7d)} past 7 days</div>}
                    </td>
                    <td>{whenShort(t.last_synced_at)}</td>
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
        Teachers sign themselves up with Google Classroom; pre-approving is only for someone who can't. Removing a teacher turns their
        account back into a student account and blocks them from signing up again. Their classes, lessons and student results stay.
      </p>
    </section>
  )
}
