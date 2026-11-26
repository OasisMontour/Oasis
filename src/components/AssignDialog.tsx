import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { createAssignment, DEFAULT_INSTRUCTIONS, localNow, makeClassroomDraft, type ClassroomState } from '../lib/assign'

export type AssignClass = { id: string; name: string }

/**
 * Assignment setup (beta item 9): class, due date and instructions, then an unpublished Google Classroom draft
 * (item 10). Opens straight after a new lesson's first save with the lesson's class picked, and from the dashboard.
 */
export function AssignDialog({
  lesson,
  classes,
  assignedClassIds,
  initialClassId,
  onClose,
  onAssigned,
}: {
  lesson: { id: string; title: string; questionCount: number }
  classes: AssignClass[]
  assignedClassIds: ReadonlySet<string>
  initialClassId?: string | null
  onClose: () => void
  onAssigned?: () => void
}) {
  const open = classes.filter((c) => !assignedClassIds.has(c.id))
  const [classId, setClassId] = useState(initialClassId && open.some((c) => c.id === initialClassId) ? initialClassId : (open[0]?.id ?? ''))
  const [due, setDue] = useState('')
  const [instructions, setInstructions] = useState(DEFAULT_INSTRUCTIONS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ assignmentId: string; state: ClassroomState | null; url: string | null; classroomError?: string } | null>(null)
  const firstRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!classId || busy) return
    setBusy(true)
    setError(null)
    const r = await createAssignment(lesson.id, classId, due, instructions)
    if ('error' in r) {
      setBusy(false)
      return setError(r.error)
    }
    const c = await makeClassroomDraft(r.id)
    setBusy(false)
    onAssigned?.()
    setDone(c.ok ? { assignmentId: r.id, state: c.state, url: c.url } : { assignmentId: r.id, state: null, url: null, classroomError: c.message })
  }

  const retry = async () => {
    if (!done) return
    setBusy(true)
    const c = await makeClassroomDraft(done.assignmentId)
    setBusy(false)
    onAssigned?.()
    setDone(c.ok ? { ...done, state: c.state, url: c.url, classroomError: undefined } : { ...done, classroomError: c.message })
  }

  const className = classes.find((c) => c.id === classId)?.name ?? 'the class'

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="assign-h">
        <h2 id="assign-h">{done ? 'Assigned' : `Assign “${lesson.title}”`}</h2>
        {!done ? (
          open.length === 0 ? (
            <>
              <p className="muted">
                {classes.length === 0
                  ? 'No classes yet. Your classes come from Google Classroom: connect it in Settings.'
                  : "It's already assigned to every one of your classes."}
              </p>
              <div className="row end">
                {classes.length === 0 && <Link className="button" to="/teacher/settings">Settings</Link>}
                <button onClick={onClose}>Close</button>
              </div>
            </>
          ) : (
            <form className="stack" onSubmit={submit}>
              <label className="stack-tight">
                Class
                <select ref={firstRef} value={classId} onChange={(e) => setClassId(e.target.value)} disabled={busy}>
                  {open.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="stack-tight">
                Due <span className="muted small">(optional, your time zone)</span>
                <input type="datetime-local" className="text" value={due} min={localNow()} onChange={(e) => setDue(e.target.value)} disabled={busy} />
              </label>
              <label className="stack-tight">
                Instructions for students
                <textarea rows={3} maxLength={2000} value={instructions} onChange={(e) => setInstructions(e.target.value)} disabled={busy} />
              </label>
              <p className="muted small">
                Oasis makes an unpublished draft in Google Classroom with the title, these instructions, the student link and the due date.
                You pick a Classwork topic and post it in Classroom. Nothing reaches students until you do.
              </p>
              {lesson.questionCount === 0 && <p className="error small">This lesson has no questions yet. Students will only watch the video.</p>}
              {error && <p className="error" role="alert">{error}</p>}
              <div className="row end">
                <button type="button" onClick={onClose} disabled={busy}>Not now</button>
                <button className="primary" disabled={busy || !classId}>{busy ? 'Making the draft…' : 'Assign and make Classroom draft'}</button>
              </div>
            </form>
          )
        ) : (
          <div className="stack" role="status">
            {done.state === 'DRAFT' ? (
              <>
                <p className="ok">Assigned in Oasis, and a draft is waiting in Google Classroom for {className}.</p>
                <ol className="small">
                  <li>Open the class in Google Classroom and go to <b>Classwork</b>.</li>
                  <li>Open the draft “{lesson.title}”, pick a <b>topic</b>, check the due date.</li>
                  <li>Press <b>Assign</b> in Classroom. That's when students see it.</li>
                </ol>
                {done.url && (
                  <a className="button primary" href={done.url} target="_blank" rel="noreferrer">
                    Open {className} in Google Classroom
                  </a>
                )}
              </>
            ) : done.state ? (
              <p className="ok">Assigned. It was already in Google Classroom.</p>
            ) : (
              <>
                <p className="error" role="alert">
                  Assigned in Oasis, but the Classroom draft wasn't made. {done.classroomError}
                </p>
                <button onClick={() => void retry()} disabled={busy}>{busy ? 'Trying…' : 'Try the Classroom draft again'}</button>
              </>
            )}
            <div className="row end">
              <Link className="button" to={`/teacher/assignments/${done.assignmentId}`}>See results page</Link>
              <button onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
