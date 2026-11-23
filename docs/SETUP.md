# Setup

One-time steps to get Oasis running against a real Supabase project. About 30 minutes.

## 1. Supabase project

1. Create a project at supabase.com (US region). Free tier is fine while building; move to Pro before Dec 1.
2. Install the CLI (`npm i -g supabase`), then from the repo root:
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push          # applies supabase/migrations
   ```
3. Project settings -> API: copy the URL and the **anon** key into `.env.local` (and into Vercel's env vars). Never put the `service_role` key in the frontend or in git.

## 2. Google sign-in

1. Google Cloud Console -> new project "Oasis" -> APIs & Services -> OAuth consent screen: External, app name Oasis, scopes `openid`, `email`, `profile` only.
2. Credentials -> Create OAuth client ID -> Web application.
   - Authorized JavaScript origins: `http://localhost:5173`, your Vercel URL.
   - Authorized redirect URI: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
3. Supabase -> Authentication -> Providers -> Google: paste the client ID and secret, enable.
4. Supabase -> Authentication -> Providers -> **Email: turn it off.** Google is the only way in. The signup trigger trusts the account's email to decide who's pre-approved as a teacher, so a password signup with a teacher's address must be impossible. The database also refuses any non-Google signup as a backstop, but keep the provider off. Leave Phone and every other provider off too.
5. Supabase -> Authentication -> URL Configuration: Site URL = your Vercel URL; add `http://localhost:5173/**` and `https://your-vercel-url/**` to redirect URLs (Classroom consent returns to `/teacher` and `/teacher/signup`).
6. **District IT (do this now, it's the biggest launch risk):** students under 18 can't sign into third-party apps the district hasn't approved. Send IT the OAuth client ID and ask them to mark Oasis as *Trusted* in Google Admin -> Security -> API controls -> App access control. Test with one real student account.

### Google Classroom (teachers only)

1. Google Cloud Console -> APIs & Services -> Library: enable **Google Classroom API**.
2. OAuth consent screen -> Scopes: add `classroom.courses.readonly`, `classroom.rosters.readonly`, `classroom.profile.emails`, `classroom.coursework.students`.
3. Deploy the `classroom` Edge Function and give it its secrets (same Google client as step 2 above):
   ```bash
   supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
     TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32) APP_ORIGIN=https://your-vercel-url
   supabase functions deploy classroom
   ```
   Back up `TOKEN_ENCRYPTION_KEY` somewhere safe (password manager). Lose it and every teacher has to reconnect; leak it together with a database dump and their Classroom access leaks.
4. Assigning a lesson posts it to the class's Classroom stream with a link to `APP_ORIGIN/student/assignments/<id>`, so `APP_ORIGIN` must be the real app URL.
5. Students never see these scopes unless they click "sign up as a teacher" themselves. Teachers approve them once when they sign up (or click **Connect Google Classroom**); after that the dashboard re-syncs rosters on its own whenever it's been more than 6 hours.

These are sensitive scopes, so outside the district's trusted-app setting Google shows an "unverified app" warning until the app is verified. Submit for verification early, and ask district IT to trust the client ID (step 6 above covers both).

**Hard limit while unverified: 100 users.** Google caps an unverified app that asks for sensitive scopes at 100 users who've granted them, ever (it doesn't reset when people disconnect). Only teachers grant Classroom scopes (plus anyone who tries the teacher sign-up and gets refused), so that's roughly 100 teachers, fine for the 12-teacher pilot but a wall for open sign-up. Verification takes weeks and needs a privacy policy, a homepage on your own domain and a demo video, so start it now. The cap is shown in Google Cloud Console -> OAuth consent screen.

## 3. Teacher accounts

Teachers sign themselves up. On the sign-in page (or from the student page's "Teacher?" link) they click **Sign up with Google Classroom** and approve Classroom access. The `classroom` Edge Function asks Google about that account and the database (`claim_teacher_for`) decides:

| What Google says | Result |
|---|---|
| Not the account they signed in to Oasis with, no active Classroom classes, already a student in Oasis, or blocked by an admin | Refused |
| Verified teacher (their school's Google admin marked them as a teacher) and teaches a class | Teacher right away, classes import |
| Anything else: school account not verified by Google, personal Gmail, listed as a student on a roster | Waits for an admin in /admin (Approve / Deny) |

Only Google's own "verified teacher" flag is automatic. "Teaches a Classroom class" proves nothing on its own: anyone can make one with a personal Gmail in seconds, and in many districts students can make one with their school account too. A teacher account can read the answer key of every shared lesson, so a fake teacher is a cheating tool.

**For the pilot district:** ask IT whether they verify teachers in Google Classroom (Google Admin -> Classroom -> Teacher permissions; the menu path moves around). If they do, the 12 pilot teachers get in on their own. If they don't, each one waits for you: approve them in /admin (12 clicks). Add the district's domain under *Trusted school domains* so their sign-ups are marked as from your school; that never lets anyone in by itself.

Removing a teacher in /admin (or denying a sign-up) also blocks the email from signing up again. Unblock it from /admin.

Pre-approving (optional): an admin can still add an email in /admin -> Teachers -> Pre-approve. That account is a teacher the moment it first signs in, no Classroom check. Use it for a teacher who can't get through the normal sign-up. In SQL:

```sql
insert into teacher_allowlist (email) values ('teacher@district.org');
-- already signed in as a student before being added? flip them:
update profiles set role = 'teacher' where email = 'teacher@district.org';
```

### Admins (Oasis team)

Admins get `/admin`: approve or deny teacher sign-ups, mark trusted school domains, pre-approve, remove or unblock teachers, and a read-only overview of teachers, classes, assignments, completion and anti-cheat flags (counts only, no student names). Admins are listed in a table the app can't write to, so add them in the SQL editor with the Google account they sign in with:

```sql
insert into admins (email) values (lower('you@gmail.com'));
-- revoke: delete from admins where email = 'you@gmail.com';  (takes effect on their next click)
```

An admin can also be a teacher or a student; the Admin link shows up in their header either way.

## 4. Vercel

Import the repo, framework preset Vite, add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optionally `VITE_GOOGLE_HOSTED_DOMAIN` (the district's Google domain). `vercel.json` handles client-side routes.

## 5. GitHub

- Settings -> Branches -> protect `main`: require a PR, 1 approval, and the `CI` checks.
- Automated Claude review on every PR: run `/install-github-app` in Claude Code and pick this repo.
