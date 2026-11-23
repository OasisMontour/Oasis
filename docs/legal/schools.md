# Oasis for schools: privacy and security at a glance

For teachers, principals, and district IT reviewing Oasis. Full details: [Privacy Policy](/privacy) · [Terms of Use](/terms) · [Student privacy notice](/student-privacy) · [Draft data privacy agreement](/dpa).

**What it is.** A free tool for interactive YouTube video lessons. Teachers add questions at timestamps, assign lessons through Google Classroom, and see results. Students watch in fullscreen, can't skip ahead, and answer as they go.

**Operator.** {{OPERATOR}} · {{CONTACT_EMAIL}}

## Data we hold

| | Students | Teachers |
|---|---|---|
| Identity | Name, school email, Google account ID (from Google sign-in and the teacher's Classroom roster) | Name, school email, Google account ID |
| Schoolwork | Lesson progress, answers, scores, focus events (left fullscreen / switched tab / window lost focus) | Lessons, questions and answer keys, assignments |
| Google Classroom | Membership in the teacher's Classroom classes | Class names and sections; encrypted refresh token (revocable) |
| Usage | Daily visits and minutes in the app (admins see totals only) | Daily visits and minutes in the app |
| Support | Bug reports they submit (text, page, browser type) | Same |

**We don't collect:** passwords, birthdates, addresses, phone numbers, student ID numbers, photos, audio, video, location, or anything outside Oasis. No camera or microphone access.

## Commitments

- **Students sign in with school Google accounts only.** Students get basic sign-in scopes (name, email, profile). Only teachers are asked for Classroom access.
- **No sale, no ads, no profiling, no AI training** on student data. No third-party analytics or tracking cookies.
- **FERPA:** we act as a school official under the district's direct control. **COPPA:** the school consents on parents' behalf; data is used only for the school.
- **Google Limited Use:** data from Google APIs follows the Google API Services User Data Policy, including Limited Use.
- **Deletion:** on request within 30 days, and at the end of the school year unless the district asks to keep it. Written confirmation on request.
- **Breach notice:** to the district without unreasonable delay and within 72 hours of confirmation.
- **Data agreement:** we'll sign the district's DPA, including the Pennsylvania Student Data Privacy Consortium's standard agreement (NDPA). Our [draft DPA](/dpa) is a starting point if the district doesn't have one.

## Where data goes

| Service | Purpose | Data |
|---|---|---|
| Supabase (United States) | Database, sign-in, server functions | All Oasis data |
| Vercel | Website hosting | IP addresses, request logs |
| Google | Sign-in, Classroom sync, YouTube player | Classroom: posted assignments, grades the teacher sends. YouTube: video requests from the student's browser |
| Cloudflare Workers AI / Groq / Cerebras | AI grade suggestions, **only if a teacher turns it on** | Question, expected answer, student's answer. No names, emails, or IDs. Providers don't train on or keep it. |

## Security

- Row-level security on every database table; students can't read answer keys or other students' data; scores are computed on the server. Automated tests cover each rule, and we run attack tests before releases.
- HTTPS everywhere; data encrypted at rest by the database provider; Classroom tokens also encrypted with our own key.
- Admin access limited to the people who run Oasis; admin actions are logged.

## What IT needs to do

1. Allow the Oasis Google OAuth app for students and teachers in the Google Admin console (Security → API controls → App access control → mark Oasis as **Trusted** or **Limited**). Students under 18 can't sign in to unconfigured third-party apps.
2. Make sure `youtube.com` (video playback) and the Oasis site are reachable on student devices.
3. Send us the district's DPA, or let us know to send ours.

Questions: {{CONTACT_EMAIL}}
