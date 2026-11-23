import { LEGAL_VALUES, type LegalKey } from './config'

const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** "CONTACT_EMAIL" -> "contact email" */
export const placeholderLabel = (key: string) => key.toLowerCase().replace(/_/g, ' ')

/**
 * Fills {{KEY}} placeholders in a legal Markdown doc. Runs before Markdown parsing, so it emits inline HTML:
 * a mailto link for the contact email, a highlighted "[label]" for anything not filled in yet.
 * Unknown keys are left highlighted too, so a typo shows up on the page instead of vanishing.
 */
export function fillPlaceholders(md: string, values: Record<string, string> = LEGAL_VALUES): string {
  return md.replace(PLACEHOLDER, (_, key: string) => {
    const v = (values[key] ?? '').trim()
    if (!v) return `<mark class="placeholder">[${placeholderLabel(key)}]</mark>`
    if (key === 'CONTACT_EMAIL') return `<a href="mailto:${escapeHtml(v)}">${escapeHtml(v)}</a>`
    return escapeHtml(v)
  })
}

/** Placeholder keys a doc uses that config.ts doesn't define (for tests). */
export function unknownPlaceholders(md: string): string[] {
  return [...md.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((k) => !(k in LEGAL_VALUES)) as string[]
}

/** Keys that are still empty (for tests and the draft banner). */
export function missingValues(values: Record<string, string> = LEGAL_VALUES): LegalKey[] {
  return (Object.keys(values) as LegalKey[]).filter((k) => !values[k].trim())
}
