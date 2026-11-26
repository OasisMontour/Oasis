// Regression tests for the Nov 25 frontend audit (#14, #15, #16).
import { describe, expect, it } from 'vitest'
import { canFinish, maxWatchedAfterEnd, onVideoEnded, positionToSave, progressToSave, tick, type PlayerQuestion } from './player'

const q = (id: string, at_s: number): PlayerQuestion => ({ id, at_s, kind: 'mc', prompt: id, choices: ['a', 'b'], answered: false })
const none = new Set<string>()

describe('final question at the very end (audit #14)', () => {
  const Q = [q('last', 19)]
  it('ending shows the last question and marks the end reached', () => {
    const r = onVideoEnded({ current: 19, maxWatched: 18.9, durationS: 19, questions: Q, answered: none })
    expect(r.snapBack).toBe(false)
    expect(r.question?.id).toBe('last')
  })
  it('a gate a hair short of the end still ends cleanly once answered', () => {
    const Q2 = [q('last', 18)]
    const r = onVideoEnded({ current: 19, maxWatched: 18, durationS: 19.4, questions: Q2, answered: none })
    expect(r.question?.id).toBe('last')
    expect(r.maxWatched).toBe(18) // held at the gate until answered
    const answered = new Set(['last'])
    const after = maxWatchedAfterEnd(r.maxWatched, 19.4, Q2, answered)
    expect(after).toBe(19.4)
    expect(canFinish(after, 19.4, Q2, answered)).toBe(true)
  })
  it('no questions left: ending reaches the stored length', () => {
    const r = onVideoEnded({ current: 59.6, maxWatched: 59.5, durationS: 60, questions: [], answered: none })
    expect(r).toEqual({ maxWatched: 60, snapBack: false, question: null })
  })
  it('an end reached by skipping still snaps back', () => {
    const r = onVideoEnded({ current: 60, maxWatched: 30, durationS: 60, questions: [], answered: none })
    expect(r.snapBack).toBe(true)
  })
  it('does not unlock the end while a question is unanswered', () => {
    expect(maxWatchedAfterEnd(18, 19, [q('x', 18)], none)).toBe(18)
  })
})

describe('resume point before the player is ready (audit #15)', () => {
  it('keeps the saved position when the player has no time yet', () => {
    expect(positionToSave(null, 87, progressToSave(91, 600), 600)).toBe(87)
    expect(positionToSave(undefined, 87, 91, 600)).toBe(87)
    expect(positionToSave(NaN, 87, 91, 600)).toBe(87)
  })
  it('uses the player once it reports', () => {
    expect(positionToSave(90.04, 87, 91, 600)).toBe(90)
  })
  it('never past what has been watched', () => {
    expect(positionToSave(120, 87, 91, 600)).toBe(91)
  })
})

describe('busy device between ticks (audit #16)', () => {
  const base = { maxWatched: 10, durationS: 600, questions: [q('q', 300)], answered: none }
  it('2s of normal playback over a 2s tick gap is not a skip', () => {
    const r = tick({ ...base, current: 12, elapsedS: 2 })
    expect(r.snapBack).toBe(false)
    expect(r.maxWatched).toBe(12)
  })
  it('same jump with no time passing is still a skip', () => {
    expect(tick({ ...base, current: 12, elapsedS: 0.25 }).snapBack).toBe(true)
  })
  it('a long freeze only buys a bounded allowance', () => {
    expect(tick({ ...base, current: 40, elapsedS: 30 }).snapBack).toBe(true)
  })
  it('question boundaries still hold', () => {
    const r = tick({ ...base, maxWatched: 299, current: 301, elapsedS: 2 })
    expect(r.maxWatched).toBe(300)
    expect(r.question?.id).toBe('q')
  })
})
