import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { ROSTER_SYNC_EVENT, useClassroomSync } from '../lib/useClassroomSync'
import { AssignDialog } from '../components/AssignDialog'
import { TeacherBar } from '../components/TeacherBar'
import { checkClassroomPost, classroomStatus, makeClassroomDraft, type AssignmentLink } from '../lib/assign'
import { formatTime } from '../lib/time'

export type ClassRow = { id: string; name: string; enrollments: { count: number }[]; roster_entries: { count: number }[]; assignments: { count: number }[] }
type LessonRow = {
  id: string
  title: string
  class_id: string | null
  youtube_id: string
  duration_s: number
  created_at: string
  questions: { count: number }[]
  assignments: AssignmentLink[]
}

/**
 * Teacher home (beta item 1): the teacher's own lessons as one scannable, full-width list, and their Google
 * Classroom classes beside it. Each class opens its own page, where lessons can be assigned to it.
 */
export function TeacherHome() {
  const { profile } = useAuth()
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [lessons, setLessons] = useState<LessonRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    if (!profile) return
    // teacher_id filter matters: RLS also lets teachers read *shared* lessons from other teachers.
    const [c, l] = await Promise.all([
      supabase.from('classes').select('id, name, enrollments(count), roster_entries(count), assignments(count)').eq('teacher_id', profile.id).order('name'),
      supabase
        .from('lessons')
        .select('id, title, class_id, youtube_id, duration_s, created_at, questions(count), assignments(id, class_id, due_at, google_coursework_id, google_coursework_state, google_coursework_url)')
        .eq('teacher_id', profile.id)
        .order('created_at', { ascending: false }),
    ])
    // Only report load errors here. Clearing would also wipe an action's error (e.g. "Classroom draft failed"),
    // because every action reloads the dashboard right after reporting it.
    const loadError = c.error?.message ?? l.error?.message
    if (loadError) setError(`Couldn't load your dashboard: ${loadError}`)
    setClasses((c.data as ClassRow[]) ?? [])
    setLessons((l.data as LessonRow[]) ?? [])
    setLoaded(!loadError) // don't claim "No lessons yet" when we just couldn't load them
  }, [profile])

  useEffect(() => {
    load()
    const onSync = () => void load()
    window.addEventListener(ROSTER_SYNC_EVENT, onSync)
    return () => window.removeEventListener(ROSTER_SYNC_EVENT, onSync)
  }, [load])

  // Handles the return from Google's consent screen; regular syncs run in the background (RosterAutoSync).
  const classroom = useClassroomSync(load)

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return lessons
    const className = (id: string | null) => classes.find((c) => c.id === id)?.name ?? ''
    return lessons.filter((l) => `${l.title} ${className(l.class_id)}`.toLowerCase().includes(f))
  }, [lessons, classes, filter])

  return (
    <main className="page wide">
      <TeacherBar />
      {error && <p className="error" role="alert">{error}</p>}
      {classroom.message && <p className={classroom.message.kind} role="status">{classroom.message.text}</p>}

      <div className="dash-head">
        <div>
          {profile?.name && <p className="eyebrow">{profile.name}</p>}
          <h1>Your lessons {loaded && lessons.length > 0 && <span className="count">{lessons.length}</span>}</h1>
        </div>
        <span className="row">
          <Link className="button" to="/teacher/lessons/new?ai=1">Sub plan with AI</Link>
          <Link className="button primary" to="/teacher/lessons/new">New lesson</Link>
        </span>
      </div>

      <div className="dash-grid">
        <section aria-label="Your lessons" className="dash-lessons">
          {lessons.length > 4 && (
            <label className="dash-filter">
              <span className="sr-only">Find a lesson</span>
              <input className="text" type="search" placeholder="Find a lesson by title or class" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
          )}
          {loaded && lessons.length === 0 && (
            <p className="empty">No lessons yet. Paste a YouTube link to make your first one, or draft a sub plan with AI.</p>
          )}
          {loaded && lessons.length > 0 && shown.length === 0 && <p className="muted">No lessons match “{filter}”.</p>}
          <ul className="lesson-list" hidden={shown.length === 0}>
            {shown.map((l) => (
              <LessonRowItem key={l.id} lesson={l} classes={classes} onChange={load} onError={setError} />
            ))}
          </ul>
        </section>

        <aside aria-labelledby="classes-h" className="dash-classes">
          <div className="section-head">
            <h2 id="classes-h">Classes {classes.length > 0 && <span className="count">{classes.length}</span>}</h2>
            {classroom.connected && <Link to="/teacher/settings" className="small">Classroom settings</Link>}
          </div>
          {classroom.statusError && classroom.connected === null && (
            <div className="card stack">
              <p className="error small" role="status">Couldn't check your Google Classroom connection. Your classes below are still here.</p>
              <button onClick={classroom.recheck}>Check Google Classroom again</button>
            </div>
          )}
          {classroom.connected === false && (
            <div className="card stack">
              <p className="small">Your classes and students come from Google Classroom.</p>
              <button className="primary" onClick={classroom.connect}>Connect Google Classroom</button>
            </div>
          )}
          {loaded && classroom.connected && classes.length === 0 && (
            <p className="empty small">No active classes in your Google Classroom yet. They show up here a few minutes after you make one.</p>
          )}
          <ul className="class-list" hidden={classes.length === 0}>
            {classes.map((c) => {
              const roster = c.roster_entries[0]?.count ?? 0
              const signedIn = c.enrollments[0]?.count ?? 0
              const work = c.assignments[0]?.count ?? 0
              return (
                <li key={c.id}>
                  <Link to={`/teacher/classes/${c.id}`}>
                    <strong>{c.name}</strong>
                    <span className="muted small">
                      {roster} student{roster === 1 ? '' : 's'} · {signedIn} signed in · {work} assignment{work === 1 ? '' : 's'}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </aside>
      </div>
    </main>
  )
}

function LessonRowItem({
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
  const [assigning, setAssigning] = useState(false)
  const [busy, setBusy] = useState(false)
  const assigned = new Set(lesson.assignments.map((a) => a.class_id))
  const nQuestions = lesson.questions[0]?.count ?? 0
  const className = classes.find((c) => c.id === lesson.class_id)?.name

  const draft = async (assignmentId: string) => {
    onError(null)
    setBusy(true)
    const r = await makeClassroomDraft(assignmentId)
    setBusy(false)
    if (!r.ok) onError(`Assigned in Oasis, but the Google Classroom draft wasn't made. ${r.message}`)
    onChange()
  }
  const check = async (assignmentId: string) => {
    onError(null)
    setBusy(true)
    const r = await checkClassroomPost(assignmentId)
    setBusy(false)
    if (!r.ok) onError(`Couldn't check Google Classroom. ${r.message}`)
    onChange()
  }

  return (
    <li className="lesson-item">
      <img className="lesson-thumb" src={`https://i.ytimg.com/vi/${lesson.youtube_id}/mqdefault.jpg`} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
      <div className="lesson-main">
        <div className="lesson-head">
          <Link to={`/teacher/lessons/${lesson.id}`} className="lesson-title">{lesson.title}</Link>
        </div>
        <div className="lesson-meta">
          {className && <span>{className}</span>}
          <span>{formatTime(Number(lesson.duration_s))}</span>
          <span className={nQuestions === 0 ? 'error' : undefined}>{nQuestions} question{nQuestions === 1 ? '' : 's'}</span>
        </div>
        {lesson.assignments.length > 0 && (
          <ul className="assigned small">
            {lesson.assignments.map((a) => (
              <li key={a.id} className="row">
                <span>{classes.find((c) => c.id === a.class_id)?.name ?? 'A class'}</span>
                {a.due_at && <span className="muted">due {new Date(a.due_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>}
                <ClassroomBadge a={a} busy={busy} onDraft={() => void draft(a.id)} onCheck={() => void check(a.id)} />
                <Link to={`/teacher/assignments/${a.id}`}>Results</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="lesson-actions">
        <Link className="button" to={`/teacher/lessons/${lesson.id}`}>Edit</Link>
        {classes.some((c) => !assigned.has(c.id)) && <button onClick={() => setAssigning(true)}>Assign…</button>}
      </div>
      {assigning && (
        <AssignDialog
          lesson={{ id: lesson.id, title: lesson.title, questionCount: nQuestions }}
          classes={classes}
          assignedClassIds={assigned}
          initialClassId={lesson.class_id}
          onClose={() => setAssigning(false)}
          onAssigned={onChange}
        />
      )}
    </li>
  )
}

/** Where an assignment stands in Google Classroom, with the next step. */
export function ClassroomBadge({ a, busy, onDraft, onCheck }: { a: AssignmentLink; busy: boolean; onDraft: () => void; onCheck: () => void }) {
  const st = classroomStatus(a)
  if (st === 'PUBLISHED') return <span className="ok">Posted in Classroom</span>
  if (st === 'DRAFT')
    return (
      <>
        <span className="tag warn">Draft in Classroom</span>
        {a.google_coursework_url && (
          <a href={a.google_coursework_url} target="_blank" rel="noreferrer">
            Pick a topic and post
          </a>
        )}
        <button className="small" onClick={onCheck} disabled={busy}>Check</button>
      </>
    )
  if (st === 'DELETED') return <span className="error">Deleted in Classroom</span>
  return (
    <>
      <span className="error">Not in Classroom yet</span>
      <button className="small" onClick={onDraft} disabled={busy}>Make draft</button>
    </>
  )
}
