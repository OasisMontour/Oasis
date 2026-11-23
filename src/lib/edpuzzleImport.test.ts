import { describe, expect, it } from 'vitest'
import { EDPUZZLE_IMPORT_EXAMPLE, parseEdpuzzlePaste } from './edpuzzleImport'

describe('parseEdpuzzlePaste', () => {
  it('parses the example shown to teachers', () => {
    const r = parseEdpuzzlePaste(EDPUZZLE_IMPORT_EXAMPLE)
    expect(r.warnings).toEqual([])
    expect(r.questions).toEqual([
      { at_s: 45, kind: 'mc', prompt: 'What is the main source of energy for plants?', choices: ['Water', 'The sun', 'Soil'], correct_index: 1 },
      { at_s: 135, kind: 'short', prompt: 'Explain in your own words why leaves are green.', choices: [], correct_index: null },
    ])
  })

  it('ignores page chrome before the first timestamp, drops UI labels, and finds the YouTube link', () => {
    const r = parseEdpuzzlePaste(`My Content
Classes
Photosynthesis basics
https://www.youtube.com/watch?v=dQw4w9WgXcQ
0:00 / 4:31
00:45
Multiple-choice question
1 point
What is the main source of energy for plants?
Water
The sun
Soil
Edit
Delete
1:30
Open-ended question
Why are leaves green?
Explain using the word chlorophyll.`)
    expect(r.youtubeId).toBe('dQw4w9WgXcQ')
    expect(r.questions).toEqual([
      { at_s: 45, kind: 'mc', prompt: 'What is the main source of energy for plants?', choices: ['Water', 'The sun', 'Soil'], correct_index: null },
      { at_s: 90, kind: 'short', prompt: 'Why are leaves green?\nExplain using the word chlorophyll.', choices: [], correct_index: null },
    ])
  })

  it('never guesses the right answer when nothing marks it', () => {
    const r = parseEdpuzzlePaste('0:10 Pick one?\nA) x\nB) y')
    expect(r.questions[0].correct_index).toBeNull()
  })

  it('reads letters, bullets, star/check marks and Answer lines', () => {
    const r = parseEdpuzzlePaste(`[0:05] First?
a) one
*b) two
(0:10) Second?
• red
• blue (correct)
@0:15 Third?
A. cat
B. dog
Answer: A
Question 4 at 0:20 Fourth?
- up
- down
Correct answer: down`)
    expect(r.warnings).toEqual([])
    expect(r.questions.map((q) => [q.at_s, q.choices, q.correct_index])).toEqual([
      [5, ['one', 'two'], 1],
      [10, ['red', 'blue'], 1],
      [15, ['cat', 'dog'], 0],
      [20, ['up', 'down'], 1],
    ])
  })

  it('keeps numeric choices and choice text that looks like a UI word only when it is not exact', () => {
    const r = parseEdpuzzlePaste('0:05 What is 2+2?\n3\n4 ✓\n5')
    expect(r.questions[0]).toMatchObject({ kind: 'mc', choices: ['3', '4', '5'], correct_index: 1 })
  })

  it('makes the teacher pick when Edpuzzle had several right answers', () => {
    const r = parseEdpuzzlePaste('0:05 Which are mammals?\nwhale ✓\nshark\nbat ✓')
    expect(r.questions[0].correct_index).toBeNull()
    expect(r.warnings.join()).toMatch(/more than one right answer/)
  })

  it('skips notes, caps choices at 6, and sorts by time', () => {
    const r = parseEdpuzzlePaste('2:00 Last?\na) 1\nb) 2\nc) 3\nd) 4\ne) 5\nf) 6\n- 7 ✓\n0:30\nNote\nWatch closely here.\n1:00 Middle?')
    expect(r.questions.map((q) => q.at_s)).toEqual([60, 120])
    expect(r.questions[1].choices).toHaveLength(6)
    expect(r.questions[1].correct_index).toBeNull() // the marked one was dropped
    expect(r.warnings.join('\n')).toMatch(/note/)
    expect(r.warnings.join('\n')).toMatch(/allows 6/)
  })

  it('handles hour timestamps and Windows line endings', () => {
    const r = parseEdpuzzlePaste('1:02:03 Long video?\r\nyes *\r\nno\r\n')
    expect(r.questions[0]).toMatchObject({ at_s: 3723, choices: ['yes', 'no'], correct_index: 0 })
  })

  it('warns when the only link is an Edpuzzle link', () => {
    const r = parseEdpuzzlePaste('https://edpuzzle.com/media/abc123\n0:05 Q?')
    expect(r.youtubeId).toBeNull()
    expect(r.sawEdpuzzleLink).toBe(true)
    expect(r.warnings.join()).toMatch(/Edpuzzle link/)
  })

  it('says so when there are no timestamps at all', () => {
    const r = parseEdpuzzlePaste('What is a cell?\nA) x\nB) y')
    expect(r.questions).toEqual([])
    expect(r.warnings.join()).toMatch(/No timestamps/)
  })

  it('keeps a single trailing line as question text instead of a one-choice question', () => {
    const r = parseEdpuzzlePaste('0:05 What happened?\nUse two sentences.')
    expect(r.questions[0]).toMatchObject({ kind: 'short', prompt: 'What happened?\nUse two sentences.' })
  })

  it('does not treat plain text as script (prompts are stored and rendered as text)', () => {
    const r = parseEdpuzzlePaste('0:05 <img src=x onerror=alert(1)>?\n<b>a</b>\n<i>b</i>')
    expect(r.questions[0].prompt).toBe('<img src=x onerror=alert(1)>?')
    expect(r.questions[0].choices).toEqual(['<b>a</b>', '<i>b</i>'])
  })
})
