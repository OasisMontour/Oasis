import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { invokeFn } from '../lib/invokeFn'
import { useClassroomSync } from '../lib/useClassroomSync'
import Brand from '../components/Brand'

type ClassRow = { id: string; name: string; enrollments: { count: number }[]; roster_entries: { count: number }[] }
type LessonRow = {
  id: string
  title: string
  subject: string
  created_at: string
  questions: { count: number }[]
  assignments: { id: string; class_id: string; due_at: string | null; google_coursework_id: string | null }[]
}

export function TeacherHome() {
  const { profile, isAdmin, signOut } = useAuth()
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [lessons, setLessons] = useState<LessonRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    // teacher_id filter matters: RLS also lets teachers read *shared* lessons from other teachers.
    const [c, l] = await Promise.all([
      supabase.from('classes').select('id, name, enrollments(count), roster_entries(count)').eq('teacher_id', profile.id).order('name'),
      supabase
        .from('lessons')
        .select('id, title, subject, created_at, questions(count), assignments(id, class_id, due_at, google_coursework_id)')
        .eq('teacher_id', profile.id)
        .order('created_at', { ascending: false }),
    ])
    // Only report load errors here. Clearing would also wipe an action's error (e.g. "posting to Classroom
    // failed"), because every action reloads the dashboard right after reporting it.
    const loadError = c.error?.message ?? l.error?.message
    if (loadError) setError(`Couldn't load your dashboard: ${loadError}`)
    setClasses((c.data as ClassRow[]) ?? [])
    setLessons((l.data as LessonRow[]) ?? [])
    setLoaded(!loadError) // don't claim "No lessons yet" when we just couldn't load them
  }, [profile])

  useEffect(() => {
    load()
  }, [load])

  const classroom = useClassroomSync(load)

  return (
    <main className="page">
      <header className="bar">
        <Brand />
        <span className="muted">{profile?.email}</span>
        <Link to="/report?from=%2Fteacher">Report a bug</Link>
        {isAdmin && <Link className="button" to="/admin">Admin</Link>}
        <button onClick={signOut}>Sign out</button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="teacher-grid">
      <section aria-labelledby="lessons-h">
        <div className="section-head">
          <div>
            {profile?.name && <p className="eyebrow">{profile.name}</p>}
            <h1 id="lessons-h">Lessons {loaded && lessons.length > 0 && <span className="count">{lessons.length}</span>}</h1>
          </div>
          <span className="row">
            <Link className="button" to="/teacher/lessons/new?from=edpuzzle">Bring over an Edpuzzle</Link>
            <Link className="button primary" to="/teacher/lessons/new">New lesson</Link>
          </span>
        </div>
        {loaded && lessons.length === 0 && <p className="empty">No lessons yet. Paste a YouTube link to make your first one.</p>}
        <ul className="cards" hidden={lessons.length === 0}>
          {lessons.map((l) => (
            <LessonCard key={l.id} lesson={l} classes={classes} onChange={load} onError={setError} />
          ))}
        </ul>
      </section>

      <aside>
        <div className="section-head">
          <h2>Classes</h2>
          <span className="row">
            {classroom.connected === false && <button onClick={classroom.connect}>Connect Google Classroom</button>}
            {classroom.connected && (
              <>
                <button onClick={classroom.syncNow} disabled={classroom.busy}>{classroom.busy ? 'Syncing…' : 'Sync Google Classroom'}</button>
                <button className="small" onClick={classroom.disconnect} disabled={classroom.busy}>Disconnect</button>
              </>
            )}
          </span>
        </div>
        {classroom.message && <p className={classroom.message.kind} role="status">{classroom.message.text}</p>}
        {loaded && classes.length === 0 && <p className="empty small">No classes yet. Your classes and students come from Google Classroom: connect it above and they'll show up here.</p>}
        <ul className="cards" hidden={classes.length === 0}>
          {classes.map((c) => (
            <li key={c.id}>
              <strong>{c.name}</strong>
              <span className="muted small">
                {c.roster_entries[0]?.count ?? 0} students, {c.enrollments[0]?.count ?? 0} signed in
              </span>
            </li>
          ))}
        </ul>
      </aside>
      </div>
    </main>
  )
}

function LessonCard({
  lesson,
  classes,
  onChange,
  onError,
}: {
  lesson: LessonRow
  classes: ClassRow[]
  onChange: () => void
  onError: (msg: string | null) => void
}) {
  const [classId, setClassId] = useState('')
  const [due, setDue] = useState('')
  const assigned = new Set(lesson.assignments.map((a) => a.class_id))
  const open = classes.filter((c) => !assigned.has(c.id))
  const nQuestions = lesson.questions[0]?.count ?? 0

  const [busy, setBusy] = useState(false)

  /** Post to Google Classroom. The assignment already exists in Oasis, so a failure here is retryable. */
  const postToClassroom = async (assignmentId: string) => {
    const { data, error } = await invokeFn<{ ok: boolean; error?: string }>('classroom', { action: 'post', assignment_id: assignmentId })
    if (error || !data?.ok) {
      const why = data?.error === 'not_connected' || data?.error === 'reconnect' ? 'Connect Google Classroom first, then click Retry.' : (data?.error ?? error?.message ?? '')
      onError(`Assigned in Oasis, but posting to Google Classroom failed. ${why}`)
    }
  }

  const assign = async (e: FormEvent) => {
    e.preventDefault()
    if (due && new Date(due).getTime() < Date.now()) return onError('That due date has already passed. Pick a time in the future.')
    onError(null)
    setBusy(true)
    const { data, error } = await supabase
      .from('assignments')
      .insert({ lesson_id: lesson.id, class_id: classId, due_at: due ? new Date(due).toISOString() : null })
      .select('id')
      .single()
    if (error) {
      setBusy(false)
      return onError(error.message)
    }
    await postToClassroom(data.id)
    setBusy(false)
    setClassId('')
    setDue('')
    onChange()
  }

  const retry = async (assignmentId: string) => {
    onError(null)
    setBusy(true)
    await postToClassroom(assignmentId)
    setBusy(false)
    onChange()
  }

  return (
    <li className="card">
      <div className="lesson-head">
        <strong>{lesson.title}</strong>
        <Link className="edit" to={`/teacher/lessons/${lesson.id}`}>Edit</Link>
      </div>
      <div className="lesson-meta">
        {lesson.subject && <span>{lesson.subject}</span>}
        <span className={nQuestions === 0 ? 'error' : undefined}>{nQuestions} question{nQuestions === 1 ? '' : 's'}</span>
      </div>
      {lesson.assignments.length > 0 && (
        <ul className="assigned small">
          {lesson.assignments.map((a) => (
            <li key={a.id} className="row">
              <span>{classes.find((c) => c.id === a.class_id)?.name ?? 'A class'}</span>
              {a.due_at && <span className="muted">due {new Date(a.due_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>}
              {a.google_coursework_id ? (
                <span className="ok">Posted to Classroom</span>
              ) : (
                <>
                  <span className="error">Not in Classroom yet</span>
                  <button className="small" onClick={() => retry(a.id)} disabled={busy}>Retry</button>
                </>
              )}
              <Link to={`/teacher/assignments/${a.id}`}>Results</Link>
            </li>
          ))}
        </ul>
      )}
      {open.length > 0 && (
        <form className="row lesson-assign" onSubmit={assign}>
          <select aria-label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Assign to class…</option>
            {open.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <label className="small">
            Due <input type="datetime-local" className="text" value={due} min={localNow()} onChange={(e) => setDue(e.target.value)} />
          </label>
          <button disabled={busy || !classId || nQuestions === 0} title={nQuestions === 0 ? 'Add questions first' : undefined}>
            {busy ? 'Posting…' : 'Assign + post to Classroom'}
          </button>
        </form>
      )}
    </li>
  )
}

/** Now as a datetime-local value ("2026-11-23T08:05") in the teacher's time zone. */
function localNow(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}


type LibraryEntry = { id: string; title: string; subject: string }

function LessonLibrary() {
  const [shared, setShared] = useState<LibraryEntry[]>([])
  const [starters, setStarters] = useState<LibraryEntry[]>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [filter, setFilter] = useState('')
  useEffect(() => {
    let active = true
    Promise.all([
      supabase.from('lessons').select('id,title,subject').eq('shared', true).order('title'),
      supabase.from('starter_lessons').select('id,title,subject').order('title'),
    ]).then(([library, catalog]) => {
      if (!active) return
      setShared(library.data ?? [])
      setStarters(catalog.data ?? [])
      setError(library.error || catalog.error ? 'Some library lessons could not be loaded.' : '')
      setLoaded(true)
    })
    return () => { active = false }
  }, [])
  return <details className="card">
    <summary>Lesson library</summary>
    <label>Search by title or subject <input className="text" value={filter} onChange={e => setFilter(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    {!loaded && <p>Loading lessons…</p>}
    {([['Starter lessons', 'starter', starters], ['Shared by teachers', 'copy', shared]] as const).map(([heading, param, entries]) => {
      const matches = entries.filter(e => (e.title + ' ' + e.subject).toLowerCase().includes(filter.trim().toLowerCase()))
      return <section key={param}><h3>{heading}</h3>
        {loaded && !error && !matches.length && <p>No matching lessons.</p>}
        <ul>{matches.map(e => <li key={e.id}><Link to={'/teacher/lessons/new?' + param + '=' + e.id}>Use {e.title}</Link> · {e.subject}</li>)}</ul>
      </section>
    })}
  </details>
}
