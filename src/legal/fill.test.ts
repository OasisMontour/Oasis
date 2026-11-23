import { describe, expect, it } from 'vitest'
import { fillPlaceholders, missingValues, placeholderLabel, unknownPlaceholders } from './fill'
import { LEGAL_DOCS } from './docs'

const raw = import.meta.glob<string>('../../docs/legal/*.md', { query: '?raw', import: 'default', eager: true })
const docs: Record<string, string> = Object.fromEntries(
  Object.entries(raw)
    .map(([path, md]) => [path.split('/').pop()!, md])
    .filter(([name]) => name !== 'README.md'),
)
const docFiles = Object.keys(docs)

describe('fillPlaceholders', () => {
  it('fills values, escapes them, and links the contact email', () => {
    const out = fillPlaceholders('By {{OPERATOR}}, mail {{CONTACT_EMAIL}}', { OPERATOR: 'A & <B>', CONTACT_EMAIL: 'hi@x.org' })
    expect(out).toBe('By A &amp; &lt;B&gt;, mail <a href="mailto:hi@x.org">hi@x.org</a>')
  })

  it('highlights empty and unknown placeholders instead of dropping them', () => {
    expect(fillPlaceholders('{{CONTACT_EMAIL}}', { CONTACT_EMAIL: '  ' })).toBe('<mark class="placeholder">[contact email]</mark>')
    expect(fillPlaceholders('{{NOPE}}', {})).toContain('[nope]')
    expect(placeholderLabel('MAILING_ADDRESS')).toBe('mailing address')
  })

  it('lists empty values', () => {
    expect(missingValues({ OPERATOR: 'x', CONTACT_EMAIL: '' } as never)).toEqual(['CONTACT_EMAIL'])
  })
})

describe('legal docs', () => {
  it.each(docFiles)('%s only uses placeholders config.ts defines', (f: string) => {
    expect(unknownPlaceholders(docs[f])).toEqual([])
  })

  it('every Markdown file is routed, and every route has a file', () => {
    const routed = Object.values(LEGAL_DOCS).map((d) => d.load.toString().match(/docs\/legal\/([\w-]+\.md)/)?.[1])
    expect(routed.sort()).toEqual([...docFiles].sort())
  })

  it('the privacy policy keeps the exact Google Limited Use sentence (OAuth verification checks for it)', () => {
    const md = docs['privacy-policy.md']
    expect(md).toContain(
      'use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.',
    )
  })

  it('internal links in the docs point at real legal routes', () => {
    const paths = new Set(Object.values(LEGAL_DOCS).map((d) => d.path))
    for (const f of docFiles) {
      for (const [, href] of docs[f].matchAll(/\]\((\/[^)]*)\)/g)) expect(paths, `${f}: ${href}`).toContain(href)
    }
  })
})
