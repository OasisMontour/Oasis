import { describe, expect, it } from 'vitest'
import { BULK_PASTE_EXAMPLE, parseBulkPaste } from './bulkPaste'
import { formatTime, parseTime } from './time'

describe('parseBulkPaste', () => {
  it('parses the example shown to teachers', () => {
    const r = parseBulkPaste(BULK_PASTE_EXAMPLE)
    expect(r.errors).toEqual([])
    expect(r.questions).toEqual([
      { at_s: 30, kind: 'mc', prompt: 'What is the main source of energy for plants?', choices: ['Water', 'The sun', 'Soil'], correct_index: 1 },
      { at_s: 135, kind: 'short', prompt: 'Explain in your own words why leaves are green.', choices: [], correct_index: null },
    ])
  })

  it('accepts trailing stars, Answer: lines, A. style letters and hour timestamps', () => {
    const r = parseBulkPaste('1:02:03 - Q?\nA. one\nB. two *\n\n0:05 Other?\na) x\nb) y\nAnswer: A')
    expect(r.errors).toEqual([])
    expect(r.questions.map((q) => [q.at_s, q.correct_index])).toEqual([[5, 0], [3723, 1]])
  })

  it('joins multi-line question text', () => {
    const r = parseBulkPaste('0:10 Read this:\n"To be or not to be"\nWho said it?')
    expect(r.questions[0].prompt).toBe('Read this:\n"To be or not to be"\nWho said it?')
  })

  it('reports problems by line number', () => {
    const r = parseBulkPaste('a) orphan\n0:10 No key\na) x\nb) y\n0:20 Two keys\n*a) x\n*b) y\n0:99 Bad time\n0:30 One choice\na) lonely')
    expect(r.errors).toEqual([
      'Line 1: start each question with a time, like "1:30 What is...?"',
      'Line 2: mark the right answer with a * (like "*b) ...") or add "Answer: b".',
      'Line 7: only one choice can be marked right.',
      'Line 8: "0:99" isn\'t a valid time. Use minutes:seconds, like 1:30.',
      'Line 9: a multiple choice question needs at least 2 choices.',
    ])
  })
})

describe('time', () => {
  it('round-trips', () => {
    for (const s of [0, 9, 75, 3600, 3725]) expect(parseTime(formatTime(s))).toBe(s)
    expect(parseTime('1:75')).toBeNull()
    expect(parseTime('abc')).toBeNull()
  })
})
