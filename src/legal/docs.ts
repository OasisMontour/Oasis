// The legal pages. The Markdown in docs/legal/ is the single source: edit it there.
export const LEGAL_DOCS = {
  privacy: { path: '/privacy', title: 'Privacy Policy', load: () => import('../../docs/legal/privacy-policy.md?raw') },
  terms: { path: '/terms', title: 'Terms of Use', load: () => import('../../docs/legal/terms.md?raw') },
  student: { path: '/student-privacy', title: 'Student privacy', load: () => import('../../docs/legal/student-privacy.md?raw') },
  schools: { path: '/schools', title: 'For schools', load: () => import('../../docs/legal/schools.md?raw') },
  dpa: { path: '/dpa', title: 'Draft data privacy agreement', load: () => import('../../docs/legal/dpa-draft.md?raw') },
} as const

export type LegalDocId = keyof typeof LEGAL_DOCS
