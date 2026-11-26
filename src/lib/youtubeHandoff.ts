import { parseYouTubeId } from './youtube'

/**
 * Arrivals from the "Send to Oasis" Chrome extension (extension/ in this repo), or any plain link like
 * /teacher/lessons/new?v=VIDEO_ID.
 *
 * ?v= carries the video. The extension also puts the video's title and caption transcript in the #yt= fragment,
 * which browsers never send to a server (and which survives the sign-in redirect, see lib/next.ts). Anyone can
 * craft these links, so everything here is validated and only pre-fills the form. Nothing is saved until Save.
 */

export const HANDOFF_HASH_KEY = 'yt'
/** Hard cap on what we accept from the fragment. The AI box still enforces its own, smaller limit. */
const MAX_TRANSCRIPT = 80_000
const MAX_TITLE = 200

export type TranscriptStatus = 'ok' | 'none' | 'failed' | 'skipped'

export type YouTubeHandoff = {
  videoId: string
  title: string
  transcript: string
  /** 'none' = video has no captions; 'failed' = it has some but the extension couldn't read them. */
  transcriptStatus: TranscriptStatus | null
  /** True when the captions were YouTube's auto-generated ones. */
  autoCaptions: boolean
}

export function readYouTubeHandoff(search: string, hash: string): YouTubeHandoff | null {
  const v = new URLSearchParams(search).get('v')
  const videoId = v ? parseYouTubeId(v) : null
  if (!videoId) return null
  const out: YouTubeHandoff = { videoId, title: '', transcript: '', transcriptStatus: null, autoCaptions: false }
  const m = new RegExp(`(?:^#|&)${HANDOFF_HASH_KEY}=([^&]*)`).exec(hash)
  if (!m) return out
  try {
    const p = JSON.parse(decodeURIComponent(m[1]))
    // A fragment for a different video than ?v= is stale or tampered with: ignore it, keep the video.
    if (!p || p.v !== 1 || p.id !== videoId) return out
    if (typeof p.title === 'string') out.title = clean(p.title).slice(0, MAX_TITLE)
    if (typeof p.transcript === 'string') out.transcript = p.transcript.replace(/\r\n?/g, '\n').slice(0, MAX_TRANSCRIPT).trim()
    if (['ok', 'none', 'failed', 'skipped'].includes(p.status)) out.transcriptStatus = p.status
    if (out.transcriptStatus === 'ok' && !out.transcript) out.transcriptStatus = 'failed'
    out.autoCaptions = p.auto === true
  } catch {
    // Bad JSON: keep just the video.
  }
  return out
}

function clean(s: string): string {
  // Control characters only; React escapes everything else.
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Cuts a long transcript down to the AI box's limit on a line boundary, so no timestamp is chopped in half.
 * Keeps the start of the video: that's what a teacher would keep by hand too.
 */
export function trimTranscript(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const nl = cut.lastIndexOf('\n')
  return (nl > max * 0.5 ? cut.slice(0, nl) : cut).trimEnd()
}

/** The line shown above the builder after an arrival. */
export function handoffMessage(h: YouTubeHandoff): { kind: 'ok' | 'error'; text: string } | null {
  switch (h.transcriptStatus) {
    case 'ok':
      return {
        kind: 'ok',
        text:
          'Brought over this video and its transcript' +
          (h.autoCaptions ? " (YouTube's auto-generated captions, so expect some wrong words)" : '') +
          '. The transcript is in "Draft questions with AI" below. Check it, then draft questions or write your own.',
      }
    case 'none':
      return { kind: 'ok', text: "Brought over this video. It has no captions on YouTube, so there's no transcript: write questions yourself or paste your own notes into the AI box." }
    case 'failed':
      return { kind: 'error', text: "Brought over this video, but couldn't read its transcript. On YouTube, open ⋯ › Show transcript and copy it into the AI box below." }
    default:
      return null
  }
}
