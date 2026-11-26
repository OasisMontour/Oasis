import { describe, expect, it } from 'vitest'
import { blankQuestion, removeChoice, switchKind, videoProblem } from './builder'

const ID = 'dQw4w9WgXcQ'
const OTHER = 'aaaaaaaaaaa'

describe('blankQuestion (audit #6)', () => {
  it('starts multiple choice with no right answer', () => {
    expect(blankQuestion('mc', 10)).toMatchObject({ kind: 'mc', choices: ['', ''], correct_index: null, at_s: 10 })
  })
  it('short answer has no choices', () => {
    expect(blankQuestion('short', 0)).toMatchObject({ kind: 'short', choices: [], correct_index: null })
  })
})

describe('switchKind (audit #6)', () => {
  it('short -> mc does not pick choice A', () => {
    expect(switchKind(blankQuestion('short', 0), 'mc')).toEqual({ kind: 'mc', choices: ['', ''], correct_index: null, correct_indexes: [] })
  })
  it('keeps a key the teacher already chose', () => {
    const q = { ...blankQuestion('mc', 0), choices: ['3', '4'], correct_index: 1 }
    expect(switchKind(q, 'mc').correct_index).toBe(1)
  })
  it('mc -> short clears the key', () => {
    const q = { ...blankQuestion('mc', 0), correct_index: 1 }
    expect(switchKind(q, 'short')).toEqual({ kind: 'short', choices: [], correct_index: null, correct_indexes: [] })
  })
})

describe('videoProblem (audit #7)', () => {
  it('ok when the box matches the loaded video', () => {
    expect(videoProblem(`https://youtu.be/${ID}`, ID, 120)).toBeNull()
  })
  it('blank box blocks save even though a video was loaded', () => {
    expect(videoProblem('  ', ID, 120)).toMatch(/Add a YouTube video/)
  })
  it('malformed replacement blocks save', () => {
    expect(videoProblem('https://youtube.com/watch?v=nope', ID, 120)).toMatch(/doesn't look right/)
  })
  it('a different, not-yet-loaded link blocks save', () => {
    expect(videoProblem(`https://youtu.be/${OTHER}`, ID, 120)).toMatch(/Click Load/)
  })
  it('waits for duration', () => {
    expect(videoProblem(ID, ID, null)).toMatch(/Wait for the video/)
  })
})

describe('multi-select (beta item 7)', () => {
  it('starts with no right answers', () => {
    expect(blankQuestion('multi', 5)).toMatchObject({ kind: 'multi', choices: ['', ''], correct_indexes: [] })
  })
  it('single -> multi keeps the key as a ticked box, and back again', () => {
    const mc = { ...blankQuestion('mc', 0), choices: ['a', 'b', 'c'], correct_index: 2 }
    const multi = switchKind(mc, 'multi')
    expect(multi).toMatchObject({ kind: 'multi', correct_index: null, correct_indexes: [2] })
    expect(switchKind({ ...mc, ...multi }, 'mc')).toMatchObject({ kind: 'mc', correct_index: 2, correct_indexes: [] })
  })
  it('multi -> single with several ticks makes the teacher choose', () => {
    expect(switchKind({ ...blankQuestion('multi', 0), choices: ['a', 'b', 'c'], correct_indexes: [0, 2] }, 'mc')).toMatchObject({ correct_index: null })
  })
  it('removing a choice shifts the keys and drops a removed right answer', () => {
    const q = { ...blankQuestion('multi', 0), choices: ['a', 'b', 'c', 'd'], correct_indexes: [1, 3] }
    expect(removeChoice(q, 1)).toMatchObject({ choices: ['a', 'c', 'd'], correct_indexes: [2] })
    const m = { ...blankQuestion('mc', 0), choices: ['a', 'b', 'c'], correct_index: 1 }
    expect(removeChoice(m, 1).correct_index).toBeNull()
    expect(removeChoice(m, 0).correct_index).toBe(0)
  })
})
