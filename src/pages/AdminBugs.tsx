import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { STATUS_LABEL, type AdminBug, type BugStatus, type Severity } from '../lib/bugs'

const SEVERITIES: Severity[] = ['high', 'medium', 'low']
const STATUSES: BugStatus[] = ['open', 'fixing', 'fixed', 'wont_fix']

// Bug triage. Open reports first, high severity first. Marking one fixed needs a fix note,
// which is what shows on the public changelog (the report text itself never does).
export function AdminBugs({ onError }: { onError: (msg: string) => void }) {
  const [bugs, setBugs] = useState<AdminBug[] | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_bug_reports')
    if (error) onError(`Couldn't load bug reports: ${error.message}`)
    else setBugs(data as AdminBug[])
  }, [onError])
  useEffect(() => {
    load()
  }, [load])

  const open = bugs?.filter((b) => b.status === 'open' || b.status === 'fixing') ?? []
  const closed = bugs?.filter((b) => b.status === 'fixed' || b.status === 'wont_fix') ?? []
  const highOpen = open.filter((b) => b.severity === 'high').length

  return (
    <section>
      <div className="section-head">
        <h2>
          Bug reports {open.length > 0 && <span className="tag warn">{open.length} open{highOpen ? `, ${highOpen} high` : ''}</span>}
        </h2>
        {closed.length > 0 && <button className="small" onClick={() => setShowClosed((v) => !v)}>{showClosed ? 'Hide' : 'Show'} {closed.length} closed</button>}
      </div>
      {bugs && open.length === 0 && <p className="muted">No open reports.</p>}
      <ul className="cards">
        {[...open, ...(showClosed ? closed : [])].map((b) => (
          <BugCard key={b.id} bug={b} onSaved={load} onError={onError} />
        ))}
      </ul>
    </section>
  )
}

function BugCard({ bug, onSaved, onError }: { bug: AdminBug; onSaved: () => void; onError: (m: string) => void }) {
  const [severity, setSeverity] = useState(bug.severity)
  const [status, setStatus] = useState(bug.status)
  const [note, setNote] = useState(bug.fix_note)
  const [busy, setBusy] = useState(false)
  const dirty = severity !== bug.severity || status !== bug.status || note !== bug.fix_note

  const save = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('admin_update_bug', { p_id: bug.id, p_severity: severity, p_status: status, p_fix_note: note })
    setBusy(false)
    if (error) return onError(error.message)
    onSaved()
  }

  return (
    <li className={`card bug sev-${bug.severity}`}>
      <div className="qhead">
        <span className="row">
          <span className={`tag sev ${bug.severity}`}>{bug.severity}</span>
          <span className="muted small">
            #{bug.id} · {new Date(bug.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ·{' '}
            {bug.reporter ?? `a ${bug.reporter_role}`}
            {bug.page && <> · on <code>{bug.page}</code></>}
          </span>
        </span>
        <span className="tag">{STATUS_LABEL[bug.status]}</span>
      </div>
      <p className="prompt bug-text">{bug.description}</p>
      <p className="muted small">
        Auto-ranked {bug.severity_auto}: {bug.severity_reason}
        {bug.user_agent && <> · <span title={bug.user_agent}>{shortAgent(bug.user_agent)}</span></>}
      </p>
      <div className="row">
        <label className="small">
          Severity{' '}
          <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="small">
          Status{' '}
          <select value={status} onChange={(e) => setStatus(e.target.value as BugStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <input
          className="text grow"
          maxLength={500}
          placeholder="Fix note for the changelog (required to mark fixed)"
          aria-label={`Fix note for report ${bug.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="small primary" disabled={!dirty || busy} onClick={save}>Save</button>
      </div>
    </li>
  )
}

function shortAgent(ua: string) {
  if (/CrOS/.test(ua)) return 'Chromebook'
  if (/iPhone|iPad/.test(ua)) return 'iPhone/iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Mac OS X/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  return 'other device'
}
