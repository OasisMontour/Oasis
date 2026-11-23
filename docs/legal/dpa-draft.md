# Student Data Privacy Agreement (draft)

**Between** {{DISTRICT_NAME}} (the "District") **and** {{OPERATOR}} (the "Provider"), for the Oasis video lesson service.

> If the District uses the Pennsylvania Student Data Privacy Consortium's standard agreement (the National Data Privacy Agreement, or NDPA), the Provider will sign that instead, and this draft can serve as its Exhibit A (service description) and Exhibit B (data elements). This draft has not been reviewed by a lawyer.

## 1. Purpose and scope

1.1 The Provider runs Oasis, an online service that lets District teachers assign interactive YouTube video lessons and review student results (the "Service"), described in Exhibit A.

1.2 This Agreement covers all information about District students and staff that the Provider receives or creates while providing the Service, including information that identifies a student, alone or combined with other information ("Student Data"). Student Data that is part of a student's education records stays an education record under FERPA.

1.3 If this Agreement conflicts with the Provider's Terms of Use or Privacy Policy, this Agreement controls.

## 2. Roles and ownership

2.1 **The District owns and controls Student Data.** The Provider has no ownership of it.

2.2 **School official.** For FERPA purposes, the Provider acts as a school official with a legitimate educational interest under 34 CFR 99.31(a)(1)(i)(B), performing a service the District would otherwise use its own staff for, under the District's direct control as to use and maintenance of Student Data.

2.3 **COPPA.** The District authorizes the Provider to collect information from students under 13 for the sole use and benefit of the District and for no other commercial purpose, and represents that it may give that authorization. The District will tell parents about its use of Oasis as its own policies require.

2.4 The District is responsible for deciding which teachers and students use the Service and for meeting its own notice obligations to parents under FERPA and 22 Pa. Code Chapter 12.

## 3. Provider's obligations

3.1 **Use limits.** The Provider will use Student Data only to provide, secure, support, and maintain the Service for the District, and as this Agreement otherwise permits.

3.2 **The Provider will not:**

(a) sell, rent, or trade Student Data;
(b) use Student Data for targeted advertising, or show advertising to students;
(c) build a profile of a student for any purpose other than the District's educational purposes;
(d) use Student Data to develop, train, or improve AI or machine learning models, its own or anyone else's;
(e) disclose Student Data to anyone except as this Agreement permits;
(f) collect Student Data beyond what Exhibit B lists without the District's written approval.

3.3 **Employees and subprocessors.** Only people who need Student Data to provide the Service may access it, and they are bound by confidentiality. The Provider may use the subprocessors in Exhibit C, each bound by terms at least as protective as this Agreement for the data it receives. The Provider will give the District 30 days' notice before adding a subprocessor that receives Student Data, and the District may object.

3.4 **Google user data.** The Provider's use and transfer of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.

3.5 **Legal demands.** If the Provider receives a subpoena or other legal demand for Student Data, it will notify the District promptly (unless legally prohibited) so the District can respond, and will disclose only what the law requires.

3.6 **De-identified data.** The Provider may use aggregate, de-identified data (for example, counts of active users) to operate and improve the Service. It will not attempt to re-identify it, and will not transfer it to third parties except as required by law.

## 4. Requests from parents, students, and staff

4.1 Requests to review, correct, or delete Student Data go through the District. If a parent, student, or staff member contacts the Provider directly, the Provider will refer them to the District and will help the District respond within 10 business days of the District's request.

## 5. Security

5.1 The Provider will maintain reasonable administrative, technical, and physical safeguards for Student Data, including those in Exhibit D, and a written information security program.

5.2 **Breach notice.** If the Provider confirms unauthorized access to or acquisition of Student Data, it will notify the District without unreasonable delay and within 72 hours of confirmation, including (to the extent known) what happened, what data was involved, when, and what the Provider is doing about it. The Provider will cooperate with the District's investigation and any notices the District must send under 73 P.S. § 2301 and following or other law.

## 6. Retention, return, and deletion

6.1 The Provider keeps Student Data only as long as needed for the Service.

6.2 Within 30 days after the District's written request, or after this Agreement ends, the Provider will delete Student Data (or return it in a common format first, if the District asks), and confirm the deletion in writing. Backup copies held by subprocessors expire on their normal schedule and are not restored except for disaster recovery.

6.3 Unless the District asks in writing to keep it longer, the Provider will delete Student Data collected in a school year by {{ANNUAL_DELETION_DATE}} following that school year.

## 7. Term and termination

7.1 This Agreement starts on the date it is signed by both parties and lasts until {{TERM_END}} or until either party ends it with 30 days' written notice.

7.2 The Provider's obligations about Student Data survive until the data is deleted.

## 8. General

8.1 This Agreement is governed by Pennsylvania law.
8.2 Changes to this Agreement must be in writing and signed by both parties.
8.3 The Provider may not assign this Agreement without the District's written consent. If the Service is transferred to a new operator, the new operator must agree to this Agreement, and the District may instead require deletion of its Student Data.

## Signatures

| District | Provider |
|---|---|
| {{DISTRICT_NAME}} | {{OPERATOR}} |
| Name: | Name: |
| Title: | Title: |
| Signature: | Signature: |
| Date: | Date: |

---

## Exhibit A: Description of the Service

Oasis lets teachers build lessons from YouTube videos with timestamped multiple-choice and short-answer questions; import classes and rosters from Google Classroom; post assignments to Google Classroom; and review student progress, answers, scores, and focus events. Students sign in with their school Google account and watch assigned lessons in fullscreen; the Service prevents skipping ahead and records when a student leaves the lesson. Multiple-choice answers are graded automatically. Teachers may optionally turn on AI-suggested grades for short answers and may send scores to Google Classroom.

## Exhibit B: Data elements

| Category | Elements | Source |
|---|---|---|
| Student identity | Name, school email, Google account ID, profile picture link (stored by the sign-in system, not used) | Google sign-in; teacher's Classroom roster |
| Enrollment | Membership in the teacher's Classroom classes | Google Classroom |
| Coursework | Lesson progress (positions, timestamps), answers, correctness, how each was graded, scores | Student use of the Service |
| Conduct during lessons | Focus events: left fullscreen, tab hidden, window lost focus, with time and video position | Student's browser |
| Usage | Daily visit count and minutes active | Student's browser |
| Support | Bug report text, page, browser user agent | Submitted by the user |
| Technical | IP address and request logs | Hosting providers |
| Staff | Name, school email, Google account ID, Classroom class names and sections, encrypted Google refresh token, teacher-verification signals from Google (verified-teacher flag, school domain, number of active courses), lessons and answer keys | Google sign-in, Classroom, teacher |

Not collected: passwords, birthdates, addresses, phone numbers, student ID numbers, photos, audio, video, biometric data, geolocation, special-education or health information, disciplinary records.

## Exhibit C: Subprocessors

| Subprocessor | Purpose | Data | Location |
|---|---|---|---|
| Supabase, Inc. | Database, authentication, server functions | All Student Data | United States |
| Vercel, Inc. | Website hosting | IP addresses, request logs | United States and global edge network |
| Google LLC | Sign-in, Classroom API, YouTube embedded player | Sign-in; assignments and grades the teacher sends to Classroom; video requests from the student's browser | United States |
| Cloudflare, Inc. (Workers AI); Groq, Inc.; Cerebras Systems Inc. | AI grade suggestions, only on lessons where the teacher turns them on | Question text, teacher's expected answer, student's answer text. No names, emails, or IDs | United States |

## Exhibit D: Security measures

- Row-level security on every database table; students cannot read answer keys or other students' data; scores computed server-side. Automated tests for each access rule; attack testing before releases.
- TLS for all connections; encryption at rest by the database provider; Google refresh tokens encrypted with AES-GCM under a key held only by the server.
- Least-privilege access: only the Provider's operators have administrative access, and every account with administrative access (database, hosting, Google, source code) requires two-step verification. Admin actions in the Service are logged.
- Data minimization: only the elements in Exhibit B; no third-party analytics or advertising code.
- Breach response per section 5.2.
