# Oasis Privacy Policy

**Effective:** {{EFFECTIVE_DATE}} · **Operator:** {{OPERATOR}} · **Contact:** {{CONTACT_EMAIL}}

Oasis is a free tool that lets teachers turn YouTube videos into lessons with questions, and lets their students watch those lessons and answer. This policy explains what student and teacher information Oasis collects, why, who can see it, and how long we keep it.

**The short version:** we collect only what Oasis needs to run lessons for a school. We work for the school, the school controls its data, and we never sell it, show ads, or use it to build profiles of students. Students under 13 use Oasis with the school's permission, not by making their own accounts.

If you are a student, there is a shorter version written for you: [Student privacy notice](/student-privacy).

## 1. Who we are and how we work with schools

Oasis is run by {{OPERATOR}} ("we", "us"). Oasis is offered to schools and teachers. When a school or teacher uses Oasis with students, **the school is in charge of the student information and we act on the school's behalf**:

- **FERPA.** Student information in Oasis can be part of a student's education records. We use it as a "school official" with a legitimate educational interest, under the school's direct control, only for the purposes the school allows, and we do not share it further except as this policy and the school's agreement with us allow (34 CFR 99.31(a)(1) and 99.33).
- **COPPA (children under 13).** Oasis collects information from students only for the use and benefit of the school, and for no other commercial purpose. The school gives consent on parents' behalf, as the Federal Trade Commission allows for school tools used this way. Students cannot sign up on their own: a student only gets into a class because their teacher brought that class into Oasis from Google Classroom.
- **Pennsylvania.** Our first schools are in Pennsylvania. We support schools' duties under 22 Pa. Code Chapter 12 (student records) and will follow Pennsylvania's Breach of Personal Information Notification Act (73 P.S. § 2301 and following). We will sign the school's student data privacy agreement, including the Pennsylvania Student Data Privacy Consortium's standard agreement if the school uses it.

If the school's signed agreement with us says something different from this policy, the agreement wins.

## 2. What we collect

**From everyone who signs in (through Google sign-in):** name, email address, Google account ID, and the profile picture link Google sends with sign-in (Oasis doesn't show or use the picture). We never see or store your Google password. Oasis asks students' Google accounts only for basic sign-in information: name, email, and profile.

**From teachers' Google Classroom (only if a teacher connects it):**

- The teacher's active Classroom classes: class name, section, and Classroom ID.
- Each class roster: students' names and email addresses.
- Whether Google says the account is a verified teacher, the account's school domain, and how many classes it teaches. We use this only to decide whether to give the account a teacher role.
- A Google "refresh token" so Oasis can keep rosters up to date, post assignments, and send grades when the teacher asks. We store it encrypted, and the teacher can disconnect at any time, which deletes it and revokes it with Google.

**What teachers create:** lessons (title, subject, YouTube video, questions, answer choices, correct answers, and expected answers for short-answer questions), assignments, and due dates.

**What students do in a lesson:**

- Progress: how far into the video they've watched, where they stopped, when they started and finished.
- Answers they give, whether each answer was right, how it was graded (automatically, by the teacher, or by an AI suggestion the teacher can change), and their score.
- Focus events: when a student leaves fullscreen, switches tabs, or the window loses focus during a lesson, with the time and the point in the video. Teachers see a count of these so they know a student may not have been watching. Oasis cannot see anything outside the lesson: not other tabs, not the screen, not the camera or microphone.

**Usage numbers:** for each teacher and enrolled student, per day: how many times they opened Oasis and roughly how many minutes the Oasis tab was open and visible. Admins only see students' usage as totals and averages, never per student.

**Bug reports:** if someone reports a problem, we keep what they wrote, the page they were on, their browser type (the "user agent"), and whether they're a teacher or student.

**Technical information:** our hosting providers automatically log IP addresses and basic request details (time, page requested, browser type) to run and secure the service. Oasis stores your sign-in session in your browser's local storage, plus two short-lived flags in session storage (the page to return to after sign-in, and whether this tab was already counted as a visit). **Oasis sets no advertising or tracking cookies and uses no third-party analytics.**

**We do not collect:** passwords, home addresses, phone numbers, birthdates, student ID numbers, photos, audio, video of students, precise location, or anything about students' activity outside Oasis.

## 3. How we use it

Only to run Oasis for the school:

- Sign people in and give them the right role (teacher or student).
- Build classes and rosters from Google Classroom, post assignments to Classroom, and send grades back to Classroom when the teacher clicks to do so.
- Play lessons, stop skipping, save progress, grade multiple-choice answers, and show teachers their students' results and focus events.
- Suggest grades for short answers with AI, only on lessons where the teacher turned that on (see section 5).
- Keep Oasis secure, prevent cheating and abuse, fix bugs, and understand in aggregate whether the pilot is working (for example, how many students were active this week).

We **never**: sell or rent personal information; use it for advertising, including targeted ads; build profiles of students for any purpose other than the school's; use it to train AI models; or let anyone else use it for their own purposes.

## 4. Who can see it

- **Teachers** see their own lessons, and the names, emails, progress, answers, scores, and focus events of students in their own classes. Teachers can't see other teachers' classes.
- **Students** see their own assignments, progress, and scores. They never see other students' work or the answer key.
- **Oasis admins** (the people who run Oasis) see teacher accounts, teacher sign-up requests, bug reports, and usage totals. Like any operator, we can technically reach the database. We only look at student-level data when we need to: to fix a problem, answer a school's request, or keep Oasis secure.
- **Service providers** that run parts of Oasis for us, under their own security and privacy terms. They may use the data only to provide their service to us:

| Provider | What it does | What it gets |
|---|---|---|
| Supabase (database, sign-in, server functions; United States) | Stores all Oasis data | Everything in section 2 |
| Vercel (website hosting) | Serves the Oasis website | IP address and request logs |
| Google | Sign-in, Google Classroom, YouTube video player | Sign-in requests; for teachers who connect Classroom: assignments Oasis posts and grades the teacher sends. YouTube receives the video request from the student's browser. |
| Cloudflare Workers AI, Groq, Cerebras (only if a teacher turns on AI grading) | Suggest a grade for a short answer | The question, the teacher's expected answer, and the student's answer. **No names, emails, or IDs.** |

- **Legal reasons.** We'll disclose information if the law requires it (for example, a valid subpoena). Unless the law forbids it, we'll tell the school first so it can respond.
- **If Oasis changes hands.** If Oasis is ever transferred to a new operator, this policy and the school's agreement go with the data, and we'll tell schools first so they can delete their data instead.

**YouTube.** Lesson videos play in YouTube's embedded player, which loads from YouTube when a lesson opens. YouTube may set its own cookies and collect information under [Google's Privacy Policy](https://policies.google.com/privacy). Oasis doesn't share student names or any other student information with YouTube.

## 5. AI grading

AI grading is off unless a teacher turns it on for a lesson. When it's on, short answers can be sent to an AI provider (Cloudflare Workers AI first, then Groq or Cerebras if needed) to suggest whether the answer is correct. We send only the question, the teacher's expected answer, and the student's answer: never the student's name, email, or any ID. Answers that look like they're trying to trick the grader are not sent; the teacher grades those. We only use providers whose terms say they don't train on what we send and don't keep it. Every AI grade is labelled "AI" and the teacher can change it. The teacher is responsible for the final grade.

## 6. Google user data (Limited Use disclosure)

Oasis's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

In plain terms, for data Oasis gets from Google (sign-in profile, Classroom classes and rosters):

- We use it only to provide and improve the Oasis features the user can see: sign-in, class rosters, posting assignments, and sending grades.
- We don't transfer it to anyone except as needed to provide those features, for security, to comply with the law, or as part of a merger or sale with notice as described above.
- We don't use it for advertising, and we don't sell it.
- People don't read it except with the user's permission, for security, to comply with the law, or when it's aggregated and anonymous for internal operations.
- We don't use data from Google Workspace APIs (including Google Classroom) to develop, improve, or train generalized AI or machine learning models. Google-derived data, such as names and emails, is never sent to AI providers.

## 7. How long we keep it

Our data retention policy:

| Data | Why we keep it | When it's deleted |
|---|---|---|
| Accounts, classes, rosters, lessons, assignments, progress, answers, scores, focus events | To run the school's lessons and let teachers see results | When the school or teacher asks, when an account is deleted, or 30 days after the school stops using Oasis, and in any case after the end of the school year in which it was collected unless the school asks us in writing to keep it longer |
| Google refresh tokens | To sync Classroom | Right away when the teacher disconnects Classroom or the account is deleted |
| Daily usage numbers | To see whether the pilot is working | With the account, and no later than the end of the school year |
| Bug reports | To fix problems | When the bug is fixed and no longer needed, and no later than the end of the school year. Removing an account removes the link to the reporter. |
| Hosting providers' request logs | Security and troubleshooting | On the providers' schedules, usually within days to weeks |

A student who is still on a teacher's Google Classroom roster will stay on that class's roster in Oasis, because Oasis copies the roster from Classroom. To fully remove a student, the school removes them from the Classroom class or asks us to delete the class.

We don't keep student information longer than needed for the purpose it was collected for. Backup copies held by our database provider expire on that provider's schedule, and we only restore from them to recover from an outage.

## 8. Your choices and rights

- **Parents and students** can ask to see a student's information, correct it, or delete it. Because the school controls student records, please start with your teacher or school. If you contact us directly at {{CONTACT_EMAIL}}, we'll confirm the request with the school and help it respond. A parent can also ask the school to stop the student's use of Oasis, and we'll delete the student's information when the school tells us to.
- **Teachers** can disconnect Google Classroom at any time, and can ask us to delete their account and lessons by emailing {{CONTACT_EMAIL}}.
- **Schools** can export or delete their data at any time by emailing {{CONTACT_EMAIL}}. We'll delete within 30 days and confirm in writing.
- You can also remove Oasis's access to your Google account at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## 9. How we protect it

- Every database table is locked down by default: students can't read the answer key, other students' work, or anyone else's information, and scores are calculated on the server. These rules have automated tests, and we test for attacks before releases.
- All connections use HTTPS (encrypted in transit), and the database provider encrypts stored data. Google Classroom tokens are additionally encrypted with our own key.
- Only the people who run Oasis have admin access, and admin actions are logged.
- We keep the amount of student information as small as we can.

No system is perfectly secure. **If we learn of a breach** that affects student or teacher information, we'll tell the affected school without unreasonable delay (and within 72 hours of confirming it), help it notify families, and follow Pennsylvania's breach notification law.

## 10. Children

Oasis is built for K-12 classrooms and may be used by children under 13. We only collect children's information through their school, as described in section 1, and only what's listed in section 2. We never require a child to share more than Oasis needs. If you believe a child's information got into Oasis without a school's permission, contact {{CONTACT_EMAIL}} and we'll delete it.

## 11. Changes to this policy

If we change this policy, we'll update the date at the top. If a change is significant, such as collecting a new kind of student information or using it in a new way, we'll tell schools in advance and won't apply it to information already collected without the school's permission.

## 12. Contact

{{OPERATOR}}
{{MAILING_ADDRESS}}
{{CONTACT_EMAIL}}
