-- Cheat-test regression (Nov 23): students can't learn which answers are right (no answer-key oracle),
-- and teachers can still push grades.
\set ON_ERROR_STOP on
\set QUIET on

insert into lessons (id, teacher_id, title, youtube_id, duration_s)
  values ('20000000-0000-0000-0000-000000000079', '00000000-0000-0000-0000-0000000000a1', 'Oracle', 'oracleoracl', 100);
insert into questions (id, lesson_id, at_s, kind, prompt, choices, correct_index) values
  ('30000000-0000-0000-0000-000000000791', '20000000-0000-0000-0000-000000000079', 0, 'mc', 'Pick one', '["a","b","c"]', 2);
insert into assignments (id, lesson_id, class_id, google_coursework_id)
  values ('40000000-0000-0000-0000-000000000079', '20000000-0000-0000-0000-000000000079', '10000000-0000-0000-0000-000000000001', 'cw-79');
create temp table pre_enrolled as select * from enrollments;
insert into enrollments (class_id, student_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1') on conflict do nothing;

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select get_student_lesson('40000000-0000-0000-0000-000000000079') as l \gset
select (:'l'::jsonb ->> 'attempt_id') as att \gset
select tests.ok(not (:'l'::jsonb ? 'score'), 'player payload has no score');
select tests.ok((select pg_typeof(submit_answer(:'att', '30000000-0000-0000-0000-000000000791', '2'))::text) = 'void',
  'submit_answer returns nothing (no right/wrong)');
select tests.ok((select count(*) from answers) = 0, 'student cannot read is_correct back over REST');
select tests.ok(tests.throws('select score from attempts'), 'student cannot read attempts.score');
select tests.ok((select max_watched_s from attempts where id = :'att') = 0, 'student can still read their own progress');
commit;

update attempts set max_watched_s = 100 where id = :'att';
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok((select pg_typeof(finish_attempt(:'att'))::text) = 'void', 'finish_attempt returns nothing (no score)');
select tests.ok(not (get_student_lesson('40000000-0000-0000-0000-000000000079') ? 'score'), 'reopening a finished lesson shows no score');
select tests.ok(grades_to_push('40000000-0000-0000-0000-000000000079') is null, 'student cannot call grades_to_push for their class');
commit;
select tests.ok((select score from attempts where id = :'att') = 100, 'score is still computed and stored');

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select grades_to_push('40000000-0000-0000-0000-000000000079') as g \gset
select tests.ok(:'g'::jsonb ->> 'coursework_id' = 'cw-79' and :'g'::jsonb ->> 'course_id' = 'gc-fixture', 'teacher gets the Classroom ids');
select tests.ok((:'g'::jsonb -> 'grades' -> 0 ->> 'score')::numeric = 100 and (:'g'::jsonb -> 'grades' -> 0 ->> 'email') = 's1@district.org'
  and (:'g'::jsonb -> 'grades' -> 0 ->> 'ungraded')::int = 0, 'teacher gets finished students'' scores');
select tests.ok((select count(*) from answers where attempt_id = :'att') = 1, 'teacher still reads answers in their class');
select tests.become('00000000-0000-0000-0000-0000000000a2');
select tests.ok(grades_to_push('40000000-0000-0000-0000-000000000079') is null, 'another teacher gets nothing');
commit;

-- leave the shared fixtures as they were for later test files
delete from lessons where id = '20000000-0000-0000-0000-000000000079';
delete from enrollments e where not exists (select 1 from pre_enrolled p where p.class_id = e.class_id and p.student_id = e.student_id);
\echo 'ALL ANSWER ORACLE TESTS PASSED'
