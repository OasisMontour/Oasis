import type { DraftQuestion } from './bulkPaste'
import { parseYouTubeId } from './youtube'

/**
 * A blank question. Multiple choice starts with NO right answer: pre-selecting choice A let a
 * teacher save a wrong key without ever choosing one (audit #6).
 */
export function blankQuestion(kind: 'mc' | 'short', at_s: number): DraftQuestion {
  return { at_s, kind, prompt: '', choices: kind === 'mc' ? ['', ''] : [], correct_index: null }
}

/** Switching a question's type. Turning a short answer into MC keeps any existing key, never invents one. */
export function switchKind(q: DraftQuestion, kind: 'mc' | 'short'): Partial<DraftQuestion> {
  if (kind === 'short') return { kind, choices: [], correct_index: null }
  const choices = q.choices.length >= 2 ? q.choices : ['', '']
  const ki = q.correct_index
  return { kind, choices, correct_index: ki !== null && ki < choices.length ? ki : null }
}

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
