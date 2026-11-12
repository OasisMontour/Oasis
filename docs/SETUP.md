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
4. Supabase -> Authentication -> URL Configuration: Site URL = your Vercel URL; add `http://localhost:5173` to redirect URLs.
5. **District IT (do this now, it's the biggest launch risk):** students under 18 can't sign into third-party apps the district hasn't approved. Send IT the OAuth client ID and ask them to mark Oasis as *Trusted* in Google Admin -> Security -> API controls -> App access control. Test with one real student account.

Classroom scopes (roster import, posting assignments, grades) are added later and requested only from teachers. They need Google app verification, so submit for verification early.

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
