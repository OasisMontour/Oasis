import { parseTime } from './time'
import { parseYouTubeId } from './youtube'
import type { DraftQuestion } from './bulkPaste'

/**
 * Edpuzzle import, the legit way.
 *
 * Edpuzzle has no public API and its terms forbid automated access, so we never log in to Edpuzzle,
 * store Edpuzzle credentials, or fetch Edpuzzle pages. The teacher opens their own lesson, selects
 * the questions, copies, and pastes here. This parser is deliberately forgiving about what that copy
 * looks like: anything before the first timestamp is ignored, Edpuzzle's UI labels are dropped, and
 * choices can be lettered, bulleted, or just one per line after the question.
 *
 * It never guesses which choice is right. If the paste doesn't mark it (a *, ✓, "(correct)" or an
 * "Answer:" line), correct_index stays null and the builder makes the teacher pick before saving.
 * A wrong guess would mis-grade every student, a blank costs the teacher one click.
 */

export type ImportResult = {
  questions: DraftQuestion[]
  /** Things the teacher should look at. Never blocking: everything lands in the builder for review. */
  warnings: string[]
  /** First YouTube link found anywhere in the paste, if any. */
  youtubeId: string | null
  /** True if the paste had an edpuzzle.com link but no YouTube link. */
  sawEdpuzzleLink: boolean
}

export const EDPUZZLE_IMPORT_EXAMPLE = `0:45 What is the main source of energy for plants?
Water
The sun ✓
Soil

2:15 Explain in your own words why leaves are green.`

const MAX_CHOICES = 6
const MAX_PROMPT = 2000

// "0:45", "00:45", "1:02:05", "[0:45]", "(0:45)", "@0:45", "at 0:45", "Question 3 at 0:45", "Q3 - 0:45"
const TIME_LINE =
  /^\s*(?:(?:question|q)\s*#?\d*\s*[-–—:.]?\s*)?(?:at\s+|@\s*)?[[(]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[\])]?\s*[-–—.:)|]?\s*(.*)$/i

// Edpuzzle UI text that shows up when you copy a lesson page. Matched against the whole line.
const NOISE = new RegExp(
  '^(?:' +
    [
      'multiple[- ]choice(?: question)?',
      'open[- ]ended(?: question)?',
      'question',
      'edit',
      'delete',
      'duplicate',
      'preview',
      'points?',
      '\\d+\\s*(?:points?|pts?)',
      'feedback',
      'add feedback',
      'add (?:a )?question',
      'add (?:a )?note',
      'correct',
      'incorrect',
      'question\\s*#?\\d+',
      'q\\d+',
      'show answers?',
      'hide answers?',
      // several buttons copied onto one line ("Edit Delete")
      '(?:(?:edit|delete|duplicate|preview|copy|move)\\s*)+',
      // page footer
      '©.*',
    ].join('|') +
    ')$',
  'i',
)
const NOTE_LABEL = /^(?:audio |voice ?over )?note$/i
const OPEN_LABEL = /^open[- ]ended(?: question)?$/i
const MC_LABEL = /^multiple[- ]choice(?: question)?$/i

const CORRECT_MARK = /(?:^\s*(?:\*|✓|✔|✔️|✅|☑|\(correct\)|\[correct\])\s*)|(?:\s*(?:\*|✓|✔|✔️|✅|☑|\(correct\)|\[correct\]|[-–—]\s*correct)\s*$)/i
// a) A. (a) A: and bullets
const CHOICE_PREFIX = /^\s*(?:\(?([a-fA-F])\s*[).:]|[•◦○◯●☐□▪‣-])\s+/
const ANSWER_LINE = /^\s*(?:correct answer|answer|ans|correct)\s*[:=-]\s*(.+?)\s*$/i

type Block = { at: number; startLine: number; lines: string[] }

export function parseEdpuzzlePaste(text: string): ImportResult {
  const warnings: string[] = []
  let youtubeId: string | null = null
  let sawEdpuzzleLink = false

  const blocks: Block[] = []
  let cur: Block | null = null

  const all = text.split(/\r?\n/).map((raw) => raw.replace(/\u00a0/g, ' ').trim())
  // Edpuzzle may show a question's type label ("Multiple choice question", "Note") just ABOVE its time.
  // A label line whose next non-empty line is a timestamp belongs to that next question, not this one.
  let carry: string | null = null
  const nextLine = (i: number) => {
    for (let j = i + 1; j < all.length; j++) if (all[j]) return all[j]
    return ''
  }
  all.forEach((line, i) => {
    if (!line) return
    if ((NOTE_LABEL.test(line) || OPEN_LABEL.test(line) || MC_LABEL.test(line)) && TIME_LINE.exec(nextLine(i))?.[2] === '') {
      carry = line
      return
    }

    // Pick up links wherever they are, and don't treat them as question text.
    const urls = line.match(/https?:\/\/\S+|(?:www\.)?(?:youtube\.com|youtu\.be|edpuzzle\.com)\/\S+/gi)
    if (urls) {
      for (const u of urls) {
        const id = parseYouTubeId(u)
        if (id) youtubeId ??= id
        else if (/edpuzzle\.com/i.test(u)) sawEdpuzzleLink = true
      }
      if (urls.join(' ').length >= line.length - 2) return
    }

    const tm = TIME_LINE.exec(line)
    if (tm && !tm[2].startsWith('/')) {
      const at = parseTime(tm[1])
      if (at !== null) {
        cur = { at, startLine: i + 1, lines: [...(carry ? [carry] : []), ...(tm[2] ? [tm[2]] : [])] }
        carry = null
        blocks.push(cur)
        return
      }
    }
    // Player time readouts like "0:00 / 4:31" are noise, not questions.
    if (tm && tm[2].startsWith('/')) return

    if (cur) cur.lines.push(line)
    // Anything before the first timestamp is page chrome (nav, title, etc.) and is ignored.
  })

  const questions: DraftQuestion[] = []
  for (const b of blocks) {
    const q = parseBlock(b, warnings)
    if (q) questions.push(q)
  }

  if (!blocks.length) warnings.push('No timestamps found. Each question needs its time, like "1:30", on or just above it.')
  if (sawEdpuzzleLink && !youtubeId)
    warnings.push("That's an Edpuzzle link, not a YouTube link. Open the video on YouTube and paste that link instead.")

  questions.sort((a, b) => a.at_s - b.at_s)
  return { questions, warnings, youtubeId, sawEdpuzzleLink }
}

function parseBlock(b: Block, warnings: string[]): DraftQuestion | null {
  const where = `Question at ${fmt(b.at)}`
  let kindHint: 'mc' | 'short' | null = null
  let answer: string | null = null
  const lines: string[] = []

  for (const l of b.lines) {
    if (NOTE_LABEL.test(l)) {
      warnings.push(`${fmt(b.at)}: skipped an Edpuzzle note. Oasis only has questions.`)
      return null
    }
    if (OPEN_LABEL.test(l)) kindHint = 'short'
    else if (MC_LABEL.test(l)) kindHint = 'mc'
    if (NOISE.test(l)) continue
    const am = ANSWER_LINE.exec(l)
    if (am) {
      answer = am[1]
      continue
    }
    lines.push(l)
  }

  if (!lines.length) {
    warnings.push(`${where} had no question text, so it was skipped.`)
    return null
  }

  let promptLines: string[]
  let choiceLines: string[] = []

  const firstMarked = lines.findIndex((l, i) => i > 0 && CHOICE_PREFIX.test(l.replace(CORRECT_MARK, '')))
  if (kindHint === 'short') {
    promptLines = lines
    const q = lines.findIndex((l) => /\?\s*$/.test(l))
    if (q !== -1 && q < lines.length - 1)
      warnings.push(`${where}: kept ${lines.length - 1 - q} line(s) after the question mark as question text. Delete them if they're page text.`)
  } else if (firstMarked > 0) {
    promptLines = lines.slice(0, firstMarked)
    choiceLines = lines.slice(firstMarked)
  } else {
    // No letters or bullets: the question ends at the first line ending in "?" (or ":"), and every
    // line after it is a choice.
    const end = lines.findIndex((l) => /[?:]\s*$/.test(l))
    if (end === -1 || end === lines.length - 1) {
      promptLines = lines
    } else {
      promptLines = lines.slice(0, end + 1)
      choiceLines = lines.slice(end + 1)
    }
  }

  if (choiceLines.length === 1) {
    // One line after the question isn't a multiple choice question; keep it as part of the question.
    promptLines = [...promptLines, ...choiceLines]
    choiceLines = []
    warnings.push(`${where}: one line after the question looked like a lone choice, so it was kept as question text. Check it.`)
  }

  let prompt = promptLines.join('\n').trim()
  if (prompt.length > MAX_PROMPT) {
    prompt = prompt.slice(0, MAX_PROMPT)
    warnings.push(`${where}: the question was too long and was cut to ${MAX_PROMPT} characters.`)
  }
  if (lines.length > 12) warnings.push(`${where} picked up ${lines.length} lines. Some of it may be page text, not the question.`)

  if (!choiceLines.length) {
    if (kindHint === 'mc') warnings.push(`${where}: Edpuzzle called this multiple choice but no choices came through. It's short answer for now.`)
    return { at_s: b.at, kind: 'short', prompt, choices: [], correct_index: null }
  }

  let correct: number | null = null
  let conflicting = false
  let choices = choiceLines.map((l, i) => {
    let t = l
    if (CORRECT_MARK.test(t)) {
      if (correct === null) correct = i
      else conflicting = true
      t = t.replace(CORRECT_MARK, '')
    }
    return t.replace(CHOICE_PREFIX, '').replace(CORRECT_MARK, '').trim()
  })

  if (answer !== null && correct === null) {
    const a = answer.replace(/[).]$/, '').trim()
    if (/^[a-f]$/i.test(a) && a.toLowerCase().charCodeAt(0) - 97 < choices.length) correct = a.toLowerCase().charCodeAt(0) - 97
    else {
      const byText = choices.findIndex((c) => c.toLowerCase() === a.toLowerCase())
      if (byText !== -1) correct = byText
    }
  }

  if (conflicting) {
    // Edpuzzle allows several right answers; Oasis grades one. Make the teacher choose.
    correct = null
    warnings.push(`${where} had more than one right answer marked. Oasis takes one, so pick it.`)
  }

  const empties = choices.some((c) => !c)
  choices = choices.filter(Boolean)
  if (empties && correct !== null) correct = null

  if (choices.length > MAX_CHOICES) {
    warnings.push(`${where} had ${choices.length} choices. Oasis allows ${MAX_CHOICES}, so the extras were dropped.`)
    choices = choices.slice(0, MAX_CHOICES)
    if (correct !== null && correct >= MAX_CHOICES) correct = null
  }
  if (choices.length < 2) return { at_s: b.at, kind: 'short', prompt, choices: [], correct_index: null }

  return { at_s: b.at, kind: 'mc', prompt, choices, correct_index: correct }
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
