import { describe, expect, it, vi } from 'vitest'
import { aiRunMessage, runAiGrading, type AiBatch } from './aiGrade'

const batch = (over: Partial<Extract<AiBatch, { ok: true }>> = {}): AiBatch => ({ ok: true, graded: 0, unsure: 0, skipped: 0, unavailable: 0, remaining: 0, ...over })

describe('runAiGrading', () => {
  it('keeps going while there is more and adds up the counts', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce(batch({ graded: 6, unsure: 2, remaining: 5 }))
      .mockResolvedValueOnce(batch({ graded: 4, skipped: 1, remaining: 0 }))
    const progress = vi.fn()
    expect(await runAiGrading(call, progress)).toEqual({ graded: 10, unsure: 2, skipped: 1, unavailable: 0, stoppedBy: null })
    expect(call).toHaveBeenCalledTimes(2)
    expect(progress).toHaveBeenCalledTimes(2)
  })
  it('stops on a limit, on unavailable, on no progress, and on a network error', async () => {
    expect((await runAiGrading(async () => ({ ok: false, error: 'teacher_cap' }))).stoppedBy).toBe('teacher_cap')
    expect((await runAiGrading(async () => batch({ graded: 1, unavailable: 7, remaining: 7 }))).stoppedBy).toBe('unavailable')
    const stuck = vi.fn(async () => batch({ remaining: 3 }))
    await runAiGrading(stuck)
    expect(stuck).toHaveBeenCalledTimes(1)
    expect((await runAiGrading(async () => null)).stoppedBy).toBe('network')
  })
  it('never loops forever', async () => {
    const call = vi.fn(async () => batch({ graded: 1, remaining: 1 }))
    await runAiGrading(call)
    expect(call).toHaveBeenCalledTimes(25)
  })
})

describe('aiRunMessage', () => {
  it('tells the teacher what happened and what to check', () => {
    expect(aiRunMessage({ graded: 3, unsure: 1, skipped: 0, unavailable: 0, stoppedBy: null }).text).toMatch(/AI graded 3 answers.*1 answer was left for you/)
    expect(aiRunMessage({ graded: 0, unsure: 0, skipped: 0, unavailable: 0, stoppedBy: 'monthly_cap' })).toMatchObject({ isError: true })
    expect(aiRunMessage({ graded: 2, unsure: 0, skipped: 0, unavailable: 0, stoppedBy: 'teacher_cap' })).toMatchObject({ isError: false })
    expect(aiRunMessage({ graded: 0, unsure: 0, skipped: 0, unavailable: 0, stoppedBy: null }).text).toBe('Nothing to grade with AI.')
  })
})
