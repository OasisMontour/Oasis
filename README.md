# Oasis

Interactive YouTube video lessons for teachers: timestamped questions, no skipping, fullscreen-only playback, results, and Google Classroom sync.

Stack: React + Vite + TypeScript on Vercel, Supabase (Postgres, Auth, Edge Functions), YouTube IFrame API.

## Run it

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL + anon key
npm run dev
```

First-time project setup (Supabase, Google sign-in, teacher accounts): see [docs/SETUP.md](docs/SETUP.md).

## Tests

```bash
npm run test:db   # schema + RLS + RPC tests against a throwaway Postgres
npm test          # unit tests (bulk paste parser, YouTube links)
npm run lint
npm run build
```

CI runs all of these on every PR. Nothing merges to `main` without a passing CI run and one review.

## How the data is protected

- RLS is on for every table. Students never write tables directly: they go through RPCs (`save_lesson` and `import_classroom` for teachers; `get_student_lesson`, `save_progress`, `submit_answer`, `finish_attempt`, `log_focus_event`).
- Students can't read correct answers. The `questions` table is teacher-only; the player gets questions from `get_student_lesson`, which leaves answers out.
- Scores are computed in the database. `save_progress` rejects skipping ahead: past an unanswered question, faster than real time, or past the end of the video.
- Classes and rosters only come from Google Classroom. No manual classes, join codes, or roster edits.
- AI grading (optional) only writes short answers nobody has graded, only through the `ai-grade` Edge Function, under per-teacher and monthly caps that fail closed. Teachers can change every AI grade. See docs/SETUP.md.
- Teachers are whoever is on `teacher_allowlist`. Everyone else who signs in is a student. Role can't be changed from the browser.

Every one of those rules has a test in `supabase/tests/10_rls_test.sql`. Change a policy, add a test.

## Layout

```
src/                     React app
supabase/migrations/     schema, RLS policies, RPCs (applied to the real project)
supabase/tests/          RLS tests + a small Supabase shim so they run on plain Postgres
scripts/test-db.sh       test runner (local temp cluster, or DATABASE_URL in CI)
```
