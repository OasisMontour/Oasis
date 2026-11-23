import { describe, expect, it } from 'vitest'
import {
  assignmentStatus,
  canFinish,
  classifyRpcError,
  dueLabel,
  dueQuestion,
  needsReconnect,
  progressPct,
  progressToSave,
  splitAssignments,
  tick,
  type PlayerQuestion,
  type StudentAssignmentRow,
} from './player'

const q = (id: string, at_s: number): PlayerQuestion => ({ id, at_s, kind: 'mc', prompt: id, choices: ['a', 'b'], answered: false })
const Q = [q('q1', 45), q('q2', 200), q('q3', 420)]
const none = new Set<string>()

describe('tick', () => {
  it('advances max watched with normal playback', () => {
    expect(tick({ current: 10.25, maxWatched: 10, durationS: 600, questions: Q, answered: none })).toEqual({
      maxWatched: 10.25,
      snapBack: false,
      question: null,
    })
  })

  it('snaps back when the playhead jumps past what was watched', () => {
    const t = tick({ current: 100, maxWatched: 10, durationS: 600, questions: Q, answered: none })
    expect(t.snapBack).toBe(true)
    expect(t.maxWatched).toBe(10)
  })

  it('allows watching back over old parts without moving max', () => {
    const t = tick({ current: 5, maxWatched: 40, durationS: 600, questions: Q, answered: none })
    expect(t).toEqual({ maxWatched: 40, snapBack: false, question: null })
  })

  it('stops at the next unanswered question and never records past it', () => {
    const t = tick({ current: 45.2, maxWatched: 45, durationS: 600, questions: Q, answered: none })
    expect(t.question?.id).toBe('q1')
    expect(t.maxWatched).toBe(45)
  })

  it('moves on once the question is answered', () => {
    const t = tick({ current: 45.5, maxWatched: 45, durationS: 600, questions: Q, answered: new Set(['q1']) })
    expect(t.question).toBeNull()
    expect(t.maxWatched).toBe(45.5)
  })

  it('shows an unanswered question a teacher added behind the student', () => {
    const t = tick({ current: 300, maxWatched: 300, durationS: 600, questions: Q, answered: new Set(['q1']) })
    expect(t.question?.id).toBe('q2')
  })

  it('caps max watched at the stored length', () => {
    const t = tick({ current: 600.4, maxWatched: 600, durationS: 600, questions: [], answered: none })
    expect(t.maxWatched).toBe(600)
  })

  it('ignores NaN from a player that is not ready', () => {
    expect(tick({ current: NaN, maxWatched: 3, durationS: 600, questions: Q, answered: none }).maxWatched).toBe(3)
  })
})

describe('dueQuestion', () => {
  it('returns questions at time 0 immediately', () => {
    expect(dueQuestion([q('a', 0)], none, 0)?.id).toBe('a')
  })
  it('keeps server order for two questions at the same time', () => {
    const qs = [q('a', 10), q('b', 10)]
    expect(dueQuestion(qs, none, 10)?.id).toBe('a')
    expect(dueQuestion(qs, new Set(['a']), 10)?.id).toBe('b')
  })
})

describe('saving', () => {
  it('clamps to the stored duration and rounds', () => {
    expect(progressToSave(600.43, 600)).toBe(600)
    expect(progressToSave(12.345, 600)).toBe(12.3)
    expect(progressToSave(NaN, 600)).toBe(0)
    expect(progressToSave(-1, 600)).toBe(0)
  })
  it('pauses for reconnect when too far ahead of the last good save', () => {
    expect(needsReconnect(119, 100)).toBe(false)
    expect(needsReconnect(120, 100)).toBe(true)
  })
  it('finishes only with the video watched and every question answered', () => {
    expect(canFinish(598, 600, Q, new Set(['q1', 'q2', 'q3']))).toBe(true)
    expect(canFinish(597, 600, Q, new Set(['q1', 'q2', 'q3']))).toBe(false)
    expect(canFinish(600, 600, Q, new Set(['q1', 'q2']))).toBe(false)
  })
})

describe('classifyRpcError', () => {
  it.each([
    ['not assigned to you', 'not_assigned'],
    ['progress jump rejected', 'jump_rejected'],
    ['video not finished', 'not_finished'],
    ['unanswered questions', 'unanswered'],
    ['already answered', 'already_answered'],
    ['you have not reached this question yet', 'not_reached'],
    ['TypeError: Failed to fetch', 'network'],
    ['something else', 'other'],
  ])('%s -> %s', (message, kind) => {
    expect(classifyRpcError({ message })).toBe(kind)
  })
})

describe('assignment list', () => {
  const row = (id: string, due_at: string | null, attempt?: { max_watched_s: number; finished_at: string | null }): StudentAssignmentRow => ({
    id,
    due_at,
    created_at: `2026-11-${id.padStart(2, '0')}T00:00:00Z`,
    lessons: { title: id, duration_s: 600, youtube_id: 'aaaaaaaaaaa' },
    classes: { name: 'P3' },
    attempts: attempt ? [attempt] : [],
  })

  it('works out status and progress', () => {
    expect(assignmentStatus(row('1', null))).toBe('not_started')
    expect(assignmentStatus(row('1', null, { max_watched_s: 0, finished_at: null }))).toBe('not_started')
    expect(assignmentStatus(row('1', null, { max_watched_s: 30, finished_at: null }))).toBe('in_progress')
    expect(progressPct(row('1', null, { max_watched_s: 300, finished_at: null }))).toBe(50)
    expect(progressPct(row('1', null, { max_watched_s: 600, finished_at: null }))).toBe(99)
    expect(progressPct(row('1', null, { max_watched_s: 600, finished_at: '2026-11-20T00:00:00Z' }))).toBe(100)
  })

  it('sorts to-do by due date, undated last', () => {
    const { todo, done } = splitAssignments([
      row('1', null),
      row('2', '2026-11-30T00:00:00Z'),
      row('3', '2026-11-25T00:00:00Z'),
      row('4', null, { max_watched_s: 600, finished_at: '2026-11-20T00:00:00Z' }),
    ])
    expect(todo.map((r) => r.id)).toEqual(['3', '2', '1'])
    expect(done.map((r) => r.id)).toEqual(['4'])
  })
})

describe('dueLabel', () => {
  const now = new Date(2026, 10, 23, 9, 0)
  it('says today, tomorrow, late', () => {
    expect(dueLabel(new Date(2026, 10, 23, 15, 0).toISOString(), now)?.text).toMatch(/^Due today/)
    expect(dueLabel(new Date(2026, 10, 24, 15, 0).toISOString(), now)?.text).toMatch(/^Due tomorrow/)
    expect(dueLabel(new Date(2026, 10, 20, 15, 0).toISOString(), now)).toMatchObject({ late: true })
    expect(dueLabel(null, now)).toBeNull()
  })
})
