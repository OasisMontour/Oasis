import { describe, expect, it } from 'vitest'
import { accountState } from './accountState'

const profile = { id: 'u', role: 'teacher' as const, name: 'T', email: 't@d.org' }

describe('accountState (audit #26)', () => {
  it('ok lookups', () => {
    expect(accountState({ data: profile, error: null }, { data: true, error: null })).toEqual({ profile, isAdmin: true, profileError: false, adminError: false })
  })
  it('a failed admin check is an error, not "not an admin"', () => {
    expect(accountState({ data: profile, error: null }, { data: null, error: { message: 'Failed to fetch' } })).toMatchObject({ isAdmin: false, adminError: true })
  })
  it('a failed profile lookup is an error', () => {
    expect(accountState({ data: null, error: { message: 'Failed to fetch' } }, { data: false, error: null }).profileError).toBe(true)
  })
  it('no profile row yet is not an error', () => {
    expect(accountState({ data: null, error: { code: 'PGRST116' } }, { data: false, error: null }).profileError).toBe(false)
  })
})
