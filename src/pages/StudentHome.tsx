import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { listMyAssignments } from '../lib/studentApi'
import { supabase } from '../lib/supabase'
import { REMOVED_TEXT, type MyRequest } from '../lib/teacherSignup'
import { assignmentStatus, dueLabel, progressPct, splitAssignments, type StudentAssignmentRow } from '../lib/player'
import { formatTime } from '../lib/time'
import '../student.css'
import Brand from '../components/Brand'

// Most students arrive straight from the Classroom link and never see this. It's a to-do list.
// Classes come from the teacher's Google Classroom roster, so there's nothing to join.
export function StudentHome() {
  const { profile, isAdmin, signOut } = useAuth()
  const [rows, setRows] = useState<StudentAssignmentRow[] | null>(null)
  const [classCount, setClassCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // A teacher whose access an admin removed lands here as a student. Tell them, instead of "no classes, personal Gmail?".
  const [removed, setRemoved] = useState(false)
  useEffect(() => {
    supabase.rpc('my_teacher_request').then(({ data }) => setRemoved((data as MyRequest | null)?.removed === true))
  }, [])

  const load = useCallback(() => {
    setError(null)
    listMyAssignments()
      .then((r) => {
        setRows(r.rows)
        setClassCount(r.classCount)
      })
      .catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const { todo, done } = splitAssignments(rows ?? [])

  return (
    <div className="student-home">
      <header className="s-top">
        <Brand />
        <span className="s-muted">{profile?.email}</span>
        <Link className="s-btn ghost" to="/report?from=%2Fstudent">
          Report a bug
        </Link>
        {isAdmin && (
          <Link className="s-btn ghost" to="/admin">
            Admin
          </Link>
        )}
        <button className="s-btn ghost" onClick={signOut}>
          Sign out
        </button>
      </header>
      <main className="s-main">
        <h1>Hi, {profile?.name?.split(' ')[0] || 'there'}</h1>

        {removed && (
          <div className="s-alert" role="alert">
            <strong>Teacher access removed.</strong> {REMOVED_TEXT}{' '}
            <Link to="/report?from=%2Fstudent">Report a bug</Link>
          </div>
        )}

        {error && (
          <p className="s-alert" role="alert">
            Couldn't load your assignments. Check your Wi-Fi.{' '}
            <button className="s-btn" onClick={load}>
              Try again
            </button>
          </p>
        )}
        {!rows && !error && <p className="s-muted">Loading…</p>}

        {rows && classCount === 0 && !removed && (
          <div className="s-empty">
            <h2>No classes found</h2>
            <p>
              You're signed in as <b>{profile?.email}</b>. Oasis didn't find any classes for this account. If that's a personal
              Gmail, sign out and use your school account.
            </p>
            <p>If it is your school account, your teacher may not have synced their Google Classroom yet. Check back later.</p>
            <button className="s-btn primary" onClick={signOut}>
              Sign out
            </button>
            <p className="s-muted">
              Teacher? <Link to="/teacher/signup">Set up a teacher account with Google Classroom</Link>.
            </p>
          </div>
        )}

        {rows && classCount > 0 && (
          <>
            <section aria-labelledby="todo-h">
              <h2 id="todo-h">To do</h2>
              {todo.length === 0 ? (
                <p className="s-muted">Nothing to do right now. New assignments show up here and in Google Classroom.</p>
              ) : (
                <ul className="s-list">
                  {todo.map((a) => (
                    <AssignmentRow key={a.id} a={a} />
                  ))}
                </ul>
              )}
            </section>
            {done.length > 0 && (
              <section aria-labelledby="done-h">
                <h2 id="done-h">Done</h2>
                <ul className="s-list">
                  {done.map((a) => (
                    <AssignmentRow key={a.id} a={a} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function AssignmentRow({ a }: { a: StudentAssignmentRow }) {
  const status = assignmentStatus(a)
  const due = status === 'done' ? null : dueLabel(a.due_at)
  const pct = progressPct(a)
  const yt = a.lessons?.youtube_id
  return (
    <li>
      <Link to={`/student/assignments/${a.id}`} className={`s-row ${status}`}>
        {yt ? <img className="s-thumb" src={`https://i.ytimg.com/vi/${yt}/mqdefault.jpg`} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <span className="s-thumb" />}
        <span className="s-row-text">
          <strong>{a.lessons?.title ?? 'Video lesson'}</strong>
          <span className="s-muted">
            {[a.classes?.name, a.lessons ? formatTime(a.lessons.duration_s) : null].filter(Boolean).join(' · ')}
            {due && <span className={due.late ? 's-late' : ''}> · {due.text}</span>}
          </span>
          {status === 'in_progress' && (
            <span className="s-progress" aria-label={`${pct}% watched`}>
              <span style={{ width: `${pct}%` }} />
            </span>
          )}
        </span>
        <span className={`s-pill ${status}`}>{status === 'done' ? 'Done' : status === 'in_progress' ? 'Keep going' : 'Start'}</span>
      </Link>
    </li>
  )
}
