import { useEffect, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { marked } from 'marked'
import { LEGAL_DRAFT } from '../legal/config'
import { LEGAL_DOCS, type LegalDocId } from '../legal/docs'
import { fillPlaceholders } from '../legal/fill'

// Public pages (no sign-in): Google's OAuth review, parents, and district IT all need to read them.
// Lazy-loaded from App.tsx so the Markdown and the parser stay out of the main bundle.
export default function Legal({ doc }: { doc: LegalDocId }) {
  const { title, load } = LEGAL_DOCS[doc]
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    setHtml(null)
    document.title = `${title} · Oasis`
    load()
      .then((m) => {
        // The Markdown is ours (docs/legal), and fillPlaceholders escapes the config values it inserts.
        if (!cancelled) setHtml(marked.parse(fillPlaceholders(m.default), { async: false, breaks: true }))
      })
      .catch(() => !cancelled && setError(true))
    window.scrollTo(0, 0)
    return () => {
      cancelled = true
      document.title = 'Oasis'
    }
  }, [title, load])

  // Links between legal pages stay in the app instead of reloading it.
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href')
    if (!a || !href?.startsWith('/') || href.startsWith('//') || e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    navigate(href)
  }

  return (
    <div className="legal">
      <header className="bar">
        <strong>
          <Link to="/">Oasis</Link>
        </strong>
      </header>
      {LEGAL_DRAFT && (
        <p className="legal-draft" role="note">
          Draft: this document is being reviewed and isn't final yet. Questions? Ask your teacher or school.
        </p>
      )}
      {error && <p className="error">Couldn't load this page. Check your connection and refresh.</p>}
      {!html && !error && <p className="muted">Loading…</p>}
      {/* Trusted, repo-owned Markdown: see the comment above. */}
      {html && <article className="legal-doc" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  )
}
