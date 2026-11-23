import { describe, expect, it } from 'vitest'
import { pendingText, refusedText } from './teacherSignup'

describe('teacher sign-up copy', () => {
  it('explains every reason the database can return', () => {
    for (const r of ['personal_account', 'trusted_domain', 'on_student_roster', 'not_verified']) expect(pendingText(r)).not.toBe(pendingText('x'))
    for (const r of ['no_courses', 'wrong_account', 'student_account', 'blocked', 'removed']) expect(refusedText(r, 'a@b.org')).not.toBe(refusedText('x', 'a@b.org'))
  })
  it('tells a wrong-account user which account to pick', () => {
    expect(refusedText('wrong_account', 'me@district.org')).toContain('me@district.org')
  })
})
