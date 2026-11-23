import { describe, expect, it } from 'vitest'
import { looksLikeDomain, looksLikeEmail, signupReason, teacherStatus, type AdminSignup, type AdminTeacher } from './admin'

const base: AdminTeacher = {
  email: 't@district.org', name: 'T', on_allowlist: true, via: 'allowlist', added_at: null, added_by: null, role: 'teacher',
  classroom_connected: true, last_synced_at: null, classes: 2, students: 40, lessons: 3, assignments: 1,
}

describe('teacherStatus', () => {
  it('pre-approved but not signed in', () => expect(teacherStatus({ ...base, role: null })).toEqual({ label: 'Pre-approved, not signed in yet', warn: false }))
  it('signed in as student is a warning', () => expect(teacherStatus({ ...base, role: 'student' }).warn).toBe(true))
  it('self-signed-up teachers off the allowlist are normal now', () =>
    expect(teacherStatus({ ...base, on_allowlist: false, via: 'verified_teacher' })).toEqual({ label: 'Active', warn: false }))
  it('no Classroom', () => expect(teacherStatus({ ...base, classroom_connected: false }).label).toBe('Classroom not connected'))
  it('no classes', () => expect(teacherStatus({ ...base, classes: 0 }).label).toBe('No classes synced'))
  it('active', () => expect(teacherStatus(base)).toEqual({ label: 'Active', warn: false }))
})

describe('sign-ups', () => {
  const s: AdminSignup = {
    user_id: 'u', email: 'x@gmail.com', name: 'X', reason: 'not_verified', requested_at: '',
    evidence: { hosted_domain: 'district.org', verified_teacher: false, active_courses: 2, students: 30, course_names: [] },
  }
  it('explains the reason', () => {
    expect(signupReason(s)).toContain('district.org')
    expect(signupReason({ ...s, reason: 'personal_account' })).toMatch(/Personal/)
  })
  it('domain check matches the server', () => {
    expect(looksLikeDomain(' @District.k12.pa.us')).toBe(true)
    expect(looksLikeDomain('district')).toBe(false)
    expect(looksLikeDomain('a b.org')).toBe(false)
  })
})

describe('looksLikeEmail', () => {
  it('accepts normal addresses with spaces around', () => expect(looksLikeEmail('  a.b@district.k12.pa.us ')).toBe(true))
  it('rejects junk', () => {
    expect(looksLikeEmail('nope')).toBe(false)
    expect(looksLikeEmail('a@b')).toBe(false)
    expect(looksLikeEmail('a b@c.d')).toBe(false)
    expect(looksLikeEmail('"><img/src=x/onerror=alert(1)>@a.bc')).toBe(false)
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
