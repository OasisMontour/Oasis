-- Red team Nov 23 (LOW): teachers could skip save_lesson's safety checks by writing tables directly.
--
-- save_lesson refuses to delete a question students already answered, refuses to change the video once
-- students started, and re-grades when an answer key changes. But lessons/questions were still writable
-- through the REST API, so a direct DELETE on questions silently wiped students' answers (cascade), and a
-- direct UPDATE could swap the video or shrink duration_s under students mid-lesson. Same for assignments:
-- moving one to another lesson or deleting it would orphan or wipe attempts. The app never writes these
-- directly, so all writes now go through save_lesson (lessons/questions) or the two columns the app and the
-- classroom Edge Function actually set (assignments.due_at, assignments.google_coursework_id).
--
-- Also: 'NaN' and 'Infinity' pass "duration_s > 0" in Postgres, and a NaN-length lesson can never be finished.

revoke insert, update, delete on public.lessons, public.questions from authenticated;

revoke update, delete on public.assignments from authenticated;
grant update (due_at, google_coursework_id) on public.assignments to authenticated;

alter table public.lessons add constraint lessons_duration_finite check (duration_s < 86400);  -- also rejects NaN/Infinity
alter table public.questions add constraint questions_at_finite check (at_s < 86400);
