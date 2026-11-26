# Legal documents

> **DRAFT. Not reviewed by a lawyer.** Have a lawyer, or the district's own privacy/legal staff, review these before real students use Oasis. The app shows a "draft" banner on every legal page until `LEGAL_DRAFT` in `src/legal/config.ts` is set to `false`.

| File | Shown at | Who it's for |
|---|---|---|
| `privacy-policy.md` | `/privacy` | Everyone; also the privacy policy URL for Google OAuth verification |
| `terms.md` | `/terms` | Everyone |
| `student-privacy.md` | `/student-privacy` | Students (plain language) |
| `schools.md` | `/schools` | Teachers, principals, district IT (one page) |
| `dpa-draft.md` | `/dpa` | District: a starting-point data privacy agreement |

The app renders these files directly, so edit the Markdown here and the site updates on the next deploy.

## Placeholders

Placeholders like `{{CONTACT_EMAIL}}` are filled in from `src/legal/config.ts`. An empty value shows up highlighted on the page as `[contact email]`, so you can see what's missing.

| Placeholder | Fill with |
|---|---|
| `OPERATOR` | Legal name of whoever runs Oasis: a company once one exists, otherwise the founders' full names |
| `CONTACT_EMAIL` | An inbox someone actually reads, e.g. privacy@yourdomain. Not a personal school email. |
| `EFFECTIVE_DATE` | The date the reviewed version goes live |
| `DISTRICT_NAME`, `TERM_END`, `ANNUAL_DELETION_DATE` | DPA only; fill in per district when you send it (left as blanks on the site) |

## Before the pilot: what has to be true for these documents to be honest

These documents make promises. Each one needs someone to actually do it:

1. **Who signs.** If both founders are under 18, a contract you sign (the DPA, provider accounts) can be voided. A district will likely want an adult or an entity on the other side. Options: a parent signs as/with the operator, or form an LLC with an adult organizer. Ask the district what it accepts.
2. **Contact inbox.** Set up `CONTACT_EMAIL` and check it. Privacy and deletion requests have 10- and 30-day clocks in these documents.
3. **Supabase region.** The documents say data is stored in the United States. Confirm in Supabase → Project Settings → General.
4. **Two-step verification** on every Google, Supabase, Vercel, GitHub, and AI provider account with access. The DPA promises it.
5. **Written information security program.** The amended COPPA Rule (compliance date April 22, 2026) requires one if any users are under 13, and the DPA promises it. A 1-2 page doc covering who has access, how access is granted and removed, how you test (the red-team runs), and the breach plan below is enough to start.
6. **Breach plan.** Who notices, who calls the district, within 72 hours.
7. **Deletion.** There's no delete button yet. Until there is, delete by hand (below) and keep a note of each request.
8. **AI providers.** Only list providers you actually have accounts with. If AI grading doesn't ship, remove section 5 of the privacy policy and the AI rows elsewhere. Groq requires the account holder to be 18+.
9. **Google OAuth verification.** Use `https://<your domain>/privacy` as the privacy policy URL and the site root as the homepage. The sign-in page links to it, and `index.html` has a plain-HTML copy of the links for crawlers.
10. **District DPA.** Pennsylvania districts often use the Student Data Privacy Consortium's NDPA (run through IU13). Ask Montour whether it does before sending ours.
11. **Pennsylvania law check.** As of Nov 2026, Pennsylvania has no enacted student-data-privacy statute aimed at operators (SB 378 of 2025-26 was pending). Have the reviewer confirm nothing has changed.

## Deleting someone's data (until there's a button)

1. First, in the SQL editor, remove what the account delete won't:

```sql
-- Bug reports keep their text after the account is gone (reporter becomes null), so delete them first:
delete from bug_reports where reporter = (select id from profiles where email = '<email>');
-- Admin log entries naming a teacher's email:
delete from admin_audit where target = '<email>';
-- Roster rows copied from Classroom. They come back on the next sync while the student is still in the
-- Classroom class, so the teacher or school has to remove them there too:
delete from roster_entries where email = '<email>';
```

2. Then Supabase dashboard → Authentication → Users → find the email → Delete user. That cascades to their profile, enrollments, attempts, answers, focus events, usage, Google tokens, and teacher request. For a teacher it also deletes their classes, lessons, and assignments, and every student attempt on those assignments, so export results first if the school wants them.

## Things the code could do better for privacy

- The player loads YouTube from `youtube.com`. Switching the IFrame API to `host: 'https://www.youtube-nocookie.com'` (privacy-enhanced mode) would cut YouTube cookies; test it on a Chromebook first.
- An admin "delete user" action and a scheduled job that deletes last school year's data would turn the retention promises into code.
