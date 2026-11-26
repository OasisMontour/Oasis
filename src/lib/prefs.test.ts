import { describe, expect, it } from 'vitest'
import { readPrefs, readTeacherDefaults, resolveTheme } from './prefs'

const store = (v: string | null) => ({ getItem: () => v })

describe('readPrefs', () => {
  it('defaults when nothing or junk is stored', () => {
    expect(readPrefs(store(null))).toEqual({ theme: 'system', textSize: 'normal', contrast: 'normal', reduceMotion: false, captions: false })
    expect(readPrefs(store('{nope'))).toMatchObject({ textSize: 'normal', theme: 'system' })
    expect(readPrefs(store('{"textSize":"huge","contrast":"x","theme":"neon"}'))).toMatchObject({ textSize: 'normal', contrast: 'normal', theme: 'system' })
  })
  it('reads saved values', () => {
    expect(readPrefs(store('{"theme":"dark","textSize":"larger","contrast":"high","reduceMotion":true,"captions":true}'))).toEqual({
      theme: 'dark',
      textSize: 'larger',
      contrast: 'high',
      reduceMotion: true,
      captions: true,
    })
  })
  it('keeps settings saved before dark mode existed', () => {
    expect(readPrefs(store('{"textSize":"large","captions":true}'))).toMatchObject({ theme: 'system', textSize: 'large', captions: true })
  })
})

describe('resolveTheme', () => {
  it('follows the system only when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('readTeacherDefaults', () => {
  it('defaults match the builder: fullscreen on, feedback on, AI off', () => {
    expect(readTeacherDefaults(store(null))).toEqual({ fullscreen: true, showFeedback: true, aiGrade: false, instructions: '' })
    expect(readTeacherDefaults(store('garbage'))).toMatchObject({ fullscreen: true })
  })
  it('reads saved values and caps instructions', () => {
    const d = readTeacherDefaults(store(JSON.stringify({ fullscreen: false, showFeedback: false, aiGrade: true, instructions: 'x'.repeat(3000) })))
    expect(d).toMatchObject({ fullscreen: false, showFeedback: false, aiGrade: true })
    expect(d.instructions).toHaveLength(2000)
  })
})
