// Runs the ai-grade Edge Function in batches until there's nothing left, it stops making progress, or it hits a
// limit. No React here: the results page passes in the call and shows the summary.

export type AiBatch =
  | { ok: true; graded: number; unsure: number; skipped: number; unavailable: number; remaining: number }
  | { ok: false; error: string; remaining?: number }

export type AiRun = {
  graded: number
  unsure: number
  skipped: number
  unavailable: number
  stoppedBy: string | null
  /** Answers the server says are still waiting for AI after the last batch, when it told us. */
  remaining?: number
}

/** Hard stop so a bug can't loop forever: 25 batches of 8 is 200 answers per click. */
const MAX_BATCHES = 25

export async function runAiGrading(
  call: () => Promise<AiBatch | null>,
  onProgress?: (run: AiRun) => void,
): Promise<AiRun> {
  const run: AiRun = { graded: 0, unsure: 0, skipped: 0, unavailable: 0, stoppedBy: null }
  for (let i = 0; i < MAX_BATCHES; i++) {
    const r = await call()
    if (!r) {
      run.stoppedBy = 'network'
      break
    }
    if (!r.ok) {
      run.stoppedBy = r.error
      break
    }
    run.graded += r.graded
    run.unsure += r.unsure
    run.skipped += r.skipped
    run.unavailable += r.unavailable
    run.remaining = r.remaining
    onProgress?.({ ...run })
    if (r.unavailable > 0) {
      run.stoppedBy = 'unavailable'
      break
    }
    if (r.remaining <= 0 || r.graded + r.unsure + r.skipped === 0) break
    // Out of batches with work left: say so instead of stopping silently (audit #23).
    if (i === MAX_BATCHES - 1) run.stoppedBy = 'batch_limit'
  }
  return run
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const STOP_TEXT: Record<string, string> = {
  teacher_cap: "You've hit today's AI grading limit. Grade the rest by hand or try again tomorrow.",
  monthly_cap: "Oasis has hit this month's AI grading limit. Grade the rest by hand.",
  disabled: 'AI grading is turned off right now. Grade these by hand.',
  lesson_off: 'AI grading is off for this lesson. Turn it on in the lesson editor.',
  busy: 'AI grading is already running for you. Wait a minute, then try again.',
  not_configured: "AI grading isn't set up yet.",
  unavailable: "The AI services are busy or out of free quota right now. The rest are still waiting; try again later.",
  network: "Couldn't reach AI grading. Check your connection and try again.",
}

export function aiRunMessage(run: AiRun): { text: string; isError: boolean } {
  const parts: string[] = []
  if (run.graded) parts.push(`AI graded ${plural(run.graded, 'answer')}. They're marked "AI": check them and change any you disagree with.`)
  const left = run.unsure + run.skipped
  if (left) parts.push(`${plural(left, 'answer')} ${left === 1 ? 'was' : 'were'} left for you (AI wasn't sure, or the answer looked like it was talking to the grader).`)
  const stop =
    run.stoppedBy === 'batch_limit'
      ? `${plural(run.remaining ?? 0, 'answer')} ${run.remaining === 1 ? 'is' : 'are'} still waiting: AI grades up to 200 per click. Click Grade with AI again to continue.`
      : run.stoppedBy
        ? (STOP_TEXT[run.stoppedBy] ?? 'AI grading stopped. Try again in a minute.')
        : null
  if (stop) parts.push(stop)
  if (!parts.length) parts.push('Nothing to grade with AI.')
  return { text: parts.join(' '), isError: !!stop && run.graded + left === 0 }
}
