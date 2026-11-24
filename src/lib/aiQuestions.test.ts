import { describe, expect, it } from 'vitest'
import { suggestErrorText, suggestionToDraft } from './aiQuestions'

describe('suggestErrorText', () => {
  it('explains every error the function returns', () => {
    for (const e of ['too_short', 'too_long', 'teacher_cap', 'monthly_cap', 'disabled', 'questions_off', 'not_configured', 'unavailable', 'no_questions']) {
      expect(suggestErrorText(e)).not.toMatch(/didn't work/)
    }
  })
  it('says the run was not charged when no AI answered', () => {
    expect(suggestErrorText('unavailable')).toMatch(/didn't count/)
  })
  it('has a fallback for unknown errors and network failures', () => {
    expect(suggestErrorText('something_new')).toMatch(/didn't work/)
    expect(suggestErrorText(null)).toMatch(/connection/)
  })
})

describe('suggestionToDraft', () => {
  it('copies a multiple-choice suggestion without sharing the choices array', () => {
    const s = { at_s: 30, kind: 'mc' as const, prompt: 'Q?', choices: ['a', 'b'], correct_index: 1, rubric: 'ignored' }
    const d = suggestionToDraft(s)
    expect(d).toEqual({ at_s: 30, kind: 'mc', prompt: 'Q?', choices: ['a', 'b'], correct_index: 1, rubric: '' })
    expect(d.choices).not.toBe(s.choices)
  })
  it('keeps the expected answer on a short answer', () => {
    expect(suggestionToDraft({ at_s: 5, kind: 'short', prompt: 'Why?', choices: ['x'], correct_index: 0, rubric: 'Because.' }))
      .toEqual({ at_s: 5, kind: 'short', prompt: 'Why?', choices: [], correct_index: null, rubric: 'Because.' })
  })
})
