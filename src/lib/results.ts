// Pure helpers for the teacher Results page. No React, no Supabase: easy to test.

export type StudentStatus = 'not_signed_in' | 'not_started' | 'in_progress' | 'finished'

export type ResultQuestion = {
  id: string
  at_s: number
  kind: 'mc' | 'short'
  prompt: string
  choices: string[] | null
  correct_index: number | null
  /** Short answers: what the teacher expects (used by AI grading). Never sent to students. */
  rubric?: string
}

export type ResultAnswer = {
  response: string
  is_correct: boolean | null
  graded_by: 'auto' | 'teacher' | 'ai' | null
  /** AI has looked at it (graded it, or left it for the teacher). */
  ai_checked?: boolean
  ai_reason?: string | null
}

export type ResultStudent = {
  student_id: string | null
  /** Optional: present if the RPC includes it; otherwise the page looks it up from `attempts`. */
  attempt_id?: string | null
  email: string
  name: string
  status: StudentStatus
  progress_pct: number
  score: number | null
  finished_at: string | null
  late: boolean
  on_roster: boolean
  focus_events: number
  answers: Record<string, ResultAnswer>
}

export type AssignmentResults = {
  assignment: {
    id: string
    due_at: string | null
    lesson_id: string
    lesson_title: string
    class_id: string
    class_name: string
    duration_s: number
    google_coursework_id: string | null
    ai_grade_short?: boolean
  }
  questions: ResultQuestion[]
  students: ResultStudent[]
}

export const STATUS_LABEL: Record<StudentStatus, string> = {
  finished: 'Finished',
  in_progress: 'In progress',
  not_started: 'Not started',
  not_signed_in: 'Never signed in',
}

export function displayName(s: Pick<ResultStudent, 'name' | 'email'>): string {
  return s.name.trim() || s.email
}

/** "12" -> 12 for MC answers. Responses are choice indexes stored as text. */
export function mcChoice(response: string | undefined): number | null {
  if (response === undefined || !/^\d+$/.test(response.trim())) return null
  return Number(response.trim())
}

/** "A", "B", ... for choice index 0, 1, ... */
export function choiceLetter(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : String(i + 1)
}

export function formatScore(score: number | null): string {
  return score === null ? '—' : `${Math.round(score)}%`
}

export type Summary = {
  total: number
  finished: number
  in_progress: number
  not_started: number
  not_signed_in: number
  /** Mean score of finished students, or null if nobody has finished. */
  average: number | null
  /** Short answers (from anyone) still waiting for a teacher grade. */
  needsGrading: number
  /** Students who left the video at least once. */
  leftTab: number
}

export function needsGrading(student: ResultStudent, questions: ResultQuestion[]): number {
  return questions.filter((q) => q.kind === 'short' && student.answers[q.id] && student.answers[q.id].is_correct === null).length
}

/** Short answers AI could still look at: ungraded and not checked by AI yet. */
export function aiPending(students: ResultStudent[], questions: ResultQuestion[]): number {
  const short = new Set(questions.filter((q) => q.kind === 'short').map((q) => q.id))
  let n = 0
  for (const st of students)
    for (const [qid, a] of Object.entries(st.answers)) if (short.has(qid) && a.is_correct === null && !a.ai_checked) n++
  return n
}

/** Grades AI wrote that the teacher hasn't confirmed or changed. */
export function aiToReview(student: ResultStudent): number {
  return Object.values(student.answers).filter((a) => a.graded_by === 'ai').length
}

export function summarize(students: ResultStudent[], questions: ResultQuestion[]): Summary {
  const s: Summary = { total: students.length, finished: 0, in_progress: 0, not_started: 0, not_signed_in: 0, average: null, needsGrading: 0, leftTab: 0 }
  let sum = 0
  let n = 0
  for (const st of students) {
    s[st.status]++
    if (st.status === 'finished' && st.score !== null) {
      sum += Number(st.score)
      n++
    }
    s.needsGrading += needsGrading(st, questions)
    if (st.focus_events > 0) s.leftTab++
  }
  s.average = n ? sum / n : null
  return s
}

export type QuestionStats = {
  question: ResultQuestion
  answered: number
  /** Answers that have a grade (MC always; short only once graded). */
  graded: number
  correct: number
  /** correct / graded as 0..100, or null if nothing is graded yet. */
  pctCorrect: number | null
  ungraded: number
  /** MC only: how many students picked each choice (same order as question.choices). */
  choiceCounts: number[]
}

export function questionStats(questions: ResultQuestion[], students: ResultStudent[]): QuestionStats[] {
  return questions.map((q) => {
    const choiceCounts = (q.choices ?? []).map(() => 0)
    let answered = 0
    let graded = 0
    let correct = 0
    for (const st of students) {
      const a = st.answers[q.id]
      if (!a) continue
      answered++
      if (a.is_correct !== null) {
        graded++
        if (a.is_correct) correct++
      }
      if (q.kind === 'mc') {
        const c = mcChoice(a.response)
        if (c !== null && c < choiceCounts.length) choiceCounts[c]++
      }
    }
    return { question: q, answered, graded, correct, pctCorrect: graded ? (100 * correct) / graded : null, ungraded: answered - graded, choiceCounts }
  })
}

export type SortKey = 'name' | 'score' | 'status'
export type SortDir = 'asc' | 'desc'

const STATUS_ORDER: Record<StudentStatus, number> = { finished: 0, in_progress: 1, not_started: 2, not_signed_in: 3 }

/** Stable sort. Students without a score always go to the bottom, whichever way scores are sorted. */
export function sortStudents(students: ResultStudent[], key: SortKey, dir: SortDir): ResultStudent[] {
  const byName = (a: ResultStudent, b: ResultStudent) =>
    displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' }) || a.email.localeCompare(b.email)
  const sign = dir === 'asc' ? 1 : -1
  return [...students].sort((a, b) => {
    if (key === 'name') return sign * byName(a, b)
    if (key === 'status') {
      return sign * (STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.progress_pct - a.progress_pct) || byName(a, b)
    }
    if (a.score === null || b.score === null) {
      if (a.score === null && b.score === null) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byName(a, b)
      return a.score === null ? 1 : -1
    }
    return sign * (Number(a.score) - Number(b.score)) || byName(a, b)
  })
}

/** RFC 4180 field: quote if it has a comma, quote, or newline; double inner quotes.
 *  Also neutralises spreadsheet formulas (=, +, -, @ at the start) since students type these answers. */
export function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function answerCell(q: ResultQuestion, a: ResultAnswer | undefined): string {
  if (!a) return ''
  let text = a.response
  if (q.kind === 'mc') {
    const c = mcChoice(a.response)
    text = c !== null ? `${choiceLetter(c)}. ${q.choices?.[c] ?? ''}`.trim() : a.response
  }
  const mark = a.is_correct === null ? 'needs grading' : a.is_correct ? 'correct' : 'incorrect'
  const by = a.graded_by === 'ai' ? ', by AI' : ''
  return `${text} (${mark}${by})`
}

export function buildCsv(data: Pick<AssignmentResults, 'questions' | 'students'>): string {
  const header = ['Name', 'Email', 'Status', 'Progress %', 'Score %', 'Late', 'Times left video', 'On roster']
  data.questions.forEach((q, i) => header.push(`Q${i + 1}: ${q.prompt}`))
  const rows = [header]
  for (const s of sortStudents(data.students, 'name', 'asc')) {
    rows.push([
      displayName(s),
      s.email,
      STATUS_LABEL[s.status],
      String(s.progress_pct),
      s.score === null ? '' : String(Math.round(Number(s.score) * 10) / 10),
      s.late ? 'yes' : 'no',
      String(s.focus_events),
      s.on_roster ? 'yes' : 'no',
      ...data.questions.map((q) => answerCell(q, s.answers[q.id])),
    ])
  }
  // CRLF + BOM so Excel opens accented names correctly; Sheets handles both.
  return '﻿' + rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n'
}

/** "Photosynthesis - Period 3.csv" with characters filesystems dislike removed. */
export function csvFilename(lessonTitle: string, className: string): string {
  const base = `${lessonTitle} - ${className}`.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim()
  return `${base || 'results'}.csv`
}
