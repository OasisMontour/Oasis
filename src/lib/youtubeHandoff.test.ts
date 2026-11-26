import { describe, expect, it } from 'vitest'
import { handoffMessage, readYouTubeHandoff, trimTranscript } from './youtubeHandoff'

const ID = 'dQw4w9WgXcQ'
const hash = (p: unknown) => '#yt=' + encodeURIComponent(JSON.stringify(p))

describe('readYouTubeHandoff', () => {
  it('needs a valid ?v=', () => {
    expect(readYouTubeHandoff('', '')).toBeNull()
    expect(readYouTubeHandoff('?v=nope', '')).toBeNull()
    expect(readYouTubeHandoff(`?v=${ID}`, '')).toEqual({ videoId: ID, title: '', transcript: '', transcriptStatus: null, autoCaptions: false })
  })

  it('accepts a full YouTube link in ?v=', () => {
    expect(readYouTubeHandoff(`?v=${encodeURIComponent('https://youtu.be/' + ID)}`, '')?.videoId).toBe(ID)
  })

  it('ignores a fragment for a different video, bad JSON, and unknown statuses', () => {
    expect(readYouTubeHandoff(`?v=${ID}`, hash({ v: 1, id: 'zzzzzzzzzzz', title: 'X', transcript: 'y', status: 'ok' }))?.transcript).toBe('')
    expect(readYouTubeHandoff(`?v=${ID}`, '#yt=%7Bnope')?.videoId).toBe(ID)
    expect(readYouTubeHandoff(`?v=${ID}`, hash({ v: 1, id: ID, status: 'pwned' }))?.transcriptStatus).toBeNull()
  })

  it('cleans the title and caps sizes', () => {
    const h = readYouTubeHandoff(`?v=${ID}`, hash({ v: 1, id: ID, title: 'a\u0000\nb  ' + 'x'.repeat(500), transcript: 'z'.repeat(100_000), status: 'ok' }))!
    expect(h.title.startsWith('a b x')).toBe(true)
    expect(h.title.length).toBe(200)
    expect(h.transcript.length).toBe(80_000)
  })

  it('an "ok" with an empty transcript is reported as failed', () => {
    const h = readYouTubeHandoff(`?v=${ID}`, hash({ v: 1, id: ID, transcript: '  ', status: 'ok' }))!
    expect(h.transcriptStatus).toBe('failed')
    expect(handoffMessage(h)?.kind).toBe('error')
  })
})

describe('trimTranscript', () => {
  it('cuts on a line boundary', () => {
    expect(trimTranscript('0:00 aaaa\n0:20 bbbb\n0:40 cccc', 22)).toBe('0:00 aaaa\n0:20 bbbb')
    expect(trimTranscript('short', 100)).toBe('short')
  })
})
