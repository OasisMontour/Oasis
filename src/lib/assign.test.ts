import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))
vi.mock('./invokeFn', () => ({ invokeFn: vi.fn() }))

const { classroomStatus, localNow } = await import('./assign')

describe('classroomStatus', () => {
  it('reads draft, posted, deleted and not-yet', () => {
    expect(classroomStatus({ google_coursework_id: null, google_coursework_state: null })).toBe('none')
    expect(classroomStatus({ google_coursework_id: 'cw', google_coursework_state: 'DRAFT' })).toBe('DRAFT')
    expect(classroomStatus({ google_coursework_id: 'cw', google_coursework_state: 'DELETED' })).toBe('DELETED')
    // posted before drafts existed: those were published straight away
    expect(classroomStatus({ google_coursework_id: 'cw', google_coursework_state: null })).toBe('PUBLISHED')
  })
  it('formats now for datetime-local', () => {
    expect(localNow(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })
})
