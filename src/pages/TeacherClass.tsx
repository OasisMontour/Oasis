import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { ROSTER_SYNC_EVENT } from '../lib/useClassroomSync'
import { AssignDialog } from '../components/AssignDialog'
import { TeacherBar } from '../components/TeacherBar'
import { checkClassroomPost, makeClassroomDraft, type AssignmentLink } from '../lib/assign'
import { ClassroomBadge } from './TeacherHome'

type ClassInfo = { id: string; name: string; google_synced_at: string | null }
type Work = AssignmentLink & { lessons: { id: string; title: string } | null }
type LessonPick = { id: string; title: string; class_id: string | null; questions: { count: number }[]; assignments: { class_id: string }[] }
type Person = { email: string; name: string; signedIn: boolean }

/** One class (beta item 1): its assigned work, its students, and assigning any of the teacher's lessons to it. */
export function TeacherClass() {
  const { id = '' } = useParams()
  const { profile } = useAuth()
  const [cls, setCls] = useState<ClassInfo | null>(null)
  const [work, setWork] = useState<Work[]>([])
  const [lessons, setLessons] = useState<LessonPick[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assigning, setAssigning] = useState<LessonPick | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!profile) return
    const [c, a, l, r, e] = await Promise.all([
      supabase.from('classes').select('id, name, google_synced_at').eq('id', id).eq('teacher_id', profile.id).maybeSingle(),
      supabase
        .from('assignments')
        .select('id, class_id, due_at, created_at, google_coursework_id, google_coursework_state, google_coursework_url, lessons(id, title)')
        .eq('class_id', id)
        .order('created_at', { ascending: false }),
      supabase.from('lessons').select('id, title, class_id, questions(count), assignments(class_id)').eq('teacher_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('roster_entries').select('email, name').eq('class_id', id).order('name'),
      supabase.from('enrollments').select('profiles(email)').eq('class_id', id),
    ])
    if (!c.data) return setMissing(!c.error)
    setCls(c.data as ClassInfo)
    setWork((a.data as unknown as Work[]) ?? [])
    setLessons((l.data as LessonPick[]) ?? [])
    const signed = new Set(((e.data ?? []) as unknown as { profiles: { email: string } | null }[]).map((x) => x.profiles?.email))
    setPeople(((r.data ?? []) as { email: string; name: string }[]).map((p) => ({ ...p, signedIn: signed.has(p.email) })))
    setError(a.error?.message ?? l.error?.message ?? r.error?.message ?? null)
  }, [id, profile])

  useEffect(() => {
    load()
    const onSync = () => void load()
    window.addEventListener(ROSTER_SYNC_EVENT, onSync)
    return () => window.removeEventListener(ROSTER_SYNC_EVENT, onSync)
  }, [load])

  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>, what: string) => {
    setError(null)
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (!r.ok) setError(`${what} ${r.message ?? ''}`)
    void load()
  }

  if (missing)
    return (
      <main className="page wide">
        <TeacherBar />
        <p className="error" role="alert">Couldn't open that class. It may not be one of yours, or it was removed from Google Classroom.</p>
        <Link className="button" to="/teacher">Back to your lessons</Link>
      </main>
    )

  const assignedHere = new Set(work.map((w) => w.lessons?.id))
  const available = lessons.filter((l) => !assignedHere.has(l.id))
  const signedIn = people.filter((p) => p.signedIn).length

  return (
    <main className="page wide">
      <TeacherBar />
      <p className="crumbs"><Link to="/teacher">← Home</Link></p>
      <div className="dash-head">
        <div>
          <p className="eyebrow">Class</p>
          <h1>{cls?.name ?? 'Loading…'}</h1>
          {cls && (
            <p className="muted small">
              {people.length} student{people.length === 1 ? '' : 's'} in Google Classroom · {signedIn} signed in to Oasis
              {cls.google_synced_at && ` · synced ${new Date(cls.google_synced_at).toLocaleTimeString([], { timeStyle: 'short' })}`}
            </p>
          )}
        </div>
        <Link className="button primary" to={`/teacher/lessons/new?class=${id}`}>New lesson for this class</Link>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="dash-grid">
        <section aria-labelledby="work-h">
          <h2 id="work-h">Assigned work {work.length > 0 && <span className="count">{work.length}</span>}</h2>
          {cls && work.length === 0 && <p className="empty">Nothing assigned to this class yet. Pick one of your lessons below.</p>}
          <ul className="lesson-list" hidden={work.length === 0}>
            {work.map((w) => (
              <li key={w.id} className="lesson-item no-thumb">
                <div className="lesson-main">
                  <Link className="lesson-title" to={`/teacher/assignments/${w.id}`}>{w.lessons?.title ?? 'Lesson'}</Link>
                  <div className="assigned small plain">
                    <span className="row">
                      {w.due_at ? <span className="muted">due {new Date(w.due_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span> : <span className="muted">no due date</span>}
                      <ClassroomBadge
                        a={w}
                        busy={busy}
                        onDraft={() => void run(() => makeClassroomDraft(w.id), "The Google Classroom draft wasn't made.")}
                        onCheck={() => void run(() => checkClassroomPost(w.id), "Couldn't check Google Classroom.")}
                      />
                    </span>
                  </div>
                </div>
                <div className="lesson-actions">
                  <Link className="button" to={`/teacher/assignments/${w.id}`}>Results</Link>
                </div>
              </li>
            ))}
          </ul>

          <h2 className="spaced">Assign one of your lessons</h2>
          {lessons.length === 0 ? (
            <p className="muted">You haven't made any lessons yet.</p>
          ) : available.length === 0 ? (
            <p className="muted">Every one of your lessons is already assigned here.</p>
          ) : (
            <ul className="pick-list">
              {available.map((l) => (
                <li key={l.id}>
                  <span>
                    {l.title}
                    {l.class_id === id && <span className="tag">made for this class</span>}
                  </span>
                  <button onClick={() => setAssigning(l)}>Assign here…</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside aria-labelledby="people-h" className="dash-classes">
          <h2 id="people-h">Students</h2>
          {people.length === 0 ? (
            <p className="muted small">No students on the Google Classroom roster yet.</p>
          ) : (
            <ul className="class-list people">
              {people.map((p) => (
                <li key={p.email}>
                  <span>{p.name || p.email}</span>
                  <span className={`small ${p.signedIn ? 'ok' : 'muted'}`}>{p.signedIn ? 'Signed in' : 'Not yet'}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {assigning && cls && (
        <AssignDialog
          lesson={{ id: assigning.id, title: assigning.title, questionCount: assigning.questions[0]?.count ?? 0 }}
          classes={[{ id: cls.id, name: cls.name }]}
          assignedClassIds={new Set()}
          initialClassId={cls.id}
          onClose={() => setAssigning(null)}
          onAssigned={() => void load()}
        />
      )}
    </main>
  )
}
