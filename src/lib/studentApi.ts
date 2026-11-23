import { supabase } from './supabase'
import type { PlayerQuestion, StudentAssignmentRow, StudentLesson } from './player'

// Thin wrappers over the student RPCs (supabase/migrations/20261112000000_init.sql and later).
// Every write goes through an RPC; RLS only lets students read their own rows.

export async function listMyAssignments(): Promise<{ rows: StudentAssignmentRow[]; classCount: number }> {
  const [a, e] = await Promise.all([
    supabase
      .from('assignments')
      .select('id, due_at, created_at, lessons(title, duration_s, youtube_id), classes(name), attempts(max_watched_s, finished_at)')
      .order('created_at', { ascending: false }),
    supabase.from('enrollments').select('class_id', { count: 'exact', head: true }),
  ])
  if (a.error) throw a.error
  if (e.error) throw e.error
  return { rows: (a.data ?? []) as unknown as StudentAssignmentRow[], classCount: e.count ?? 0 }
}

export async function getStudentLesson(assignmentId: string): Promise<StudentLesson> {
  const { data, error } = await supabase.rpc('get_student_lesson', { p_assignment: assignmentId })
  if (error) throw error
  const l = data as StudentLesson
  return {
    ...l,
    duration_s: Number(l.duration_s),
    max_watched_s: Number(l.max_watched_s),
    last_pos_s: Number(l.last_pos_s),
    questions: (l.questions ?? []).map((q) => ({ ...q, at_s: Number(q.at_s) })),
  }
}

/** Class name for the player header. Best effort: the player works without it. */
export async function getAssignmentClassName(assignmentId: string): Promise<string | null> {
  const { data } = await supabase.from('assignments').select('classes(name)').eq('id', assignmentId).maybeSingle()
  return (data as { classes: { name: string } | null } | null)?.classes?.name ?? null
}

/** A question's prompt and choices, once the server agrees the student has reached it. Never the answer. */
export async function getQuestion(attemptId: string, questionId: string): Promise<PlayerQuestion> {
  const { data, error } = await supabase.rpc('get_question', { p_attempt: attemptId, p_question: questionId })
  if (error) throw error
  const q = data as PlayerQuestion
  return { ...q, at_s: Number(q.at_s) }
}

export async function saveProgress(attemptId: string, maxWatched: number, lastPos: number): Promise<void> {
  const { error } = await supabase.rpc('save_progress', { p_attempt: attemptId, p_max_watched: maxWatched, p_last_pos: lastPos })
  if (error) throw error
}

export async function submitAnswer(attemptId: string, questionId: string, response: string): Promise<void> {
  const { error } = await supabase.rpc('submit_answer', { p_attempt: attemptId, p_question: questionId, p_response: response })
  if (error) throw error
}

export async function finishAttempt(attemptId: string): Promise<void> {
  const { error } = await supabase.rpc('finish_attempt', { p_attempt: attemptId })
  if (error) throw error
}

export type FocusKind = 'exit_fullscreen' | 'tab_hidden' | 'blur' | 'no_fullscreen_support'

/** Throws on failure so the player can queue and retry: a dropped log must not mean an unrecorded exit. */
export async function sendFocusEvent(attemptId: string, kind: FocusKind, videoS: number): Promise<void> {
  const { error } = await supabase.rpc('log_focus_event', { p_attempt: attemptId, p_kind: kind, p_video_s: Math.max(0, Math.round(videoS * 10) / 10) })
  if (error) throw error
}
