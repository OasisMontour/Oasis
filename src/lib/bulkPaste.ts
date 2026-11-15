import { parseTime } from './time'

export type DraftQuestion = {
  id?: string // set for questions already saved
  at_s: number
  kind: 'mc' | 'short'
  prompt: string
  choices: string[] // empty for short answer
  correct_index: number | null
}

export type ParseResult = { questions: DraftQuestion[]; errors: string[] }

export const BULK_PASTE_EXAMPLE = `0:30 What is the main source of energy for plants?
a) Water
*b) The sun
c) Soil

2:15 Explain in your own words why leaves are green.`

const QUESTION_LINE = /^\s*((?:\d+:)?\d{1,2}:\d{2})\s*[-–—.)]?\s+(.+)$/
const CHOICE_LINE = /^\s*(\*)?\s*([a-fA-F])\s*[).:]\s*(.*?)\s*(\*)?\s*$/
const ANSWER_LINE = /^\s*(?:answer|ans|correct)\s*[:=-]\s*([a-fA-F])\s*\)?\s*$/i

/**
 * Turns pasted text into questions. One question per block:
 *
 *   1:30 Question text (a timestamp starts a new question)
 *   a) choice
 *   *b) correct choice      <- star before or after marks the right one
 *   Answer: b               <- or say it on its own line
 *
 * A question with no choices is short answer. Errors name the line so teachers can fix them.
 */
export function parseBulkPaste(text: string): ParseResult {
  const questions: DraftQuestion[] = []
  const errors: string[] = []
  let cur: (DraftQuestion & { line: number; letters: string[] }) | null = null

  const finish = () => {
    if (!cur) return
    const { line, letters, ...q } = cur
    void letters
    if (q.choices.length === 1) errors.push(`Line ${line}: a multiple choice question needs at least 2 choices.`)
    else if (q.choices.length > 0 && q.correct_index === null)
      errors.push(`Line ${line}: mark the right answer with a * (like "*b) ...") or add "Answer: b".`)
    else questions.push({ ...q, kind: q.choices.length ? 'mc' : 'short' })
    cur = null
  }

  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1
    if (!raw.trim()) return

    const qm = QUESTION_LINE.exec(raw)
    if (qm) {
      const at = parseTime(qm[1])
      if (at === null) {
        errors.push(`Line ${n}: "${qm[1]}" isn't a valid time. Use minutes:seconds, like 1:30.`)
        return
      }
      finish()
      cur = { at_s: at, kind: 'short', prompt: qm[2].trim(), choices: [], correct_index: null, line: n, letters: [] }
      return
    }

    if (!cur) {
      errors.push(`Line ${n}: start each question with a time, like "1:30 What is...?"`)
      return
    }

    const am = ANSWER_LINE.exec(raw)
    if (am) {
      const idx = cur.letters.indexOf(am[1].toLowerCase())
      if (idx === -1) errors.push(`Line ${n}: there's no choice "${am[1]}" above this line.`)
      else if (cur.correct_index !== null && cur.correct_index !== idx)
        errors.push(`Line ${n}: this question already has a different right answer marked.`)
      else cur.correct_index = idx
      return
    }

    const cm = CHOICE_LINE.exec(raw)
    if (cm && cm[3]) {
      if (cur.choices.length >= 6) {
        errors.push(`Line ${n}: a question can have at most 6 choices.`)
        return
      }
      if (cm[1] || cm[4]) {
        if (cur.correct_index !== null) errors.push(`Line ${n}: only one choice can be marked right.`)
        else cur.correct_index = cur.choices.length
      }
      cur.choices.push(cm[3])
      cur.letters.push(cm[2].toLowerCase())
      return
    }

    // Anything else continues the question text, as long as choices haven't started.
    if (cur.choices.length) errors.push(`Line ${n}: choices need a letter, like "c) ...".`)
    else cur.prompt += '\n' + raw.trim()
  })
  finish()

  questions.sort((a, b) => a.at_s - b.at_s)
  return { questions, errors }
}
