import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectYouTube } from './collect.js'
import { formatTranscript, oasisUrl } from './handoff.js'
import { readYouTubeHandoff } from '../src/lib/youtubeHandoff'

const ID = 'dQw4w9WgXcQ'

function page({ href = `https://www.youtube.com/watch?v=${ID}&t=3`, pr, segments = [], transcriptButton = false, panelAfterClick = [], modernAfterClick = null } = {}) {
  let panel = segments
  let modern = null
  const button = { click: () => { panel = panelAfterClick; modern = modernAfterClick }, getAttribute: () => 'Show transcript', textContent: 'Show transcript', offsetParent: {} }
  const doc = {
    title: '(3) A video - YouTube',
    getElementById: (id) => (id === 'movie_player' && pr ? { getPlayerResponse: () => pr } : null),
    querySelectorAll: (sel) =>
      sel.includes('segment') ? panel.map((t) => ({ innerText: t }))
      : sel.includes('transcript-section') ? (transcriptButton ? [{ ...button, offsetParent: null }, button] : [])
      : sel.includes('engagement-panel') && modern ? [
          { getAttribute: (k) => ({ 'target-id': 'PAsearch_preview', visibility: 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN' })[k], innerText: '0:01\nnope\n0:02\nnope' },
          { getAttribute: (k) => ({ 'target-id': 'PAmodern_transcript_view', visibility: 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' })[k], innerText: modern },
        ]
      : [],
  }
  const u = new URL(href)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('location', { hostname: u.hostname, href, origin: u.origin })
  vi.stubGlobal('window', {})
  vi.stubGlobal('navigator', { language: 'en-US' })
}

const playerResponse = (tracks) => ({
  videoDetails: { videoId: ID, title: 'Cells & Energy', lengthSeconds: '600' },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
})
const json3 = (events) => ({ ok: true, text: async () => JSON.stringify({ events }) })
const run = (fetch, extra = {}) => collectYouTube({ fetch, wait: async () => {}, panelTimeoutMs: 1000, ...extra })

afterEach(() => vi.unstubAllGlobals())

describe('collectYouTube', () => {
  it('refuses pages that are not YouTube videos', async () => {
    page({ href: 'https://example.com/watch?v=' + ID })
    expect(await run()).toEqual({ ok: false, reason: 'not_youtube' })
    page({ href: 'https://www.youtube.com/feed/subscriptions' })
    expect(await run()).toEqual({ ok: false, reason: 'no_video' })
  })

  it('reads the caption track, preferring human captions over auto ones', async () => {
    page({ pr: playerResponse([
      { baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en&kind=asr', languageCode: 'en', kind: 'asr' },
      { baseUrl: '/api/timedtext?v=x&lang=en', languageCode: 'en' },
    ]) })
    const fetch = vi.fn(async () => json3([{ tStartMs: 1500, segs: [{ utf8: 'Hello ' }, { utf8: 'class' }] }, { tStartMs: 4000 }, { tStartMs: 62000, segs: [{ utf8: '\n' }] }]))
    const r = await run(fetch)
    expect(fetch.mock.calls[0][0]).toBe('https://www.youtube.com/api/timedtext?v=x&lang=en&fmt=json3')
    expect(r).toMatchObject({ ok: true, videoId: ID, title: 'Cells & Energy', lengthS: 600, status: 'ok', via: 'captions', auto: false })
    expect(r.segments).toEqual([{ s: 1, t: 'Hello class' }])
  })

  it('falls back to the transcript panel when the caption URL comes back empty', async () => {
    page({ pr: playerResponse([{ baseUrl: '/api/timedtext?v=x', languageCode: 'en', kind: 'asr' }]), transcriptButton: true, panelAfterClick: ['0:05\nfirst line', '1:02:03 \n later'] })
    const r = await run(async () => ({ ok: true, text: async () => '' }))
    expect(r).toMatchObject({ status: 'ok', via: 'panel', auto: true })
    expect(r.segments).toEqual([{ s: 5, t: 'first line' }, { s: 3723, t: 'later' }])
  })

  it('reads the newer transcript panel by its text, whatever the elements are called', async () => {
    page({ pr: playerResponse([{ baseUrl: '/api/timedtext', languageCode: 'en' }]), transcriptButton: true,
      modernAfterClick: 'Transcript\nSearch\n0:00\n\n♪ We\'re no strangers to love ♪\n0:22\nYou know the rules\n1:05:09 and so do I' })
    const r = await run(async () => ({ ok: true, text: async () => '' }))
    expect(r).toMatchObject({ status: 'ok', via: 'panel', auto: false })
    expect(r.segments).toEqual([{ s: 0, t: "♪ We're no strangers to love ♪" }, { s: 22, t: 'You know the rules' }, { s: 3909, t: 'and so do I' }])
  })

  it('says "none" for a video without captions, and "failed" when it has some it could not read', async () => {
    page({ pr: playerResponse([]) })
    expect(await run(vi.fn())).toMatchObject({ ok: true, status: 'none', segments: [] })
    page({ pr: playerResponse([{ baseUrl: '/api/timedtext', languageCode: 'en' }]), transcriptButton: true })
    expect(await run(async () => { throw new Error('blocked') })).toMatchObject({ ok: true, status: 'failed' })
  })

  it('ignores a stale player response from the previous video and falls back to the tab title', async () => {
    page({ pr: { videoDetails: { videoId: 'zzzzzzzzzzz', title: 'Old' } } })
    const r = await run(vi.fn())
    expect(r).toMatchObject({ ok: true, videoId: ID, title: 'A video', status: 'none' })
  })

  it('skips the transcript when asked to', async () => {
    page({ pr: playerResponse([{ baseUrl: '/api/timedtext', languageCode: 'en' }]) })
    const fetch = vi.fn()
    expect(await run(fetch, { transcript: false })).toMatchObject({ ok: true, status: 'skipped' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('still works after Chrome serializes it (no outer variables or imports)', async () => {
    page({ pr: playerResponse([]) })
    const serialized = new Function(`return (${collectYouTube.toString()})`)()
    expect(await serialized({ fetch: vi.fn(), wait: async () => {} })).toMatchObject({ ok: true, videoId: ID, status: 'none' })
  })

  it('handles /shorts/ links', async () => {
    page({ href: `https://www.youtube.com/shorts/${ID}` })
    expect(await run(vi.fn())).toMatchObject({ ok: true, videoId: ID })
  })
})

describe('formatTranscript', () => {
  it('merges snippets into ~20 s lines and drops [Music]', () => {
    const t = formatTranscript([{ s: 0, t: 'Hi' }, { s: 3, t: '[Music]' }, { s: 5, t: 'there.' }, { s: 21, t: 'Next' }, { s: 3725, t: 'Late' }])
    expect(t).toBe('0:00 Hi there.\n0:21 Next\n1:02:05 Late')
  })
})

describe('extension → builder round trip', () => {
  it('the link the extension builds is what the builder reads', () => {
    const url = new URL(oasisUrl('https://oasis.example', { ok: true, videoId: ID, title: 'Cells & Energy', status: 'ok', auto: true, segments: [{ s: 0, t: 'Hello' }] }))
    expect(url.pathname).toBe('/teacher/lessons/new')
    expect(readYouTubeHandoff(url.search, url.hash)).toEqual({ videoId: ID, title: 'Cells & Energy', transcript: '0:00 Hello', transcriptStatus: 'ok', autoCaptions: true })
  })

  it('without the transcript the builder just gets the video', () => {
    const url = new URL(oasisUrl('https://oasis.example', { ok: true, videoId: ID, title: 'T', status: 'ok', segments: [{ s: 0, t: 'Hello' }] }, false))
    expect(readYouTubeHandoff(url.search, url.hash)).toMatchObject({ transcript: '', transcriptStatus: 'skipped' })
  })
})
