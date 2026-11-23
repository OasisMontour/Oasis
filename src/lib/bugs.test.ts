import { describe, expect, it } from 'vitest'
import { reportPage } from './bugs'

describe('reportPage', () => {
  it('keeps app paths', () => expect(reportPage('/student/assignments/abc')).toBe('/student/assignments/abc'))
  it('drops full URLs and protocol-relative paths', () => {
    expect(reportPage('https://evil.example/x')).toBe('')
    expect(reportPage('//evil.example')).toBe('')
    expect(reportPage('javascript:alert(1)')).toBe('')
    expect(reportPage('/\\evil.example')).toBe('')
    expect(reportPage('/%2F%2Fevil.example')).toBe('')
  })
  it('handles missing', () => expect(reportPage(null)).toBe(''))
  it('drops overlong paths', () => expect(reportPage('/' + 'a'.repeat(500))).toBe(''))
})
