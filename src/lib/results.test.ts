import { describe, expect, it } from 'vitest'
import { buildCsv, csvField, csvFilename, questionStats, sortStudents, summarize, type ResultQuestion, type ResultStudent } from './results'

const questions: ResultQuestion[] = [
  { id: 'q1', at_s: 10, kind: 'mc', prompt: 'Pick one', choices: ['Red', 'Blue', 'Green'], correct_index: 1 },
  { id: 'q2', at_s: 20, kind: 'short', prompt: 'Why, "really"?', choices: null, correct_index: null },
]

const student = (over: Partial<ResultStudent>): ResultStudent => ({
  student_id: 's', email: 'x@d.org', name: 'X', status: 'finished', progress_pct: 100, score: null,
  finished_at: null, late: false, on_roster: true, focus_events: 0, answers: {}, ...over,
})

const students: ResultStudent[] = [
  student({ name: 'bo', email: 'bo@d.org', score: 50, answers: { q1: { response: '1', is_correct: true, graded_by: 'auto' }, q2: { response: 'idk', is_correct: null, graded_by: null } } }),
  student({ name: 'Al', email: 'al@d.org', score: 100, focus_events: 3, answers: { q1: { response: '1', is_correct: true, graded_by: 'auto' }, q2: { response: 'because', is_correct: true, graded_by: 'teacher' } } }),
  student({ name: 'Cy', email: 'cy@d.org', status: 'in_progress', progress_pct: 40, answers: { q1: { response: '0', is_correct: false, graded_by: 'auto' } } }),
  student({ name: '', email: 'dee@d.org', student_id: null, status: 'not_signed_in', progress_pct: 0 }),
]

describe('summarize', () => {
  it('counts statuses, averages finished scores only, and counts ungraded short answers', () => {
    expect(summarize(students, questions)).toEqual({
      total: 4, finished: 2, in_progress: 1, not_started: 0, not_signed_in: 1, average: 75, needsGrading: 1, leftTab: 1,
    })
  })

  it('has no average when nobody finished', () => {
    expect(summarize([students[2]], questions).average).toBeNull()
  })
})

describe('questionStats', () => {
  it('computes % correct over graded answers and the MC choice distribution', () => {
    const [mc, short] = questionStats(questions, students)
    expect(mc).toMatchObject({ answered: 3, graded: 3, correct: 2, ungraded: 0, choiceCounts: [1, 2, 0] })
    expect(mc.pctCorrect).toBeCloseTo(66.67, 1)
    expect(short).toMatchObject({ answered: 2, graded: 1, correct: 1, pctCorrect: 100, ungraded: 1, choiceCounts: [] })
  })

  it('ignores garbage MC responses and reports null % when nothing is answered', () => {
    const s = [student({ answers: { q1: { response: '9', is_correct: false, graded_by: 'auto' } } })]
    expect(questionStats(questions, s)[0].choiceCounts).toEqual([0, 0, 0])
    expect(questionStats(questions, [])[0].pctCorrect).toBeNull()
  })
})

describe('sortStudents', () => {
  const names = (xs: ResultStudent[]) => xs.map((s) => s.email)
  it('sorts by name case-insensitively, falling back to email', () => {
    expect(names(sortStudents(students, 'name', 'asc'))).toEqual(['al@d.org', 'bo@d.org', 'cy@d.org', 'dee@d.org'])
    expect(names(sortStudents(students, 'name', 'desc'))).toEqual(['dee@d.org', 'cy@d.org', 'bo@d.org', 'al@d.org'])
  })

  it('sorts by score with unscored students always last', () => {
    expect(names(sortStudents(students, 'score', 'desc'))).toEqual(['al@d.org', 'bo@d.org', 'cy@d.org', 'dee@d.org'])
    expect(names(sortStudents(students, 'score', 'asc'))).toEqual(['bo@d.org', 'al@d.org', 'cy@d.org', 'dee@d.org'])
  })

  it('does not mutate the input', () => {
    const copy = [...students]
    sortStudents(students, 'score', 'asc')
    expect(students).toEqual(copy)
  })
})

describe('csv', () => {
  it('quotes commas, quotes and newlines, and defuses formulas', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvField(null)).toBe('')
    expect(csvField(42)).toBe('42')
  })

  it('builds one row per student sorted by name, one column per question', () => {
    const csv = buildCsv({ questions, students })
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).trimEnd().split('\r\n')
    expect(lines[0]).toBe('Name,Email,Status,Progress %,Score %,Late,Times left video,On roster,Q1: Pick one,"Q2: Why, ""really""?"')
    expect(lines[1]).toBe('Al,al@d.org,Finished,100,100,no,3,yes,B. Blue (correct),because (correct)')
    expect(lines[2]).toBe('bo,bo@d.org,Finished,100,50,no,0,yes,B. Blue (correct),idk (needs grading)')
    expect(lines[3]).toBe('Cy,cy@d.org,In progress,40,,no,0,yes,A. Red (incorrect),')
    expect(lines[4]).toBe('dee@d.org,dee@d.org,Never signed in,0,,no,0,yes,,')
  })

  it('makes a safe filename', () => {
    expect(csvFilename('Cells: Part 1/2', 'Period 3')).toBe('Cells Part 12 - Period 3.csv')
  })
})
