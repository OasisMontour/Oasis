import { invokeFn } from './invokeFn'
import { supabase } from './supabase'

// Assigning a lesson to a class, and handing it to Google Classroom as an unpublished DRAFT (beta items 9 + 10).
// Oasis never publishes in Classroom: the teacher picks a Classwork topic there and presses Assign.

export const DEFAULT_INSTRUCTIONS = 'Video lesson in Oasis. Open the link, watch the whole video, and answer the questions as they come up.'

export type ClassroomState = 'DRAFT' | 'PUBLISHED' | 'DELETED'

export type AssignmentLink = {
  id: string
  class_id: string
  due_at: string | null
  google_coursework_id: string | null
  google_coursework_state: ClassroomState | null
  google_coursework_url: string | null
}

/** How an assignment stands in Classroom. Null state with an id = posted before drafts existed (published). */
export function classroomStatus(a: Pick<AssignmentLink, 'google_coursework_id' | 'google_coursework_state'>): 'none' | ClassroomState {
  if (!a.google_coursework_id) return 'none'
  return a.google_coursework_state ?? 'PUBLISHED'
}

/** Now as a datetime-local value ("2026-11-23T08:05") in the teacher's time zone. */
export function localNow(d = new Date()): string {
  const t = new Date(d)
  t.setMinutes(t.getMinutes() - t.getTimezoneOffset())
  return t.toISOString().slice(0, 16)
}

type PostResult = { ok: true; coursework_id: string; state?: ClassroomState; url?: string | null; already?: boolean } | { ok: false; error: string }

export function classroomError(code: string | undefined): string {
  if (code === 'not_connected' || code === 'reconnect') return 'Connect Google Classroom in Settings, then try again.'
  if (code === 'not_configured') return 'Oasis server setup is missing APP_ORIGIN.'
  return code ?? ''
}

/** Creates the Classroom draft for an Oasis assignment. Safe to retry: the server reuses an existing draft. */
export async function makeClassroomDraft(assignmentId: string): Promise<{ ok: true; state: ClassroomState; url: string | null } | { ok: false; message: string }> {
  const { data, error } = await invokeFn<PostResult>('classroom', { action: 'post', assignment_id: assignmentId })
  if (error || !data) return { ok: false, message: error?.message ?? "Couldn't reach Oasis." }
  if (!data.ok) return { ok: false, message: classroomError(data.error) }
  return { ok: true, state: data.state ?? 'PUBLISHED', url: data.url ?? null }
}

/** Asks Classroom whether the teacher has posted the draft yet. */
export async function checkClassroomPost(assignmentId: string): Promise<{ ok: true; state: ClassroomState; url: string | null } | { ok: false; message: string }> {
  const { data, error } = await invokeFn<{ ok: true; state: ClassroomState; url: string | null } | { ok: false; error: string }>('classroom', {
    action: 'post_status',
    assignment_id: assignmentId,
  })
  if (error || !data) return { ok: false, message: error?.message ?? "Couldn't reach Oasis." }
  if (!data.ok) return { ok: false, message: classroomError(data.error) }
  return data
}

/** Creates the Oasis assignment. The Classroom draft is a second step so a Classroom failure is retryable. */
export async function createAssignment(lessonId: string, classId: string, dueLocal: string, instructions: string): Promise<{ id: string } | { error: string }> {
  if (dueLocal && new Date(dueLocal).getTime() < Date.now()) return { error: 'That due date has already passed. Pick a time in the future.' }
  const text = instructions.trim()
  const { data, error } = await supabase
    .from('assignments')
    .insert({
      lesson_id: lessonId,
      class_id: classId,
      due_at: dueLocal ? new Date(dueLocal).toISOString() : null,
      instructions: text === DEFAULT_INSTRUCTIONS ? '' : text.slice(0, 2000),
    })
    .select('id')
    .single()
  if (error) return { error: /duplicate|unique/i.test(error.message) ? 'This lesson is already assigned to that class.' : error.message }
  return { id: data.id }
}
