import { describe, expect, it } from 'vitest'
import { looksLikeEmail, teacherStatus, type AdminTeacher } from './admin'

const base: AdminTeacher = {
  email: 't@district.org', name: 'T', on_allowlist: true, added_at: null, added_by: null, role: 'teacher',
  classroom_connected: true, last_synced_at: null, classes: 2, students: 40, lessons: 3, assignments: 1,
}

describe('teacherStatus', () => {
  it('invited but not signed in', () => expect(teacherStatus({ ...base, role: null })).toEqual({ label: 'Invited, not signed in yet', warn: false }))
  it('signed in as student is a warning', () => expect(teacherStatus({ ...base, role: 'student' }).warn).toBe(true))
  it('teacher off the allowlist is a warning', () => expect(teacherStatus({ ...base, on_allowlist: false }).label).toMatch(/not on allowlist/))
  it('no Classroom', () => expect(teacherStatus({ ...base, classroom_connected: false }).label).toBe('Classroom not connected'))
  it('no classes', () => expect(teacherStatus({ ...base, classes: 0 }).label).toBe('No classes synced'))
  it('active', () => expect(teacherStatus(base)).toEqual({ label: 'Active', warn: false }))
})

describe('looksLikeEmail', () => {
  it('accepts normal addresses with spaces around', () => expect(looksLikeEmail('  a.b@district.k12.pa.us ')).toBe(true))
  it('rejects junk', () => {
    expect(looksLikeEmail('nope')).toBe(false)
    expect(looksLikeEmail('a@b')).toBe(false)
    expect(looksLikeEmail('a b@c.d')).toBe(false)
  })
})

import { formatDuration } from './duration'
describe('formatDuration', () => {
  it('formats', () => {
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(20)).toBe('1m')
    expect(formatDuration(59 * 60)).toBe('59m')
    expect(formatDuration(5400)).toBe('1h 30m')
    expect(formatDuration(7200)).toBe('2h')
  })
})
