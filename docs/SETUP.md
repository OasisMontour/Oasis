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
4. Supabase -> Authentication -> Providers -> **Email: turn it off.** Google is the only way in. The signup trigger trusts the account's email to decide who's a teacher, so a password signup with a teacher's address must be impossible.
5. Supabase -> Authentication -> URL Configuration: Site URL = your Vercel URL; add `http://localhost:5173` to redirect URLs.
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
5. Students never see these scopes. A teacher clicks **Connect Google Classroom** once; after that the dashboard re-syncs rosters on its own whenever it's been more than 6 hours.

These are sensitive scopes, so outside the district's trusted-app setting Google shows an "unverified app" warning until the app is verified. Submit for verification early, and ask district IT to trust the client ID (step 5 above covers both).

## 3. Teacher accounts

Teachers are whoever is on the allowlist at the moment they first sign in. In the Supabase SQL editor:

```sql
insert into teacher_allowlist (email) values ('teacher@district.org');
-- already signed in as a student before being added? flip them:
update profiles set role = 'teacher' where email = 'teacher@district.org';
```

## 4. Vercel

Import the repo, framework preset Vite, add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optionally `VITE_GOOGLE_HOSTED_DOMAIN` (the district's Google domain). `vercel.json` handles client-side routes.

## 5. GitHub

- Settings -> Branches -> protect `main`: require a PR, 1 approval, and the `CI` checks.
- Automated Claude review on every PR: run `/install-github-app` in Claude Code and pick this repo.
