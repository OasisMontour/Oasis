import { Link, useLocation } from 'react-router-dom'
import { LEGAL_DOCS } from '../legal/docs'

const LINKS = [LEGAL_DOCS.privacy, LEGAL_DOCS.terms, LEGAL_DOCS.student, LEGAL_DOCS.schools]

/** Site-wide footer. Hidden in the lesson player, which owns the whole screen. */
export function LegalFooter() {
  const { pathname } = useLocation()
  if (pathname.startsWith('/student/assignments/')) return null
  return (
    <footer className="legal-footer">
      <nav aria-label="Legal">
        {LINKS.map((d) => (
          <Link key={d.path} to={d.path}>
            {d.title}
          </Link>
        ))}
      </nav>
    </footer>
  )
}
