import type { DraftQuestion } from './bulkPaste'
import { invokeFn } from './invokeFn'

// Client side of the ai-draft Edge Function (supabase/functions/_shared/aiDrafter.ts). Drafts come back already
// checked by the server; they're still only drafts until the teacher saves the lesson.

export const AI_MATERIAL_MIN = 150
export const AI_MATERIAL_MAX = 12000

export type AiDraftKind = DraftQuestion['kind']

export type AiDraftResult =
  | { ok: true; questions: DraftQuestion[]; dropped: number; model: string; timed: boolean; left_today: number }
  | { ok: false; error: string }

export async function draftQuestionsWithAi(req: {
  material: string
  durationS: number
  count: number
  kinds: AiDraftKind[]
}): Promise<AiDraftResult> {
  const { data, error } = await invokeFn<AiDraftResult>('ai-draft', {
    material: req.material,
    authorized: true,
    duration_s: req.durationS,
    count: req.count,
    kinds: req.kinds,
  })
  if (error || !data) return { ok: false, error: 'network' }
  if (!data.ok) return data
  const questions: DraftQuestion[] = (data.questions ?? []).map((q) => ({
    at_s: Number(q.at_s),
    kind: q.kind,
    prompt: q.prompt,
    choices: q.choices ?? [],
    correct_index: q.kind === 'mc' ? q.correct_index : null,
    correct_indexes: q.kind === 'multi' ? (q.correct_indexes ?? []) : [],
    rubric: q.kind === 'short' ? (q.rubric ?? '') : '',
  }))
  return { ...data, questions }
}

/** What to tell the teacher when drafting didn't work. Manual building always still works. */
export function aiDraftError(code: string): string {
  switch (code) {
    case 'teacher_cap':
      return "You've used today's AI drafts. They reset tomorrow. You can still write questions yourself."
    case 'monthly_cap':
      return "Oasis has used this month's free AI drafts. You can still write questions yourself."
    case 'disabled':
      return 'AI drafts are turned off right now. You can still write questions yourself.'
    case 'not_configured':
      return "AI drafts aren't set up on this Oasis server yet."
    case 'too_short':
      return `Paste a bit more material (at least ${AI_MATERIAL_MIN} characters).`
    case 'too_long':
      return `That's too much material at once. Paste up to ${AI_MATERIAL_MAX.toLocaleString()} characters.`
    case 'unavailable':
      return "The free AI services are busy or didn't give usable questions. Try again in a minute, or write questions yourself. This try didn't count against your limit."
    case 'network':
      return "Couldn't reach Oasis. Check your connection and try again."
    default:
      return "AI drafting didn't work this time. You can still write questions yourself."
  }
}
