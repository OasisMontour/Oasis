import { describe, expect, it } from 'vitest'
import { safeNext } from './next'

describe('safeNext', () => {
  it('sends students back to the assignment they opened from Classroom', () => {
    expect(safeNext('/student/assignments/abc', 'student')).toBe('/student/assignments/abc')
  })
  it('falls back to home when there is nothing saved', () => {
    expect(safeNext(null, 'student')).toBe('/student')
    expect(safeNext(null, 'teacher')).toBe('/teacher')
  })
  it("ignores paths outside the user's own area", () => {
    expect(safeNext('/teacher/lessons/x', 'student')).toBe('/student')
    expect(safeNext('/student/assignments/x', 'teacher')).toBe('/teacher')
  })
  it('ignores anything that could leave the site', () => {
    expect(safeNext('https://evil.example/student/x', 'student')).toBe('/student')
    expect(safeNext('//evil.example/student/x', 'student')).toBe('/student')
    expect(safeNext('/student/\\evil.example', 'student')).toBe('/student')
  })
})
