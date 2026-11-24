// "Suggest questions with AI" in the lesson builder: what the ai-questions Edge Function returns, and what to tell
// the teacher. No React here.
import type { DraftQuestion } from './bulkPaste'

export type QuestionKinds = 'mix' | 'mc' | 'short'

export type SuggestRequest = {
  transcript: string
  duration_s: number
  title: string
  subject: string
  grade: string
  count: number
  kinds: QuestionKinds
}

export type Suggestion = {
  at_s: number
  kind: 'mc' | 'short'
  prompt: string
  choices: string[]
  correct_index: number | null
  rubric: string
}

export type SuggestResult =
  | { ok: true; questions: Suggestion[]; warnings: string[]; timed: boolean; model: string; left_today: number }
  | { ok: false; error: string }

export const COUNT_OPTIONS = [3, 5, 8, 10]

/** Big enough for a long lecture's transcript; the server shortens what it sends to the AI. */
export const TRANSCRIPT_MAX = 100_000

const ERROR_TEXT: Record<string, string> = {
  too_short: 'Paste more of the transcript. The AI needs at least a few sentences of what the video says.',
  too_long: 'That transcript is too long. Paste the part of the video your lesson uses.',
  bad_request: 'Something was off with that request. Reload the page and try again.',
  teacher_cap: "You've used today's AI question suggestions. Try again tomorrow, or write questions by hand.",
  monthly_cap: "Oasis has used this month's AI question suggestions. Write questions by hand for now.",
  disabled: 'AI is turned off in Oasis right now.',
  questions_off: 'AI question suggestions are turned off right now.',
  not_configured: "AI question suggestions aren't set up yet.",
  unavailable: "The AI services are busy or out of free quota right now. Try again in a few minutes. This one didn't count against your daily limit.",
  no_questions: "The AI didn't come back with usable questions. Try again, or paste a cleaner transcript.",
  teachers_only: 'Only teachers can use AI question suggestions.',
  signed_out: 'You were signed out. Sign in again and retry.',
  claim_failed: "Couldn't start AI question suggestions. Try again in a minute.",
}

export function suggestErrorText(error: string | null): string {
  if (!error) return "Couldn't reach AI question suggestions. Check your connection and try again."
  return ERROR_TEXT[error] ?? "AI question suggestions didn't work. Try again in a minute."
}

/** A suggestion as a builder draft. The teacher adds it on purpose; it's never added for them. */
export function suggestionToDraft(s: Suggestion): DraftQuestion {
  return {
    at_s: s.at_s,
    kind: s.kind,
    prompt: s.prompt,
    choices: s.kind === 'mc' ? [...s.choices] : [],
    correct_index: s.kind === 'mc' ? s.correct_index : null,
    rubric: s.kind === 'short' ? s.rubric : '',
  }
}

export const KIND_LABEL: Record<QuestionKinds, string> = {
  mix: 'Mostly multiple choice',
  mc: 'Multiple choice only',
  short: 'Short answer only',
}
