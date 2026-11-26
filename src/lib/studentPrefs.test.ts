import { describe, expect, it } from 'vitest'
import { readPrefs } from './studentPrefs'

const store = (v: string | null) => ({ getItem: () => v })

describe('readPrefs', () => {
  it('defaults when nothing or junk is stored', () => {
    expect(readPrefs(store(null))).toEqual({ textSize: 'normal', contrast: 'normal', reduceMotion: false, captions: false })
    expect(readPrefs(store('{nope'))).toMatchObject({ textSize: 'normal' })
    expect(readPrefs(store('{"textSize":"huge","contrast":"x"}'))).toMatchObject({ textSize: 'normal', contrast: 'normal' })
  })
  it('reads saved values', () => {
    expect(readPrefs(store('{"textSize":"larger","contrast":"high","reduceMotion":true,"captions":true}'))).toEqual({
      textSize: 'larger',
      contrast: 'high',
      reduceMotion: true,
      captions: true,
    })
  })
})
