// Pure helpers the popup uses to turn what collect.js read into an Oasis link. Kept separate so tests can run them.

/** Biggest transcript we put in the link. The builder accepts up to 80,000 and its AI box up to 12,000. */
export const MAX_TRANSCRIPT = 60000

function clock(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/**
 * "m:ss text" lines, merging caption snippets into lines of at least `every` seconds. Caption snippets are a few
 * words each, so one timestamp per snippet roughly doubles the size for no gain; one per ~20 s keeps the AI's
 * pause points accurate enough and fits about twice as much video in the AI box.
 */
export function formatTranscript(segments, every = 20) {
  const lines = []
  let cur = null
  for (const seg of segments || []) {
    if (!seg || typeof seg.t !== 'string' || !Number.isFinite(seg.s)) continue
    const t = seg.t.replace(/\s+/g, ' ').trim()
    if (!t || /^\[[^\]]*\]$/.test(t)) continue // drop "[Music]", "[Applause]"
    if (cur && seg.s - cur.s < every) cur.t += ' ' + t
    else {
      if (cur) lines.push(cur)
      cur = { s: Math.max(0, Math.floor(seg.s)), t }
    }
  }
  if (cur) lines.push(cur)
  let out = ''
  for (const l of lines) {
    const line = `${clock(l.s)} ${l.t}\n`
    if (out.length + line.length > MAX_TRANSCRIPT) break
    out += line
  }
  return out.trimEnd()
}

/** The builder link. The video id rides in ?v=; title and transcript in the #fragment, which never reaches a server. */
export function oasisUrl(origin, r, includeTranscript = true) {
  const transcript = includeTranscript && r.status === 'ok' ? formatTranscript(r.segments) : ''
  const status = !includeTranscript ? 'skipped' : r.status === 'ok' && !transcript ? 'failed' : r.status
  const payload = { v: 1, id: r.videoId, title: r.title || '', status, auto: Boolean(r.auto), transcript }
  return `${origin}/teacher/lessons/new?v=${encodeURIComponent(r.videoId)}#yt=${encodeURIComponent(JSON.stringify(payload))}`
}
