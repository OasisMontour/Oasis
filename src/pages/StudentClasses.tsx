import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { StudentShell } from '../components/StudentShell'
import { listMyAssignments, listMyClasses, type MyClass } from '../lib/studentApi'
import { splitAssignments, type StudentAssignmentRow } from '../lib/player'
import { AssignmentRow } from './StudentHome'

/** Classes tab (beta item 3): the student's enrolled classes; each opens a page with that class's work. */
export function StudentClasses() {
  const { id } = useParams()
  const [classes, setClasses] = useState<MyClass[] | null>(null)
  const [rows, setRows] = useState<StudentAssignmentRow[] | null>(null)
  const [error, setError] = useState(false)
  const [tries, setTries] = useState(0)

  useEffect(() => {
    let active = true
    setError(false)
    Promise.all([listMyClasses(), listMyAssignments()])
      .then(([c, a]) => {
        if (!active) return
        setClasses(c)
        setRows(a.rows)
      })
      .catch(() => active && setError(true))
    return () => {
      active = false
    }
  }, [tries])

  const count = (classId: string) => splitAssignments((rows ?? []).filter((r) => r.class_id === classId)).todo.length

  if (error)
    return (
      <StudentShell>
        <p className="s-alert" role="alert">
          Couldn't load your classes. Check your Wi-Fi.{' '}
          <button className="s-btn" onClick={() => setTries((n) => n + 1)}>Try again</button>
        </p>
      </StudentShell>
    )
  if (!classes || !rows)
    return (
      <StudentShell>
        <p className="s-muted">Loading…</p>
      </StudentShell>
    )

  if (id) {
    const cls = classes.find((c) => c.id === id)
    const { todo, done } = splitAssignments(rows.filter((r) => r.class_id === id))
    return (
      <StudentShell>
        <p className="s-crumbs"><Link to="/student/classes">← All classes</Link></p>
        {!cls ? (
          <div className="s-empty">
            <h2>You're not in this class</h2>
            <p>It may have been removed in Google Classroom. Ask your teacher if that's a mistake.</p>
          </div>
        ) : (
          <>
            <h1>{cls.name}</h1>
            <h2>To do</h2>
            {todo.length === 0 ? <p className="s-muted">Nothing to do in this class right now.</p> : (
              <ul className="s-list">{todo.map((a) => <AssignmentRow key={a.id} a={a} />)}</ul>
            )}
            {done.length > 0 && (
              <>
                <h2>Done</h2>
                <ul className="s-list">{done.map((a) => <AssignmentRow key={a.id} a={a} />)}</ul>
              </>
            )}
          </>
        )}
      </StudentShell>
    )
  }

  return (
    <StudentShell>
      <h1>Classes</h1>
      {classes.length === 0 ? (
        <div className="s-empty">
          <h2>No classes yet</h2>
          <p>Your classes come from Google Classroom. If your teacher just added you, check back in a few minutes.</p>
        </div>
      ) : (
        <ul className="s-list">
          {classes.map((c) => {
            const n = count(c.id)
            return (
              <li key={c.id}>
                <Link className="s-row s-class" to={`/student/classes/${c.id}`}>
                  <span className="s-row-text">
                    <strong>{c.name}</strong>
                    <span className="s-muted">{n === 0 ? 'Nothing to do' : `${n} to do`}</span>
                  </span>
                  <span aria-hidden="true">›</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </StudentShell>
  )
}
