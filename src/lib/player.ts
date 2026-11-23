// Pure rules for the student player. No React, no YouTube, so they can be unit tested.
// The server (save_progress / submit_answer / finish_attempt) is the real enforcement; these rules keep an
// honest student from ever tripping it.

export type PlayerQuestion = {
  id: string
  at_s: number
  kind: 'mc' | 'short'
  answered: boolean
  /**
   * Locked questions come without prompt/choices: the server only reveals a question once the student has
   * watched up to it (get_question). The player pauses at at_s, saves, then fetches it.
   */
  locked?: boolean
  prompt?: string
  choices?: string[] | null
}

export type StudentLesson = {
  attempt_id: string
  title: string
  youtube_id: string
  duration_s: number
  require_fullscreen: boolean
  max_watched_s: number
  last_pos_s: number
  finished_at: string | null
  questions: PlayerQuestion[]
}

/** How far the playhead may get past what's been watched before we treat it as a skip and snap back. */
export const SKIP_TOLERANCE_S = 1.5
/**
 * save_progress lets progress run at most 30s ahead of the last successful save (a refilling credit).
 * If Wi-Fi drops and saves keep failing, we pause at this lead instead of letting the student watch on and
 * then get snapped back. 20s leaves room for a 10s save interval plus a slow request.
 */
export const RECONNECT_LEAD_S = 20
/** finish_attempt accepts max_watched_s within 2s of the stored duration. */
export const FINISH_SLACK_S = 2

/** First unanswered question, in server order (at_s, then position). */
export function nextUnanswered(questions: PlayerQuestion[], answered: ReadonlySet<string>): PlayerQuestion | null {
  return questions.find((q) => !answered.has(q.id)) ?? null
}

/**
 * The question to show now, if any: the first unanswered one the student has reached.
 * Covers questions a teacher added behind a student's position after they started.
 */
export function dueQuestion(questions: PlayerQuestion[], answered: ReadonlySet<string>, reachedS: number): PlayerQuestion | null {
  const q = nextUnanswered(questions, answered)
  return q && q.at_s <= reachedS + 0.1 ? q : null
}

export type Tick = {
  /** New furthest-watched point. Never goes down, never passes the next question or the end. */
  maxWatched: number
  /** Playhead got ahead of what's been watched (a seek we didn't make): seek back to maxWatched. */
  snapBack: boolean
  /** Playhead reached the next unanswered question: pause and show it. */
  question: PlayerQuestion | null
}

export function tick(opts: {
  current: number
  maxWatched: number
  durationS: number
  questions: PlayerQuestion[]
  answered: ReadonlySet<string>
}): Tick {
  const { current, maxWatched, durationS, questions, answered } = opts
  if (!Number.isFinite(current)) return { maxWatched, snapBack: false, question: null }
  if (current > maxWatched + SKIP_TOLERANCE_S) return { maxWatched, snapBack: true, question: null }
  const gate = nextUnanswered(questions, answered)
  const cap = Math.min(durationS, gate ? gate.at_s : Infinity)
  const next = Math.max(maxWatched, Math.min(current, cap))
  return { maxWatched: next, snapBack: false, question: dueQuestion(questions, answered, Math.max(current, next)) }
}

/** The value to send to save_progress: never NaN, never past the stored length (YouTube's can be a hair longer). */
export function progressToSave(maxWatched: number, durationS: number): number {
  if (!Number.isFinite(maxWatched) || maxWatched < 0) return 0
  return Math.round(Math.min(maxWatched, durationS) * 10) / 10
}

export function needsReconnect(maxWatched: number, confirmed: number): boolean {
  return maxWatched - confirmed >= RECONNECT_LEAD_S
}

export function canFinish(maxWatched: number, durationS: number, questions: PlayerQuestion[], answered: ReadonlySet<string>): boolean {
  return maxWatched >= durationS - FINISH_SLACK_S && questions.every((q) => answered.has(q.id))
}

export type RpcErrorKind =
  | 'not_assigned'
  | 'jump_rejected'
  | 'not_finished'
  | 'unanswered'
  | 'already_answered'
  | 'not_reached'
  | 'finished'
  | 'network'
  | 'other'

/** Maps the RPCs' exception text (see supabase/migrations) to something the player can act on. */
export function classifyRpcError(err: { message?: string } | null | undefined): RpcErrorKind {
  const m = (err?.message ?? '').toLowerCase()
  if (m.includes('not assigned to you') || m.includes('not your attempt')) return 'not_assigned'
  if (m.includes('progress jump rejected')) return 'jump_rejected'
  if (m.includes('video not finished')) return 'not_finished'
  if (m.includes('unanswered questions')) return 'unanswered'
  if (m.includes('already answered')) return 'already_answered'
  if (m.includes('not reached this question')) return 'not_reached'
  if (m.includes('attempt already finished')) return 'finished'
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('load failed') || m.includes('timeout')) return 'network'
  return 'other'
}

// ---------------------------------------------------------------- assignment list

export type StudentAssignmentRow = {
  id: string
  due_at: string | null
  created_at: string
  lessons: { title: string; duration_s: number; youtube_id: string } | null
  classes: { name: string } | null
  attempts: { max_watched_s: number; finished_at: string | null }[] | null
}

export type AssignmentStatus = 'not_started' | 'in_progress' | 'done'

export function assignmentStatus(a: StudentAssignmentRow): AssignmentStatus {
  const t = a.attempts?.[0]
  if (!t) return 'not_started'
  if (t.finished_at) return 'done'
  return t.max_watched_s > 0 ? 'in_progress' : 'not_started'
}

export function progressPct(a: StudentAssignmentRow): number {
  const t = a.attempts?.[0]
  const d = a.lessons?.duration_s ?? 0
  if (!t || d <= 0) return 0
  if (t.finished_at) return 100
  return Math.max(0, Math.min(99, Math.round((100 * t.max_watched_s) / d)))
}

/** To do: soonest due first, undated last, then newest. Done: most recently finished first. */
export function splitAssignments(rows: StudentAssignmentRow[]): { todo: StudentAssignmentRow[]; done: StudentAssignmentRow[] } {
  const todo = rows.filter((r) => assignmentStatus(r) !== 'done')
  const done = rows.filter((r) => assignmentStatus(r) === 'done')
  todo.sort((a, b) => {
    if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at)
    if (a.due_at) return -1
    if (b.due_at) return 1
    return b.created_at.localeCompare(a.created_at)
  })
  done.sort((a, b) => (b.attempts?.[0]?.finished_at ?? '').localeCompare(a.attempts?.[0]?.finished_at ?? ''))
  return { todo, done }
}

/** "Due today 3:00 PM", "Due tomorrow", "Due Fri", "Due Nov 30", "Was due Nov 20". */
export function dueLabel(dueIso: string | null, now: Date = new Date()): { text: string; late: boolean } | null {
  if (!dueIso) return null
  const due = new Date(dueIso)
  if (Number.isNaN(due.getTime())) return null
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(due) - day(now)) / 86_400_000)
  const time = due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const date = due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (due.getTime() < now.getTime()) return { text: `Was due ${days === 0 ? `today ${time}` : date}`, late: true }
  if (days === 0) return { text: `Due today ${time}`, late: false }
  if (days === 1) return { text: `Due tomorrow ${time}`, late: false }
  if (days < 7) return { text: `Due ${due.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`, late: false }
  return { text: `Due ${date}`, late: false }
}
