/**
 * Runs inside the YouTube tab (chrome.scripting.executeScript, world: 'MAIN') when the teacher clicks
 * "Send to Oasis". It reads the video the teacher is already watching: its id, title, length, and the caption
 * transcript YouTube already offers on that page. It sends nothing anywhere: the popup takes the result and
 * opens Oasis with it in the URL #fragment.
 *
 * MUST stay self-contained (no imports, no outer variables): Chrome serializes it with toString().
 *
 * Transcript, in order of preference:
 *  1. The caption track's own URL from the player response (what the player itself fetches), as json3.
 *     YouTube sometimes answers this with an empty body (it wants a player-only token), so:
 *  2. The "Show transcript" panel: open it the way a teacher would and read the lines off the page.
 * Neither is an official API. YouTube changes its page often, so either can break; the builder copes with
 * "couldn't read the transcript" and the teacher can still paste it by hand.
 *
 * @param {{ transcript?: boolean, fetch?: typeof fetch, wait?: (ms: number) => Promise<void>, panelTimeoutMs?: number }} [deps]
 *   transcript: false skips the transcript (the popup passes this). The rest are only for tests; in the tab, the
 *   page's own fetch and setTimeout are used.
 */
export async function collectYouTube(deps) {
  const d = deps || {}
  const doFetch = d.fetch || ((u, o) => fetch(u, o))
  const wait = d.wait || ((ms) => new Promise((r) => setTimeout(r, ms)))
  const panelTimeout = d.panelTimeoutMs == null ? 8000 : d.panelTimeoutMs

  const host = location.hostname.replace(/^(www\.|m\.)/, '')
  if (host !== 'youtube.com') return { ok: false, reason: 'not_youtube' }
  const url = new URL(location.href)
  let id = url.searchParams.get('v')
  if (!id) {
    const m = /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/.exec(url.pathname)
    if (m) id = m[1]
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return { ok: false, reason: 'no_video' }

  // The player's current response. window.ytInitialPlayerResponse goes stale when you click from video to video
  // (YouTube is a single-page app), so check it's for THIS video before trusting it.
  let pr = null
  try {
    const p = document.getElementById('movie_player')
    if (p && typeof p.getPlayerResponse === 'function') pr = p.getPlayerResponse()
  } catch (e) { /* ignore */ }
  if (!pr || !pr.videoDetails || pr.videoDetails.videoId !== id) {
    const w = window.ytInitialPlayerResponse
    pr = w && w.videoDetails && w.videoDetails.videoId === id ? w : null
  }
  const details = (pr && pr.videoDetails) || {}
  let title = typeof details.title === 'string' ? details.title : ''
  if (!title) title = (document.title || '').replace(/\s*-\s*YouTube\s*$/, '').replace(/^\(\d+\)\s*/, '')
  const lengthS = Number(details.lengthSeconds) || null
  const base = { ok: true, videoId: id, title: title.slice(0, 200), lengthS }
  if (d.transcript === false) return { ...base, status: 'skipped', segments: [] }

  // ---- 1. caption tracks
  const tracks = (pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks) || []
  const lang = ((navigator.language || 'en').split('-')[0] || 'en').toLowerCase()
  const score = (t) => {
    let s = 0
    if (t.kind !== 'asr') s += 4 // a real, human caption track beats auto-generated
    const tl = String(t.languageCode || '').toLowerCase().split('-')[0]
    if (tl === lang) s += 2
    else if (tl === 'en') s += 1
    return s
  }
  const sorted = tracks.filter((t) => t && typeof t.baseUrl === 'string').sort((a, b) => score(b) - score(a))
  const segsFromJson3 = (j) => {
    const out = []
    for (const ev of (j && j.events) || []) {
      if (!ev.segs || typeof ev.tStartMs !== 'number') continue
      const text = ev.segs.map((x) => x.utf8 || '').join('').replace(/\s+/g, ' ').trim()
      if (text) out.push({ s: Math.floor(ev.tStartMs / 1000), t: text })
    }
    return out
  }
  for (const t of sorted.slice(0, 2)) {
    try {
      const u = new URL(t.baseUrl, location.origin)
      if (!/(^|\.)youtube\.com$/.test(u.hostname)) continue
      u.searchParams.set('fmt', 'json3')
      const res = await doFetch(u.toString(), { credentials: 'include' })
      if (!res.ok) continue
      const body = await res.text()
      if (!body.trim()) continue
      const segs = segsFromJson3(JSON.parse(body))
      if (segs.length) return { ...base, status: 'ok', via: 'captions', auto: t.kind === 'asr', lang: t.languageCode || '', segments: segs }
    } catch (e) { /* try the next way */ }
  }

  // ---- 2. the transcript panel
  const toSec = (ts) => {
    const p = ts.split(':').map(Number)
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]
  }
  // Reads "0:05 / text" pairs from whatever transcript panel is on the page. YouTube has shipped at least two
  // (ytd-transcript-segment-renderer, and the newer PAmodern_transcript_view), so this goes by the visible text
  // (a timestamp line, then the words) instead of by element names.
  const TS = /^(\d{1,2}:\d{2}(?::\d{2})?)$/
  const fromLines = (text) => {
    const out = []
    const lines = String(text || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    for (let i = 0; i < lines.length; i++) {
      const one = /^(\d{1,2}:\d{2}(?::\d{2})?) (.+)$/.exec(lines[i])
      if (one && !TS.test(one[2])) out.push({ s: toSec(one[1]), t: one[2] })
      else if (TS.test(lines[i]) && lines[i + 1] && !TS.test(lines[i + 1])) out.push({ s: toSec(lines[i]), t: lines[++i] })
    }
    return out
  }
  const readPanel = () => {
    const segEls = document.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model')
    if (segEls.length) {
      const out = []
      for (const el of segEls) out.push(...fromLines(el.innerText || el.textContent || ''))
      if (out.length) return out
    }
    const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer')
    for (const p of panels) {
      const tid = (p.getAttribute('target-id') || '') + ' ' + (p.getAttribute('visibility') || '')
      if (!/transcript/i.test(tid) || !/EXPANDED/.test(tid)) continue
      const out = fromLines(p.innerText || '')
      if (out.length >= 2) return out
    }
    return []
  }
  let segs = readPanel()
  if (!segs.length) {
    // There can be two "Show transcript" buttons (one inside the collapsed description). Click a visible one.
    const cands = Array.from(document.querySelectorAll('ytd-video-description-transcript-section-renderer button'))
    if (!cands.length) {
      for (const b of Array.from(document.querySelectorAll('button[aria-label], ytd-button-renderer button'))) {
        if (/transcript/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || ''))) cands.push(b)
      }
    }
    const btn = cands.find((b) => b.offsetParent != null) || cands[0] || null
    if (btn) {
      try { btn.click() } catch (e) { /* ignore */ }
      for (let waited = 0; waited < panelTimeout && !segs.length; waited += 250) {
        await wait(250)
        segs = readPanel()
      }
    }
    if (!segs.length) return { ...base, status: sorted.length || btn ? 'failed' : 'none', segments: [] }
  }
  // The panel doesn't say whether the captions are auto-generated; the tracks list does.
  const auto = sorted.length > 0 && sorted.every((t) => t.kind === 'asr')
  return { ...base, status: 'ok', via: 'panel', auto, lang: '', segments: segs }
}
