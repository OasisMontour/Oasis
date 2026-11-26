import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { useClassroomSync } from '../lib/useClassroomSync'
import Brand from '../components/Brand'
import { AssignDialog } from '../components/AssignDialog'
import { checkClassroomPost, classroomStatus, makeClassroomDraft, type AssignmentLink } from '../lib/assign'

type ClassRow = { id: string; name: string; enrollments: { count: number }[]; roster_entries: { count: number }[] }
type LessonRow = {
  id: string
  title: string
  subject: string
  class_id: string | null
  created_at: string
  questions: { count: number }[]
  assignments: AssignmentLink[]
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
        .select('id, title, subject, class_id, created_at, questions(count), assignments(id, class_id, due_at, google_coursework_id, google_coursework_state, google_coursework_url)')
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
            <Link className="button" to="/teacher/lessons/new?ai=1">Sub plan with AI</Link>
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
  const [assigning, setAssigning] = useState(false)
  const [busy, setBusy] = useState(false)
  const assigned = new Set(lesson.assignments.map((a) => a.class_id))
  const nQuestions = lesson.questions[0]?.count ?? 0

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
    <li className="card">
      <div className="lesson-head">
        <strong>{lesson.title}</strong>
        <Link className="edit" to={`/teacher/lessons/${lesson.id}`}>Edit</Link>
      </div>
      <div className="lesson-meta">
        {lesson.class_id && <span>{classes.find((c) => c.id === lesson.class_id)?.name}</span>}
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
      {classes.some((c) => !assigned.has(c.id)) && (
        <div className="lesson-assign">
          <button onClick={() => setAssigning(true)}>Assign…</button>
        </div>
      )}
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
  if (st === 'DELETED')
    return <span className="error">Deleted in Classroom</span>
  return (
    <>
      <span className="error">Not in Classroom yet</span>
      <button className="small" onClick={onDraft} disabled={busy}>Make draft</button>
    </>
  )
}
