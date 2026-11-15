import { describe, expect, it } from 'vitest'
import { parseYouTubeId } from './youtube'
describe('parseYouTubeId', () => {
  it('handles the usual link shapes', () => {
    for (const s of [
      'dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    ])
      expect(parseYouTubeId(s), s).toBe('dQw4w9WgXcQ')
  })
  it('rejects non-YouTube links', () => {
    expect(parseYouTubeId('https://vimeo.com/123')).toBeNull()
    expect(parseYouTubeId('https://evil.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(parseYouTubeId('hello')).toBeNull()
  })
})
