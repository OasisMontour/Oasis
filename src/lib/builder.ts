import type { DraftQuestion } from './bulkPaste'
import { parseYouTubeId } from './youtube'

/**
 * A blank question. Multiple choice starts with NO right answer: pre-selecting choice A let a
 * teacher save a wrong key without ever choosing one (audit #6).
 */
export function blankQuestion(kind: DraftQuestion['kind'], at_s: number): DraftQuestion {
  return { at_s, kind, prompt: '', choices: kind === 'short' ? [] : ['', ''], correct_index: null, correct_indexes: [] }
}

/** Switching a question's type. Turning a short answer into MC keeps any existing key, never invents one. */
export function switchKind(q: DraftQuestion, kind: DraftQuestion['kind']): Partial<DraftQuestion> {
  if (kind === 'short') return { kind, choices: [], correct_index: null, correct_indexes: [] }
  const choices = q.choices.length >= 2 ? q.choices : ['', '']
  if (kind === 'multi') {
    // Single -> multi keeps the one right answer as the first ticked box.
    const keep = (q.correct_indexes ?? []).length ? q.correct_indexes! : q.correct_index !== null ? [q.correct_index] : []
    return { kind, choices, correct_index: null, correct_indexes: keep.filter((i) => i < choices.length) }
  }
  const ki = q.correct_index ?? ((q.correct_indexes ?? []).length === 1 ? q.correct_indexes![0] : null)
  return { kind, choices, correct_index: ki !== null && ki < choices.length ? ki : null, correct_indexes: [] }
}

/** Removing a choice: the key follows the choices that stay, and a removed right answer is never replaced by A. */
export function removeChoice(q: DraftQuestion, ci: number): Partial<DraftQuestion> {
  const choices = q.choices.filter((_, j) => j !== ci)
  const ki = q.correct_index
  return {
    choices,
    correct_index: ki === null || ki === ci ? null : ki > ci ? ki - 1 : ki,
    correct_indexes: (q.correct_indexes ?? []).filter((i) => i !== ci).map((i) => (i > ci ? i - 1 : i)),
  }
}

export type DraftNote = { key: string; at_s: number; timeText: string; body: string }

/**
 * The video the lesson will be saved with must be the one the link box shows. Blanking the box or
 * pasting a bad/different link used to leave the old video quietly valid for Save (audit #7).
 */
export function videoProblem(videoInput: string, loadedId: string | null, duration: number | null): string | null {
  const typed = videoInput.trim()
  if (!typed) return 'Add a YouTube video.'
  const vid = parseYouTubeId(typed)
  if (!vid) return "The YouTube link doesn't look right. Fix it or paste the video's link again."
  if (vid !== loadedId) return 'Click Load to switch to the new YouTube link before saving.'
  if (!duration) return 'Wait for the video to load.'
  return null
}
