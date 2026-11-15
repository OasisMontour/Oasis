import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { ClassroomAuthError, fetchClassroomRosters } from '../lib/classroom'

type ClassRow = { id: string; name: string; join_code: string; google_course_id: string | null; enrollments: { count: number }[] }
type LessonRow = {
  id: string
  title: string
  subject: string
  created_at: string
  questions: { count: number }[]
  assignments: { id: string; class_id: string; due_at: string | null }[]
}

export function TeacherHome() {
  const { profile, session, signOut, connectClassroom } = useAuth()
  const [params, setParams] = useSearchParams()
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [lessons, setLessons] = useState<LessonRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newClass, setNewClass] = useState('')

  const load = useCallback(async () => {
    if (!profile) return
    // teacher_id filter matters: RLS also lets teachers read *shared* lessons from other teachers.
    const [c, l] = await Promise.all([
      supabase.from('classes').select('id, name, join_code, google_course_id, enrollments(count)').eq('teacher_id', profile.id).order('name'),
      supabase
        .from('lessons')
        .select('id, title, subject, created_at, questions(count), assignments(id, class_id, due_at)')
        .eq('teacher_id', profile.id)
        .order('created_at', { ascending: false }),
    ])
    setError(c.error?.message ?? l.error?.message ?? null)
    setClasses((c.data as ClassRow[]) ?? [])
    setLessons((l.data as LessonRow[]) ?? [])
    setLoaded(true)
  }, [profile])

  useEffect(() => {
    load()
  }, [load])

  // ---- Google Classroom roster import
  const [sync, setSync] = useState<{ busy: boolean; text: string | null; kind: 'ok' | 'error' }>({ busy: false, text: null, kind: 'ok' })
  const justConnected = params.get('classroom') === '1'
  const token = session?.provider_token

  const syncClassroom = useCallback(async () => {
    if (!token) return connectClassroom()
    setSync({ busy: true, text: 'Importing from Google Classroom…', kind: 'ok' })
    try {
      const courses = await fetchClassroomRosters(token)
      const { data, error } = await supabase.rpc('import_classroom', { p_courses: courses })
      if (error) throw error
      const r = data as { created: number; updated: number; newly_enrolled: number; skipped: string[] }
      const students = courses.reduce((n, c) => n + c.students.length, 0)
      let text = `Imported ${courses.length} class${courses.length === 1 ? '' : 'es'} and ${students} students from Google Classroom.`
      if (r.skipped.length) text += ` Skipped ${r.skipped.join(', ')}: another teacher already imported ${r.skipped.length === 1 ? 'it' : 'them'}.`
      setSync({ busy: false, text, kind: 'ok' })
      load()
    } catch (e) {
      if (e instanceof ClassroomAuthError) return connectClassroom()
      setSync({ busy: false, text: `Classroom import failed: ${(e as Error).message}`, kind: 'error' })
    }
  }, [token, connectClassroom, load])

  // Coming back from the Google consent screen: import straight away, then tidy the URL.
  useEffect(() => {
    if (!justConnected || !token || !profile) return
    setParams({}, { replace: true })
    syncClassroom()
  }, [justConnected, token, profile, setParams, syncClassroom])

  const addClass = async (e: FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('classes').insert({ teacher_id: profile!.id, name: newClass.trim() })
    if (error) return setError(error.message)
    setNewClass('')
    load()
  }

  return (
    <main className="page">
      <header className="bar">
        <strong>Oasis</strong>
        <span className="muted">{profile?.email}</span>
        <button onClick={signOut}>Sign out</button>
      </header>
      <h1>Welcome, {profile?.name || 'teacher'}</h1>
      {error && <p className="error" role="alert">{error}</p>}

      <section>
        <div className="section-head">
          <h2>Lessons</h2>
          <Link className="button primary" to="/teacher/lessons/new">New lesson</Link>
        </div>
        {loaded && lessons.length === 0 && <p className="muted">No lessons yet. Paste a YouTube link to make your first one.</p>}
        <ul className="cards">
          {lessons.map((l) => (
            <LessonCard key={l.id} lesson={l} classes={classes} onChange={load} onError={setError} />
          ))}
        </ul>
      </section>

      <section>
        <div className="section-head">
          <h2>Classes</h2>
          <button onClick={syncClassroom} disabled={sync.busy}>{sync.busy ? 'Importing…' : 'Import from Google Classroom'}</button>
        </div>
        {sync.text && <p className={sync.kind} role="status">{sync.text}</p>}
        {loaded && classes.length === 0 && <p className="muted">No classes yet. Import them from Google Classroom, or make one and give students its join code.</p>}
        <ul className="cards">
          {classes.map((c) => (
            <li key={c.id} className="card row">
              <strong>{c.name}</strong>
              <span className="muted small">{c.enrollments[0]?.count ?? 0} students</span>
              {!c.google_course_id && <span className="small">Join code <code>{c.join_code}</code></span>}
              {c.google_course_id && <span className="muted small">From Google Classroom</span>}
            </li>
          ))}
        </ul>
        <form className="join" onSubmit={addClass}>
          <label htmlFor="new-class">New class</label>
          <input id="new-class" className="text" value={newClass} onChange={(e) => setNewClass(e.target.value)} placeholder="Period 3 Biology" maxLength={120} />
          <button disabled={!newClass.trim()}>Add class</button>
        </form>
      </section>
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
  onError: (msg: string) => void
}) {
  const [classId, setClassId] = useState('')
  const [due, setDue] = useState('')
  const assigned = new Set(lesson.assignments.map((a) => a.class_id))
  const open = classes.filter((c) => !assigned.has(c.id))
  const nQuestions = lesson.questions[0]?.count ?? 0

  const assign = async (e: FormEvent) => {
    e.preventDefault()
    const { error } = await supabase
      .from('assignments')
      .insert({ lesson_id: lesson.id, class_id: classId, due_at: due ? new Date(due).toISOString() : null })
    if (error) return onError(error.message)
    setClassId('')
    setDue('')
    onChange()
  }

  return (
    <li className="card">
      <div className="row">
        <strong>{lesson.title}</strong>
        {lesson.subject && <span className="muted small">{lesson.subject}</span>}
        <span className="muted small">{nQuestions} question{nQuestions === 1 ? '' : 's'}</span>
        <Link to={`/teacher/lessons/${lesson.id}`}>Edit</Link>
      </div>
      {lesson.assignments.length > 0 && (
        <p className="small muted">
          Assigned to{' '}
          {lesson.assignments
            .map((a) => {
              const name = classes.find((c) => c.id === a.class_id)?.name ?? 'a class'
              return a.due_at ? `${name} (due ${new Date(a.due_at).toLocaleDateString()})` : name
            })
            .join(', ')}
        </p>
      )}
      {open.length > 0 && (
        <form className="row" onSubmit={assign}>
          <select aria-label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Assign to class…</option>
            {open.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <label className="small">
            Due <input type="datetime-local" className="text" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <button disabled={!classId || nQuestions === 0} title={nQuestions === 0 ? 'Add questions first' : undefined}>Assign</button>
        </form>
      )}
    </li>
  )
}
