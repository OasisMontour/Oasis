import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatTime } from '../lib/time'
import { aiRunMessage, runAiGrading, type AiBatch } from '../lib/aiGrade'
import {
  STATUS_LABEL,
  aiPending,
  aiToReview,
  buildCsv,
  choiceLetter,
  csvFilename,
  displayName,
  formatScore,
  mcChoice,
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
  const pendingGrades = useRef(0)
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
    const { data: score, error: err } = await supabase.rpc('grade_answer', { p_attempt: attempt, p_question: questionId, p_correct: correct })
    pendingGrades.current--
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

  const exportCsv = () => {
    if (!data) return
    const url = URL.createObjectURL(new Blob([buildCsv(data)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = csvFilename(data.assignment.lesson_title, data.assignment.class_name)
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const sendGrades = async () => {
    if (!id || sending) return
    setSending(true)
    setNotice(null)
    setInfo(null)
    const { data: res, error: err } = await supabase.functions.invoke<
      | { ok: true; pushed: number; not_in_classroom: string[]; needs_grading?: string[]; failed: { email: string; error: string }[] }
      | { ok: false; error: string }
    >('classroom', { body: { action: 'push_grades', assignment_id: id } })
    setSending(false)
    if (err || !res) return setNotice(`Couldn't send grades to Google Classroom. ${err?.message ?? ''}`.trim())
    if (!res.ok) {
      if (res.error === 'reconnect' || res.error === 'not_connected')
        return setNotice('Google Classroom needs to be reconnected. Click Connect Google Classroom on your dashboard, then try again.')
      if (res.error === 'not_posted') return setNotice("This assignment hasn't been posted to Google Classroom yet.")
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
        const { data: res, error: err } = await supabase.functions.invoke<AiBatch>('ai-grade', { body: { assignment_id: id } })
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

  return (
    <main className="page results">
      <BackLink />
      <div className="section-head results-head">
        <div>
          <h1>{assignment.lesson_title}</h1>
          <p className="muted">
            {assignment.class_name} · {due ? `Due ${due}` : 'No due date'} · {questions.length} question{questions.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="row">
          {aiLeft > 0 && (
            <button onClick={gradeWithAi} disabled={!!aiRunning} title="AI suggests a grade for each short answer. You can change any of them.">
              {aiRunning ?? `Grade ${aiLeft} with AI`}
            </button>
          )}
          {assignment.google_coursework_id && students.some((s) => s.status === 'finished') && (
            <button onClick={sendGrades} disabled={sending}>{sending ? 'Sending…' : 'Send grades to Classroom'}</button>
          )}
          <button onClick={exportCsv} disabled={students.length === 0}>Export CSV</button>
        </div>
      </div>
      {info && <p className="muted" role="status">{info}</p>}
      {notice && <p className="error" role="alert">{notice}</p>}

      <ul className="stats" aria-label="Summary">
        <Stat n={summary.finished} label="Finished" of={summary.total} />
        <Stat n={summary.in_progress} label="In progress" />
        <Stat n={summary.not_started} label="Not started" />
        <Stat n={summary.not_signed_in} label="Never signed in" />
        <Stat n={summary.average === null ? '—' : formatScore(summary.average)} label="Class average" hint={summary.average === null ? 'nobody finished yet' : 'finished students'} />
        <li className={`stat${summary.needsGrading ? ' attention' : ''}`}>
          <strong>{summary.needsGrading}</strong>
          <span>To grade</span>
          {summary.needsGrading > 0 && (
            <button className="small" aria-pressed={onlyToGrade} onClick={() => setOnlyToGrade((v) => !v)}>
              {onlyToGrade ? 'Show everyone' : 'Show these'}
            </button>
          )}
        </li>
      </ul>

      <section>
        <h2>Students</h2>
        {students.length === 0 ? (
          <p className="muted">No students in this class yet. They come from Google Classroom: sync it from your dashboard.</p>
        ) : (
          <div className="table-wrap">
            <table className="results-table">
              <thead>
                <tr>
                  {sortHeader('name', 'Student')}
                  {sortHeader('status', 'Status')}
                  {sortHeader('score', 'Score')}
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={4} className="muted">Nothing left to grade.</td></tr>
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

      <section>
        <h2>By question</h2>
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
                    <span className="muted small">Q{i + 1} · {formatTime(q.at_s)} · {q.kind === 'mc' ? 'Multiple choice' : 'Short answer'}</span>
                    <span className="pct">
                      {st.pctCorrect === null ? <span className="muted">No answers yet</span> : <><strong>{Math.round(st.pctCorrect)}%</strong> correct</>}
                    </span>
                  </div>
                  <p className="prompt">{q.prompt}</p>
                  {missed && <p className="missed-note">Most students missed this one.</p>}
                  {q.kind === 'mc' ? (
                    <ul className="dist" aria-label={`Answers picked for question ${i + 1}`}>
                      {(q.choices ?? []).map((c, ci) => {
                        const n = st.choiceCounts[ci] ?? 0
                        const pct = st.answered ? (100 * n) / st.answered : 0
                        const right = ci === q.correct_index
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
      </section>
    </main>
  )
}

function BackLink() {
  return <p className="back"><Link to="/teacher">← Back to dashboard</Link></p>
}

function Stat({ n, label, of, hint }: { n: number | string; label: string; of?: number; hint?: string }) {
  return (
    <li className="stat">
      <strong>{n}{of !== undefined && <span className="of"> / {of}</span>}</strong>
      <span>{label}</span>
      {hint && <span className="muted small">{hint}</span>}
    </li>
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
