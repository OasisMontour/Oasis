-- RLS + RPC tests. Run with scripts/test-db.sh. Any failed assertion aborts with a non-zero exit.
\set ON_ERROR_STOP on
\set QUIET on

create schema tests;
grant usage on schema tests to authenticated, anon;

create function tests.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok - %', label;
end $$;

-- true if the statement raises any error
create function tests.throws(stmt text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return true;
end $$;
grant execute on all functions in schema tests to authenticated, anon;

-- ---------- fixtures (as superuser)
insert into public.teacher_allowlist (email) values ('t1@district.org'), ('t2@district.org');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'T1@district.org', '{"full_name":"Teacher One"}'),
  ('00000000-0000-0000-0000-0000000000a2', 't2@district.org', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 's1@district.org', '{"full_name":"Student One"}'),
  ('00000000-0000-0000-0000-0000000000b2', 's2@district.org', '{}'),
  ('00000000-0000-0000-0000-0000000000b3', 's3@district.org', '{}');

select tests.ok((select role from profiles where email = 't1@district.org') = 'teacher', 'allowlisted email becomes teacher (case-insensitive)');
select tests.ok((select role from profiles where email = 's1@district.org') = 'student', 'other emails become students');
select tests.ok((select name from profiles where email = 's1@district.org') = 'Student One', 'name comes from Google metadata');

-- helper to switch identity inside the current transaction
create function tests.become(uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, true);
$$;
grant execute on function tests.become(text) to authenticated;

-- classes + enrollments only come from Google Classroom (import_classroom); set them up directly here.
insert into classes (id, teacher_id, name, google_course_id)
  values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Period 3 Business', 'gc-fixture');
insert into enrollments (class_id, student_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2');

-- ---------- teacher 1 builds a lesson and assigns it
-- (lessons and questions are written through save_lesson in the app; fixtures insert them directly)
insert into lessons (id, teacher_id, title, subject, youtube_id, duration_s)
  values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Supply and demand', 'Business', 'dQw4w9WgXcQ', 100);
insert into questions (id, lesson_id, at_s, kind, prompt, choices, correct_index) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 10, 'mc', 'What is supply?', '["A","B","C"]', 1);
insert into questions (id, lesson_id, at_s, kind, prompt) values
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 50, 'short', 'Explain demand.');
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
insert into assignments (id, lesson_id, class_id)
  values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
select tests.ok(tests.throws($$insert into classes (teacher_id, name, google_course_id) values (auth.uid(), 'manual', 'x')$$), 'teacher cannot create a class by hand');
select tests.ok(tests.throws($$update classes set name = 'renamed'$$), 'teacher cannot rename a Classroom class');
select tests.ok(tests.throws($$delete from enrollments$$), 'teacher cannot remove students by hand');
commit;

-- ---------- student 1: what they can and cannot see/do
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok((select count(*) from classes) = 1, 'student sees the class they joined');
select tests.ok((select count(*) from lessons) = 1, 'student sees the assigned lesson');
select tests.ok((select count(*) from questions) = 0, 'student cannot read questions table (correct answers)');
select tests.ok(not (get_student_lesson('40000000-0000-0000-0000-000000000001')::text like '%correct%'), 'player payload has no correct answers');
select tests.ok(jsonb_array_length(get_student_lesson('40000000-0000-0000-0000-000000000001') -> 'questions') = 2, 'player payload has both questions');
select tests.ok(tests.throws($$insert into answers (attempt_id, question_id, response) select id, '30000000-0000-0000-0000-000000000001', '1' from attempts$$), 'student cannot insert answers directly');
select tests.ok(tests.throws($$update attempts set max_watched_s = 100$$), 'student cannot update attempts directly');
select tests.ok(tests.throws($$insert into classes (teacher_id, name) values (auth.uid(), 'fake')$$), 'student cannot create a class');
select tests.ok(tests.throws($$update profiles set role = 'teacher' where id = auth.uid()$$), 'student cannot make themselves a teacher');
select tests.ok(tests.throws($$update profiles set name = 'Fake Name' where id = auth.uid()$$), 'student cannot change the name from their Google account');
select tests.ok(tests.throws($$select * from teacher_allowlist$$), 'student cannot read the teacher allowlist');
select tests.ok((select count(*) from profiles) = 1, 'student sees only their own profile');
commit;

select id as att1 from attempts where student_id = '00000000-0000-0000-0000-0000000000b1' \gset

-- ---------- no-skip enforcement
-- pretend time passed so the watch-credit bucket is full (30s) and isn't what stops us
update attempts set credit_at = now() - interval '1 hour' where id = :'att1';
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok(tests.throws(format($$select save_progress(%L, 25, 25)$$, :'att1')), 'cannot save progress past an unanswered question');
select save_progress(:'att1', 11, 11);
select tests.ok(tests.throws(format($$select submit_answer(%L, '30000000-0000-0000-0000-000000000002', 'early')$$, :'att1')), 'cannot answer a question not reached yet');
select submit_answer(:'att1', '30000000-0000-0000-0000-000000000001', '1');
select tests.ok((select count(*) from answers) = 0, 'student cannot read their graded answers back (no answer-key oracle)');
select tests.ok(tests.throws('select score from attempts'), 'student cannot read their score');
select tests.ok(tests.throws(format($$select submit_answer(%L, '30000000-0000-0000-0000-000000000001', '2')$$, :'att1')), 'cannot re-answer a question');
select tests.ok(tests.throws(format($$select finish_attempt(%L)$$, :'att1')), 'cannot finish before the end of the video');
commit;

update attempts set credit_at = now() - interval '1 hour' where id = :'att1';
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select save_progress(:'att1', 41, 41);
commit;
update attempts set credit_at = now() - interval '1 hour' where id = :'att1';
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok(tests.throws(format($$select save_progress(%L, 60, 60)$$, :'att1')), 'second question also gates progress');
select save_progress(:'att1', 51, 51);
select submit_answer(:'att1', '30000000-0000-0000-0000-000000000002', 'Demand is how much people want');
commit;
select tests.ok((select is_correct from answers where attempt_id = :'att1' and question_id = '30000000-0000-0000-0000-000000000001') = true, 'correct MC answer is auto-graded right');
select tests.ok((select is_correct from answers where attempt_id = :'att1' and question_id = '30000000-0000-0000-0000-000000000002') is null, 'short answer is left ungraded');

-- wall-clock limit: right after a save, a big jump is rejected even with no questions left
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok(tests.throws(format($$select save_progress(%L, 100, 100)$$, :'att1')), 'progress cannot outrun real time');
commit;

update attempts set credit_at = now() - interval '1 hour' where id = :'att1';
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select save_progress(:'att1', 81, 81);
commit;
update attempts set credit_at = now() - interval '1 hour' where id = :'att1';
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select save_progress(:'att1', 150, 150);
select tests.ok((select max_watched_s from attempts where id = :'att1') = 100, 'progress is capped at the video length');
select finish_attempt(:'att1');
select log_focus_event(:'att1', 'tab_hidden', 42);
commit;
select tests.ok((select score from attempts where id = :'att1') = 50, 'score counts ungraded short answer as not yet correct');

-- ---------- student 2 cannot see student 1's work
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b2');
select tests.ok((select count(*) from attempts where id = :'att1') = 0, 'student cannot see another student''s attempt');
select tests.ok((select count(*) from answers) = 0, 'student cannot see another student''s answers');
select tests.ok((select count(*) from focus_events) = 0, 'student cannot see another student''s focus events');
select tests.ok(tests.throws(format($$select log_focus_event(%L, 'blur', 1)$$, :'att1')), 'student cannot log events on another attempt');
select tests.ok(tests.throws(format($$select save_progress(%L, 1, 1)$$, :'att1')), 'student cannot save progress on another attempt');
commit;

-- ---------- student 3 (not enrolled) sees nothing
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b3');
select tests.ok((select count(*) from classes) + (select count(*) from lessons) + (select count(*) from assignments) = 0, 'unenrolled student sees no classes, lessons, or assignments');
select tests.ok(tests.throws($$select get_student_lesson('40000000-0000-0000-0000-000000000001')$$), 'unenrolled student cannot open the lesson');
commit;

-- ---------- teacher 1 sees results and grades
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select tests.ok((select count(*) from attempts) = 1, 'teacher sees attempts in their class');
select tests.ok((select count(*) from focus_events) = 1, 'teacher sees focus events in their class');
select tests.ok((select count(*) from profiles where role = 'student') = 2, 'teacher sees their enrolled students only');
select tests.ok(grade_answer(:'att1', '30000000-0000-0000-0000-000000000002', true) = 100, 'teacher grading short answer updates score');
commit;

-- ---------- teacher 2: isolation + shared library
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a2');
select tests.ok((select count(*) from classes) + (select count(*) from lessons) + (select count(*) from attempts) + (select count(*) from questions) = 0, 'other teacher sees nothing of teacher 1');
select tests.ok(tests.throws(format($$select grade_answer(%L, '30000000-0000-0000-0000-000000000002', false)$$, :'att1')), 'other teacher cannot grade teacher 1''s students');
select tests.ok(tests.throws($$update lessons set title = 'x' where id = '20000000-0000-0000-0000-000000000001' returning 1$$)
  or (select count(*) from lessons) = 0, 'other teacher cannot edit teacher 1''s lesson');
commit;

update lessons set shared = true where id = '20000000-0000-0000-0000-000000000001';
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a2');
select tests.ok((select count(*) from lessons) = 1 and (select count(*) from questions) = 2, 'shared lesson + questions show in library for other teachers');
select tests.throws($$update lessons set title = 'hijacked' where id = '20000000-0000-0000-0000-000000000001'$$);
select tests.ok(tests.throws($$insert into assignments (lesson_id, class_id) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')$$), 'other teacher cannot assign into teacher 1''s class');
select tests.become('00000000-0000-0000-0000-0000000000b3');
select tests.ok((select count(*) from lessons) = 0, 'students cannot browse the shared library');
commit;
select tests.ok((select title from lessons where id = '20000000-0000-0000-0000-000000000001') = 'Supply and demand', 'shared lesson cannot be edited by other teachers');

-- ---------- anon sees nothing
begin;
set local role anon;
select tests.ok(tests.throws($$select * from classes$$), 'signed-out users cannot read tables');
select tests.ok(tests.throws($$select get_student_lesson('40000000-0000-0000-0000-000000000001')$$), 'signed-out users cannot call RPCs');
commit;

\echo 'ALL RLS TESTS PASSED'
