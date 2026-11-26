// Values for the {{PLACEHOLDERS}} in docs/legal/*.md. Leave one empty and the page shows it highlighted as
// "[contact email]" etc., so nothing missing slips through. See docs/legal/README.md.

/** Shows a "draft, under review" banner on every legal page. Set to false once a lawyer or the district has reviewed them. */
export const LEGAL_DRAFT = true

export const LEGAL_VALUES = {
  /** Legal name of whoever runs Oasis: the company once it exists, otherwise the founders' full names. */
  OPERATOR: 'Wyatt Kaleugher and Ty Black',
  /** An inbox someone reads. Shown as a mailto link. */
  CONTACT_EMAIL: 'OasisMontour@outlook.com',
  /** e.g. 'December 1, 2026' */
  EFFECTIVE_DATE: 'November 25, 2026',
  // DPA only: filled in per district when you send it, so these stay blank on the site.
  DISTRICT_NAME: '',
  TERM_END: '',
  ANNUAL_DELETION_DATE: '',
} satisfies Record<string, string>

export type LegalKey = keyof typeof LEGAL_VALUES
