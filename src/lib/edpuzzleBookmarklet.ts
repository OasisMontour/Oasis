/**
 * "Send to Oasis" bookmarklet for Edpuzzle.
 *
 * The teacher clicks it while looking at their own Edpuzzle lesson. It reads ONLY the page that is
 * already open in their tab: the visible text (same as select-all + copy) and the YouTube video id.
 * It makes no network requests, never touches Edpuzzle's API, and sees no credentials. It opens
 * Oasis with the data in the URL #fragment, which browsers never send to any server, and the
 * normal paste parser does the rest. The teacher still reviews and saves in the builder.
 *
 * Fragility: it depends on Edpuzzle showing the questions as text on the page. Because it reads
 * innerText instead of Edpuzzle's class names, page redesigns mostly don't break it.
 */

export const HASH_KEY = 'ep'
const MAX_TEXT = 150_000

export type BookmarkletPayload = { v: 1; text: string; yt: string | null; from: string }

/**
 * Runs inside the Edpuzzle tab. Must stay self-contained (no outer variables, no imports):
 * it is serialized with toString() into the bookmarklet.
 */
export function collect(doc: Document, loc: { hostname: string; href: string }, oasisUrl: string, open: (url: string) => void, warn: (msg: string) => void): void {
  if (!/(^|\.)edpuzzle\.com$/i.test(loc.hostname)) {
    warn('Open your lesson on edpuzzle.com first, then click "Send to Oasis".')
    return
  }
  const ytRe = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?(?:[^"'\s]*&)?v=|v\/|shorts\/)|youtu\.be\/|i\d?\.ytimg\.com\/vi(?:_webp)?\/|img\.youtube\.com\/vi\/)([A-Za-z0-9_-]{11})/
  let yt: string | null = null
  const els = doc.querySelectorAll('iframe[src], img[src], a[href], source[src], [style*="ytimg"], [style*="youtube"]')
  for (let i = 0; i < els.length && !yt; i++) {
    const el = els[i]
    const s = (el.getAttribute('src') || '') + ' ' + (el.getAttribute('href') || '') + ' ' + (el.getAttribute('style') || '')
    const m = ytRe.exec(s)
    if (m) yt = m[1]
  }
  if (!yt) {
    const m = ytRe.exec(doc.documentElement.innerHTML)
    if (m) yt = m[1]
  }
  const text = (doc.body.innerText || '').slice(0, 150000)
  if (!/\d:\d\d/.test(text)) {
    warn("Oasis couldn't find any question times on this page. Open the lesson's questions (the edit or preview view) and try again.")
    return
  }
  const payload = { v: 1, text: text, yt: yt, from: loc.href.split('?')[0].split('#')[0] }
  open(oasisUrl + '#ep=' + encodeURIComponent(JSON.stringify(payload)))
}

/** The javascript: URL teachers drag to their bookmarks bar. */
export function bookmarkletHref(origin: string): string {
  const target = `${origin}/teacher/lessons/new?from=edpuzzle`
  const body = `(${collect.toString()})(document,location,${JSON.stringify(target)},function(u){window.open(u,'_blank')},function(m){alert(m)})`
  return 'javascript:' + encodeURIComponent(`void ${body}`)
}

/** Reads what the bookmarklet sent. The fragment is untrusted (anyone can craft a link), so validate it. */
export function readBookmarkletHash(hash: string): BookmarkletPayload | null {
  const m = new RegExp(`(?:^#|&)${HASH_KEY}=([^&]*)`).exec(hash)
  if (!m) return null
  try {
    const p = JSON.parse(decodeURIComponent(m[1]))
    if (!p || p.v !== 1 || typeof p.text !== 'string') return null
    return {
      v: 1,
      text: p.text.slice(0, MAX_TEXT),
      yt: typeof p.yt === 'string' && /^[A-Za-z0-9_-]{11}$/.test(p.yt) ? p.yt : null,
      from: typeof p.from === 'string' && /^https:\/\/([a-z0-9-]+\.)*edpuzzle\.com\//i.test(p.from) ? p.from.slice(0, 300) : '',
    }
  } catch {
    return null
  }
}
