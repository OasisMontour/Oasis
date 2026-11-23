import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { looksLikeDomain, signupReason, type AdminDashboard } from '../lib/admin'

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '–')

// Teacher sign-ups waiting for an admin, approved school domains, and blocked accounts.
// Everything goes through admin_* RPCs that re-check the caller is an admin.
export function AdminSignups({
  data,
  onChange,
  onError,
}: {
  data: AdminDashboard
  onChange: (msg: string) => Promise<void>
  onError: (msg: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [domain, setDomain] = useState('')

  const run = async (fn: string, args: Record<string, string>, ok: string) => {
    setBusy(true)
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) return onError(error.message)
    await onChange(ok)
  }

  const addDomain = async (e: FormEvent) => {
    e.preventDefault()
    if (!looksLikeDomain(domain)) return onError('That doesn’t look like a domain (e.g. district.k12.pa.us).')
    const d = domain.trim().replace(/^@/, '').toLowerCase()
    setDomain('')
    await run('admin_add_domain', { p_domain: d }, `${d} added. Sign-ups from ${d} accounts will be marked as from a trusted school.`)
  }

  return (
    <>
      <section>
        <h2>Teacher sign-ups waiting {data.signups.length > 0 && <span className="tag warn">{data.signups.length}</span>}</h2>
        {data.signups.length === 0 && (
          <p className="muted">
            Nobody waiting. Teachers Google verifies (their school's Google admin marked them as teachers) get in on their own.
          </p>
        )}
        {data.signups.length > 0 && (
          <div className="table-wrap">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Why it's waiting</th>
                  <th>Their Classroom</th>
                  <th>Asked</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.signups.map((s) => (
                  <tr key={s.user_id}>
                    <td>
                      <div>{s.name || <span className="muted">–</span>}</div>
                      <div className="muted small">{s.email}</div>
                    </td>
                    <td className="small wrap">{signupReason(s)}</td>
                    <td className="small wrap">
                      {s.evidence.active_courses} class{s.evidence.active_courses === 1 ? '' : 'es'}, {s.evidence.students ?? '?'} students
                      {s.evidence.course_names.length > 0 && <div className="muted">{s.evidence.course_names.join(', ')}</div>}
                    </td>
                    <td>{day(s.requested_at)}</td>
                    <td>
                      <span className="row">
                        <button className="small primary" disabled={busy}
                          onClick={() => run('admin_approve_teacher', { p_user: s.user_id }, `${s.email} is now a teacher.`)}>
                          Approve
                        </button>
                        <button className="small danger" disabled={busy}
                          onClick={() => run('admin_deny_teacher', { p_user: s.user_id }, `${s.email} denied and blocked from signing up again.`)}>
                          Deny
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">
          Fewer than 5 students, or class names like "test", is a red flag: a student with a personal Gmail can make a Classroom class in
          seconds, and a teacher account can see the answer keys of every shared lesson.
        </p>
      </section>

      <section>
        <div className="section-head">
          <h2>Trusted school domains</h2>
          <form className="row" onSubmit={addDomain}>
            <label className="sr-only" htmlFor="new-domain">School Google domain</label>
            <input id="new-domain" className="text" placeholder="district.k12.pa.us" value={domain} onChange={(e) => setDomain(e.target.value)} required />
            <button className="primary" disabled={busy}>Add domain</button>
          </form>
        </div>
        {data.domains.length === 0 && <p className="muted">None yet.</p>}
        <ul className="cards">
          {data.domains.map((d) => (
            <li key={d.domain} className="card row">
              <strong>{d.domain}</strong>
              <span className="muted small grow">added {day(d.added_at)}{d.added_by ? ` by ${d.added_by}` : ''}</span>
              <button className="small danger" disabled={busy} onClick={() => run('admin_remove_domain', { p_domain: d.domain }, `${d.domain} removed from trusted schools.`)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <p className="muted small">
          A trusted domain never lets anyone in by itself. It only marks sign-ups from schools you work with, so you can approve those
          quickly. Students on a school domain can often make their own Classroom class, so still check the classes look real. Teachers
          Google verifies get in without waiting.
        </p>
      </section>

      {data.blocked.length > 0 && (
        <section>
          <h2>Blocked from teacher sign-up</h2>
          <ul className="cards">
            {data.blocked.map((b) => (
              <li key={b.email} className="card row">
                <strong>{b.email}</strong>
                <span className="muted small grow">{b.kind === 'removed' ? 'removed teacher' : 'denied sign-up'}, since {day(b.added_at)}{b.added_by ? ` by ${b.added_by}` : ''}</span>
                <button className="small" disabled={busy} onClick={() => run('admin_unblock_teacher', { p_email: b.email }, `${b.email} unblocked. They can sign up again.`)}>
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
