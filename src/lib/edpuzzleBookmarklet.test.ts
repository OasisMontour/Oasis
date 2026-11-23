import { describe, expect, it } from 'vitest'
import { bookmarkletHref, readBookmarkletHash } from './edpuzzleBookmarklet'
import { parseEdpuzzlePaste } from './edpuzzleImport'

type FakeEl = { attrs: Record<string, string> }
function fakeDoc(text: string, els: FakeEl[], html = '') {
  return {
    body: { innerText: text },
    documentElement: { innerHTML: html },
    querySelectorAll: () => els.map((e) => ({ getAttribute: (k: string) => e.attrs[k] ?? null })),
  }
}

/** Runs the real javascript: URL the way a browser would, with fake page globals. */
function runBookmarklet(doc: ReturnType<typeof fakeDoc>, href = 'https://edpuzzle.com/media/abc123?x=1', hostname = 'edpuzzle.com') {
  const opened: string[] = []
  const alerts: string[] = []
  const code = decodeURIComponent(bookmarkletHref('https://oasis.example').slice('javascript:'.length))
  new Function('document', 'location', 'window', 'alert', code)(
    doc,
    { hostname, href },
    { open: (u: string) => opened.push(u) },
    (m: string) => alerts.push(m),
  )
  return { opened, alerts }
}

const PAGE = 'My Content\nPhotosynthesis\n0:45\nWhat powers plants?\nWater\nThe sun\n1:30\nWhy are leaves green?'

describe('Send to Oasis bookmarklet', () => {
  it('reads the open page and opens Oasis with the data in the #fragment only', () => {
    const doc = fakeDoc(PAGE, [{ attrs: { src: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' } }])
    const { opened, alerts } = runBookmarklet(doc)
    expect(alerts).toEqual([])
    expect(opened).toHaveLength(1)
    const url = new URL(opened[0])
    expect(url.origin + url.pathname + url.search).toBe('https://oasis.example/teacher/lessons/new?from=edpuzzle')
    const p = readBookmarkletHash(url.hash)!
    expect(p.yt).toBe('dQw4w9WgXcQ')
    expect(p.from).toBe('https://edpuzzle.com/media/abc123')
    const r = parseEdpuzzlePaste(p.text)
    expect(r.questions.map((q) => [q.at_s, q.kind])).toEqual([[45, 'mc'], [90, 'short']])
  })

  it('finds the video id in an embed iframe or, failing that, anywhere in the page source', () => {
    expect(readBookmarkletHash(new URL(runBookmarklet(fakeDoc(PAGE, [{ attrs: { src: 'https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0' } }])).opened[0]).hash)!.yt).toBe('abcdefghijk')
    expect(readBookmarkletHash(new URL(runBookmarklet(fakeDoc(PAGE, [], '{"url":"https://www.youtube.com/watch?v=ZYXWVUTSRQP"}')).opened[0]).hash)!.yt).toBe('ZYXWVUTSRQP')
  })

  it('does nothing off edpuzzle.com, or on a page with no question times', () => {
    const off = runBookmarklet(fakeDoc(PAGE, []), 'https://evil-edpuzzle.com/x', 'evil-edpuzzle.com')
    expect(off.opened).toEqual([])
    expect(off.alerts[0]).toMatch(/edpuzzle\.com first/)
    const empty = runBookmarklet(fakeDoc('Classes\nMy Content', []))
    expect(empty.opened).toEqual([])
    expect(empty.alerts[0]).toMatch(/couldn't find any question times/)
  })

  it('works on subdomains like www.edpuzzle.com', () => {
    expect(runBookmarklet(fakeDoc(PAGE, []), 'https://www.edpuzzle.com/media/1', 'www.edpuzzle.com').opened).toHaveLength(1)
  })
})

describe('readBookmarkletHash (untrusted input)', () => {
  const enc = (o: unknown) => '#ep=' + encodeURIComponent(JSON.stringify(o))

  it('rejects junk', () => {
    expect(readBookmarkletHash('')).toBeNull()
    expect(readBookmarkletHash('#ep=%E0%A4%A')).toBeNull()
    expect(readBookmarkletHash('#ep=' + encodeURIComponent('not json'))).toBeNull()
    expect(readBookmarkletHash(enc({ v: 2, text: 'x' }))).toBeNull()
    expect(readBookmarkletHash(enc({ v: 1, text: 5 }))).toBeNull()
  })

  it('drops a bad video id and a non-Edpuzzle source URL, and caps the text', () => {
    const p = readBookmarkletHash(enc({ v: 1, text: 'a'.repeat(200_000), yt: 'x"><script>', from: 'javascript:alert(1)' }))!
    expect(p.yt).toBeNull()
    expect(p.from).toBe('')
    expect(p.text).toHaveLength(150_000)
  })
})
