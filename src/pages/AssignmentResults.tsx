import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { invokeFn } from '../lib/invokeFn'
import { formatTime } from '../lib/time'
import { aiRunMessage, runAiGrading, type AiBatch } from '../lib/aiGrade'
import {
  STATUS_LABEL,
  aiPending,
  aiToReview,
  averageHint,
  buildCsv,
  choiceLetter,
  choiceLetters,
  completion,
  csvFilename,
  displayName,
  formatScore,
  gradesBusy,
  mcChoice,
  multiChoices,
  needsGrading,
  questionStats,
  sortStudents,
  summarize,
  type AssignmentResults as Results,
  type ResultQuestion,
  type ResultStudent,
  type SortDir,
  type SortKey,
} from '../lib/results'
import { classroomStatus, type ClassroomState } from '../lib/assign'

const studentKey = (s: ResultStudent) => s.student_id ?? `email:${s.email}`

export function AssignmentResults() {
  const { id } = useParams()
  const [data, setData] = useState<Results | null>(null)
  const [attemptIds, setAttemptIds] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [aiRunning, setAiRunning] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' })
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [onlyToGrade, setOnlyToGrade] = useState(false)
  const [cw, setCw] = useState<{ state: ClassroomState | null; url: string | null }>({ state: null, url: null })
  const pendingGrades = useRef(0)
  // Same count as state, so Export and Send can wait for grade saves to land.
  const [savingGrades, setSavingGrades] = useState(0)
  const loadSeq = useRef(0)

  const load = useCallback(
    async (silent = false) => {
      if (!id) return
      const seq = ++loadSeq.current
      if (!silent) setLoading(true)
      const { data: res, error: err } = await supabase.rpc('assignment_results', { p_assignment: id })
      // Drop stale responses, and don't clobber an optimistic grade that is still in flight.
      if (seq !== loadSeq.current || (silent && pendingGrades.current > 0)) return
      setLoading(false)
      if (err || !res) {
        if (!silent) setError(err?.message.includes('not your assignment') ? "This assignment doesn't exist or isn't one of yours." : "Couldn't load results. Check your connection and refresh.")
        return
      }
      const r = res as Results
      setData(r)
      setError(null)
      // Draft or posted in Classroom (beta item 10). Not in the results payload; best effort.
      const { data: st } = await supabase.from('assignments').select('google_coursework_state, google_coursework_url').eq('id', id).maybeSingle()
      if (st) setCw({ state: (st as { google_coursework_state: ClassroomState | null }).google_coursework_state, url: (st as { google_coursework_url: string | null }).google_coursework_url })
      // grade_answer needs the attempt id. Use it from the payload when present, otherwise look it up.
      if (r.students.some((s) => s.student_id && s.attempt_id === undefined && Object.keys(s.answers).length > 0)) {
        const { data: rows } = await supabase.from('attempts').select('id, student_id').eq('assignment_id', id)
        if (rows) setAttemptIds(Object.fromEntries((rows as { id: string; student_id: string }[]).map((t) => [t.student_id, t.id])))
      }
    },
    [id],
  )

  useEffect(() => {
    load()
  }, [load])

  const grade = async (student: ResultStudent, questionId: string, correct: boolean) => {
    const attempt = student.attempt_id ?? (student.student_id ? attemptIds[student.student_id] : undefined)
    if (!attempt) return setNotice("Couldn't save that grade (missing attempt). Refresh and try again.")
    const key = studentKey(student)
    const patch = (fn: (s: ResultStudent) => ResultStudent) =>
      setData((d) => d && { ...d, students: d.students.map((s) => (studentKey(s) === key ? fn(s) : s)) })
    const before = student.answers[questionId]
    patch((s) => ({ ...s, answers: { ...s.answers, [questionId]: { ...s.answers[questionId], is_correct: correct, graded_by: 'teacher' } } }))
    setNotice(null)
    pendingGrades.current++
    setSavingGrades((n) => n + 1)
    const { data: score, error: err } = await supabase.rpc('grade_answer', { p_attempt: attempt, p_question: questionId, p_correct: correct })
    pendingGrades.current--
    setSavingGrades((n) => n - 1)
    if (err) {
      patch((s) => ({ ...s, answers: { ...s.answers, [questionId]: before } }))
      setNotice(`Couldn't save the grade for ${displayName(student)}. Try again.`)
      return
    }
    // The database only stores the score once the student has finished.
    patch((s) => (s.status === 'finished' && typeof score === 'number' ? { ...s, score } : s))
    if (pendingGrades.current === 0) load(true)
  }

  const summary = useMemo(() => data && summarize(data.students, data.questions), [data])
  const stats = useMemo(() => data && questionStats(data.questions, data.students), [data])
  const rows = useMemo(() => {
    if (!data) return []
    const list = onlyToGrade ? data.students.filter((s) => needsGrading(s, data.questions) > 0) : data.students
    return sortStudents(list, sort.key, sort.dir)
  }, [data, sort, onlyToGrade])

  const toggle = (key: string) =>
    setOpen((o) => {
      const n = new Set(o)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'score' ? 'desc' : 'asc' }))

  const busy = gradesBusy(savingGrades, !!aiRunning)

  const exportCsv = () => {
    if (!data || busy) return
    const url = URL.createObjectURL(new Blob([buildCsv(data)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = csvFilename(data.assignment.lesson_title, data.assignment.class_name)
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const sendGrades = async () => {
    if (!id || sending || busy) return
    setSending(true)
    setNotice(null)
    setInfo(null)
    const { data: res, error: err } = await invokeFn<
      | { ok: true; pushed: number; not_in_classroom: string[]; needs_grading?: string[]; failed: { email: string; error: string }[] }
      | { ok: false; error: string; url?: string | null }
    >('classroom', { action: 'push_grades', assignment_id: id })
    setSending(false)
    if (err || !res) return setNotice(`Couldn't send grades to Google Classroom. ${err?.message ?? ''}`.trim())
    if (!res.ok) {
      if (res.error === 'reconnect' || res.error === 'not_connected')
        return setNotice('Google Classroom needs to be reconnected. Open Settings, connect Google Classroom, then try again.')
      if (res.error === 'not_posted') return setNotice("This assignment isn't in Google Classroom yet. Make the Classroom draft from your dashboard first.")
      if (res.error === 'not_published') {
        setCw((c) => ({ state: 'DRAFT', url: res.url ?? c.url }))
        return setNotice("It's still a draft in Google Classroom. Pick a topic and post it there, then send grades again.")
      }
      if (res.error === 'deleted_in_classroom') {
        setCw((c) => ({ ...c, state: 'DELETED' }))
        return setNotice('This assignment was deleted in Google Classroom, so there is nowhere to send grades. Export a CSV instead.')
      }
      return setNotice(`Couldn't send grades to Google Classroom: ${res.error}`)
    }
    let text = `Sent ${res.pushed} grade${res.pushed === 1 ? '' : 's'} to Google Classroom.`
    const m = res.not_in_classroom.length
    if (m) text += ` ${m} student${m === 1 ? " isn't" : "s aren't"} in the Classroom course.`
    const g = res.needs_grading?.length ?? 0
    if (g) text += ` Held back ${g} student${g === 1 ? '' : 's'} with short answers still to grade. Grade them here, then send again.`
    const f = res.failed.length
    if (f) text += ` ${f} failed: ${res.failed.map((x) => x.email).join(', ')}.`
    text += ' Press Return in Classroom for students to see their grades.'
    setInfo(text)
  }

  const gradeWithAi = async () => {
    if (!id || aiRunning) return
    setNotice(null)
    setInfo(null)
    setAiRunning('Grading with AI…')
    const run = await runAiGrading(
      async () => {
        const { data: res, error: err } = await invokeFn<AiBatch>('ai-grade', { assignment_id: id })
        return err || !res ? null : res
      },
      (p) => {
        setAiRunning(`Grading with AI… ${p.graded + p.unsure + p.skipped} done`)
        load(true)
      },
    )
    setAiRunning(null)
    await load(true)
    const msg = aiRunMessage(run)
    if (msg.isError) setNotice(msg.text)
    else setInfo(msg.text)
  }

  if (loading && !data) return <main className="page results"><BackLink /><p className="muted" role="status">Loading results…</p></main>
  if (!data || !summary || !stats) {
    return (
      <main className="page results">
        <BackLink />
        <p className="error" role="alert">{error ?? "Couldn't load results."}</p>
        <button onClick={() => load()}>Try again</button>
      </main>
    )
  }

  const { assignment, questions, students } = data
  const aiLeft = assignment.ai_grade_short ? aiPending(students, questions) : 0
  const due = assignment.due_at ? new Date(assignment.due_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null
  const sortHeader = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button className="sort" onClick={() => sortBy(key)}>
        {label} <span aria-hidden="true">{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  )

  const done = completion(summary)
  const cwStatus = classroomStatus({ google_coursework_id: assignment.google_coursework_id, google_coursework_state: cw.state })
  const anyFinished = students.some((s) => s.status === 'finished')
  const seg = (n: number) => (summary.total ? `${(100 * n) / summary.total}%` : '0%')

  return (
    <main className="page results">
      <BackLink classId={assignment.class_id} className={assignment.class_name} />
      <div className="section-head results-head">
        <div>
          <h1>{assignment.lesson_title}</h1>
          <p className="muted">
            {assignment.class_name} · {due ? `Due ${due}` : 'No due date'} · {questions.length} question{questions.length === 1 ? '' : 's'}
          </p>
        </div>
        <button onClick={exportCsv} disabled={students.length === 0 || !!busy} title={busy ?? undefined}>Export CSV</button>
      </div>
      {busy && savingGrades > 0 && <p className="muted small" role="status">{busy} Export and Send wait until it's done.</p>}
      {info && <p className="muted" role="status">{info}</p>}
      {notice && <p className="error" role="alert">{notice}</p>}

      {/* Beta item 12: the two things a teacher opens this page for, first. */}
      <div className="r-top">
        <section className="r-card" aria-labelledby="done-h">
          <h2 id="done-h" className="r-label">Completion</h2>
          <p className="r-big">
            {done.done}<span className="of"> / {done.total} finished</span>
          </p>
          <div className="r-bar" role="img" aria-label={`${summary.finished} finished, ${summary.in_progress} in progress, ${summary.not_started} not started, ${summary.not_signed_in} never signed in`}>
            <span className="finished" style={{ width: seg(summary.finished) }} />
            <span className="in_progress" style={{ width: seg(summary.in_progress) }} />
            <span className="not_started" style={{ width: seg(summary.not_started) }} />
          </div>
          <ul className="r-legend small">
            <li><span className="dot in_progress" aria-hidden="true" />{summary.in_progress} in progress</li>
            <li><span className="dot not_started" aria-hidden="true" />{summary.not_started} not started</li>
            <li><span className="dot not_signed_in" aria-hidden="true" />{summary.not_signed_in} never signed in</li>
          </ul>
          <p className="muted small">
            Class average {summary.average === null ? '—' : formatScore(summary.average)}
            {` (${averageHint(summary)})`}
            {summary.leftTab > 0 && ` · ${summary.leftTab} left the video at least once`}
          </p>
        </section>

        <section className={`r-card${summary.needsGrading ? ' attention' : ''}`} aria-labelledby="todo-h">
          <h2 id="todo-h" className="r-label">Needs you</h2>
          <ul className="r-todo">
            {summary.needsGrading > 0 ? (
              <li>
                <span><strong>{summary.needsGrading}</strong> short answer{summary.needsGrading === 1 ? '' : 's'} to grade</span>
                <span className="row">
                  <button className="small" aria-pressed={onlyToGrade} onClick={() => setOnlyToGrade((v) => !v)}>
                    {onlyToGrade ? 'Show everyone' : 'Show these students'}
                  </button>
                  {aiLeft > 0 && (
                    <button className="small" onClick={gradeWithAi} disabled={!!aiRunning} title="AI suggests a grade for each short answer. You can change any of them.">
                      {aiRunning ?? `Grade ${aiLeft} with AI`}
                    </button>
                  )}
                </span>
              </li>
            ) : onlyToGrade ? (
              <li>
                <span className="muted">All graded.</span>
                <button className="small" onClick={() => setOnlyToGrade(false)}>Show everyone</button>
              </li>
            ) : (
              <li className="muted">Nothing to grade{anyFinished ? '. Choice questions are scored for you.' : ' yet.'}</li>
            )}
            {cwStatus === 'DRAFT' && (
              <li>
                <span>Still a draft in Google Classroom, so students can't see it there.</span>
                {cw.url && <a href={cw.url} target="_blank" rel="noreferrer">Pick a topic and post</a>}
              </li>
            )}
            {cwStatus === 'DELETED' && <li><span>Deleted in Google Classroom. Export a CSV for your gradebook.</span></li>}
            {cwStatus === 'PUBLISHED' && anyFinished && (
              <li>
                <span>Send finished scores to Google Classroom.</span>
                <button className="small primary" onClick={sendGrades} disabled={sending || !!busy} title={busy ?? undefined}>{sending ? 'Sending…' : 'Send grades'}</button>
              </li>
            )}
          </ul>
        </section>
      </div>

      <section>
        <h2>Students <span className="muted small">· open a name to see every answer</span></h2>
        {students.length === 0 ? (
          <p className="muted">No students in this class yet. They come from Google Classroom: they appear here after the next roster sync.</p>
        ) : (
          <div className="table-wrap">
            <table className="results-table">
              <thead>
                <tr>
                  {sortHeader('name', 'Student')}
                  {sortHeader('status', 'Status')}
                  {sortHeader('score', 'Score')}
                  <th scope="col"><span className="sr-only">Flags</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      Nothing left to grade.{' '}
                      {onlyToGrade && <button className="small" onClick={() => setOnlyToGrade(false)}>Show everyone</button>}
                    </td>
                  </tr>
                )}
                {rows.map((s) => {
                  const key = studentKey(s)
                  const isOpen = open.has(key)
                  const toGrade = needsGrading(s, questions)
                  const aiGraded = aiToReview(s)
                  return (
                    <Fragment key={key}>
                      <tr className={`${isOpen ? 'open' : ''}${s.on_roster ? '' : ' gone'}`}>
                        <th scope="row">
                          <button className="student" aria-expanded={isOpen} aria-controls={`ans-${key}`} onClick={() => toggle(key)}>
                            <span className="chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                            <span>
                              <span className="name">{displayName(s)}</span>
                              {s.name.trim() && <span className="muted small email">{s.email}</span>}
                            </span>
                          </button>
                        </th>
                        <td><StatusCell s={s} /></td>
                        <td className="score">{formatScore(s.score)}</td>
                        <td>
                          <span className="row tags">
                            {s.late && <span className="tag late">{s.status === 'finished' ? 'Late' : 'Past due'}</span>}
                            {s.focus_events > 0 && (
                              <span className="tag warn" title="Switched tabs, clicked away, or left fullscreen while watching">
                                Left the video {s.focus_events}×
                              </span>
                            )}
                            {toGrade > 0 && <span className="tag grade">{toGrade} to grade</span>}
                            {aiGraded > 0 && <span className="tag ai" title="Graded by AI. Open to check or change.">{aiGraded} AI-graded</span>}
                            {!s.on_roster && <span className="tag gone" title="Not on the Google Classroom roster anymore">No longer in class</span>}
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="answers-row" id={`ans-${key}`}>
                          <td colSpan={4}>
                            <StudentAnswers student={s} questions={questions} onGrade={grade} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details className="r-more">
        <summary><h2>By question</h2> <span className="muted small">which questions the class missed</span></summary>
        {questions.length === 0 ? (
          <p className="muted">This lesson has no questions. <Link to={`/teacher/lessons/${assignment.lesson_id}`}>Add some</Link>.</p>
        ) : (
          <ol className="qstats">
            {stats.map((st, i) => {
              const q = st.question
              const missed = st.pctCorrect !== null && st.graded >= 3 && st.pctCorrect < 50
              return (
                <li key={q.id} className={`card${missed ? ' missed' : ''}`}>
                  <div className="qhead">
                    <span className="muted small">Q{i + 1} · {formatTime(q.at_s)} · {KIND_LABEL[q.kind]}</span>
                    <span className="pct">
                      {st.pctCorrect === null ? <span className="muted">No answers yet</span> : <><strong>{Math.round(st.pctCorrect)}%</strong> correct</>}
                    </span>
                  </div>
                  <p className="prompt">{q.prompt}</p>
                  {missed && <p className="missed-note">Most students missed this one.</p>}
                  {q.kind !== 'short' ? (
                    <ul className="dist" aria-label={`Answers picked for question ${i + 1}`}>
                      {(q.choices ?? []).map((c, ci) => {
                        const n = st.choiceCounts[ci] ?? 0
                        const pct = st.answered ? (100 * n) / st.answered : 0
                        const right = q.kind === 'multi' ? !!q.correct_indexes?.includes(ci) : ci === q.correct_index
                        return (
                          <li key={ci} className={right ? 'right' : ''}>
                            <span className="choice">
                              {choiceLetter(ci)}. {c}
                              {right && <span className="sr-only"> (correct answer)</span>}
                              {right && <span className="ok small" aria-hidden="true"> ✓ correct</span>}
                            </span>
                            <span className="meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                            <span className="count small">{n}</span>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="muted small">
                      {st.answered} answered{st.graded ? ` · ${st.correct} of ${st.graded} graded correct` : ''}
                      {st.ungraded > 0 && <> · <strong className="grade-text">{st.ungraded} to grade</strong></>}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </details>
    </main>
  )
}

const KIND_LABEL: Record<ResultQuestion['kind'], string> = { mc: 'Multiple choice', multi: 'Select all', short: 'Short answer' }

function BackLink({ classId, className }: { classId?: string; className?: string }) {
  return (
    <p className="back">
      <Link to="/teacher">← Home</Link>
      {classId && <> · <Link to={`/teacher/classes/${classId}`}>{className}</Link></>}
    </p>
  )
}

function StatusCell({ s }: { s: ResultStudent }) {
  if (s.status === 'in_progress') {
    return (
      <span className="status in_progress">
        <span className="dot" aria-hidden="true" />
        In progress · {s.progress_pct}%
        <span className="mini-bar" aria-hidden="true"><span style={{ width: `${s.progress_pct}%` }} /></span>
      </span>
    )
  }
  return (
    <span className={`status ${s.status}`}>
      <span className="dot" aria-hidden="true" />
      {STATUS_LABEL[s.status]}
    </span>
  )
}

function StudentAnswers({
  student,
  questions,
  onGrade,
}: {
  student: ResultStudent
  questions: ResultQuestion[]
  onGrade: (s: ResultStudent, questionId: string, correct: boolean) => void
}) {
  if (questions.length === 0) return <p className="muted small">This lesson has no questions.</p>
  return (
    <ol className="answers">
      {questions.map((q, i) => {
        const a = student.answers[q.id]
        const verdict = a?.is_correct === true ? 'correct' : a?.is_correct === false ? 'incorrect' : a ? 'ungraded' : 'none'
        return (
          <li key={q.id} className={`answer ${verdict}`}>
            <div className="muted small">Q{i + 1} · {formatTime(q.at_s)}</div>
            <div className="prompt">{q.prompt}</div>
            {!a ? (
              <div className="muted small">No answer yet</div>
            ) : q.kind === 'mc' ? (
              <McAnswer q={q} response={a.response} correct={a.is_correct === true} />
            ) : q.kind === 'multi' ? (
              <MultiAnswer q={q} response={a.response} correct={a.is_correct === true} />
            ) : (
              <>
                <blockquote className="short">{a.response}</blockquote>
                {a.ai_reason && (
                  <p className="small ai-note">
                    <span className="tag ai">AI</span>{' '}
                    {a.graded_by === 'ai' ? '' : a.is_correct === null ? "wasn't sure: " : 'said: '}
                    {a.ai_reason}
                  </p>
                )}
                <div className="row grade-row">
                  <span className={`small verdict ${verdict}`}>
                    {verdict === 'ungraded' ? 'Needs grading' : verdict === 'correct' ? '✓ Marked correct' : '✗ Marked incorrect'}
                    {a.graded_by === 'ai' && ' by AI'}
                  </span>
                  {a.graded_by === 'ai' && a.is_correct !== null && (
                    <button className="small" onClick={() => onGrade(student, q.id, a.is_correct as boolean)}>Looks right</button>
                  )}
                  <button className="small good" aria-pressed={a.is_correct === true} onClick={() => onGrade(student, q.id, true)} disabled={a.is_correct === true}>
                    Correct
                  </button>
                  <button className="small bad" aria-pressed={a.is_correct === false} onClick={() => onGrade(student, q.id, false)} disabled={a.is_correct === false}>
                    Incorrect
                  </button>
                </div>
              </>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function McAnswer({ q, response, correct }: { q: ResultQuestion; response: string; correct: boolean }) {
  const picked = mcChoice(response)
  const label = (i: number | null) => (i === null ? response : `${choiceLetter(i)}. ${q.choices?.[i] ?? '?'}`)
  return (
    <div className="small">
      {correct ? (
        <span className="ok">✓ {label(picked)}</span>
      ) : (
        <>
          <span className="error">✗ Picked {label(picked)}</span>
          {q.correct_index !== null && <span className="muted"> · Correct: {label(q.correct_index)}</span>}
        </>
      )}
    </div>
  )
}

function MultiAnswer({ q, response, correct }: { q: ResultQuestion; response: string; correct: boolean }) {
  const picked = multiChoices(response)
  const key = q.correct_indexes ?? []
  return (
    <div className="small">
      {correct ? (
        <span className="ok">✓ Picked {choiceLetters(picked)}</span>
      ) : (
        <>
          <span className="error">✗ Picked {choiceLetters(picked)}</span>
          {key.length > 0 && <span className="muted"> · Right set: {choiceLetters(key)}</span>}
        </>
      )}
    </div>
  )
}
