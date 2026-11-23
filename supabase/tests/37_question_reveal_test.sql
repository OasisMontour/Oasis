-- Red-team regression (Nov 23): a student can't read a question before the video reaches it.
\set ON_ERROR_STOP on
\set QUIET on

insert into lessons (id, teacher_id, title, youtube_id, duration_s)
  values ('20000000-0000-0000-0000-000000000077', '00000000-0000-0000-0000-0000000000a1', 'Reveal', 'abcdefghijk', 600);
insert into questions (id, lesson_id, at_s, kind, prompt, choices, correct_index) values
  ('30000000-0000-0000-0000-000000000771', '20000000-0000-0000-0000-000000000077', 0, 'short', 'Warm-up question', null, null),
  ('30000000-0000-0000-0000-000000000772', '20000000-0000-0000-0000-000000000077', 120, 'mc', 'Secret mid-video question', '["a","b"]', 1);
insert into assignments (id, lesson_id, class_id)
  values ('40000000-0000-0000-0000-000000000077', '20000000-0000-0000-0000-000000000077', '10000000-0000-0000-0000-000000000001');
create temp table pre_enrolled as select * from enrollments;
insert into enrollments (class_id, student_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2')
  on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select get_student_lesson('40000000-0000-0000-0000-000000000077') as l \gset
select (:'l'::jsonb ->> 'attempt_id') as att \gset
select tests.ok(:'l'::jsonb::text not like '%Secret mid-video%', 'unreached question prompt is not sent at 0:00');
select tests.ok(:'l'::jsonb::text not like '%correct%', 'player payload still has no answer key');
select tests.ok((:'l'::jsonb -> 'questions' -> 1 ->> 'locked')::boolean and (:'l'::jsonb -> 'questions' -> 1 ->> 'at_s')::numeric = 120,
  'unreached question still tells the player where to pause');
select tests.ok(:'l'::jsonb -> 'questions' -> 0 ->> 'prompt' = 'Warm-up question', 'a question at 0:00 is visible right away');
select tests.ok(tests.throws(format('select get_question(%L, %L)', :'att', '30000000-0000-0000-0000-000000000772')),
  'get_question refuses an unreached question');

reset role;
update attempts set max_watched_s = 120 where id = :'att';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select tests.ok(get_question(:'att', '30000000-0000-0000-0000-000000000772') ->> 'prompt' = 'Secret mid-video question',
  'get_question returns the prompt once reached');
select tests.ok(get_question(:'att', '30000000-0000-0000-0000-000000000772')::text not like '%correct%', 'get_question never returns the answer key');
select tests.ok(get_student_lesson('40000000-0000-0000-0000-000000000077')::text like '%Secret mid-video%', 'reached question shows in the lesson payload');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select tests.ok(tests.throws(format('select get_question(%L, %L)', :'att', '30000000-0000-0000-0000-000000000772')),
  'another student cannot use someone else''s attempt to read questions');
reset role;

-- leave the shared fixtures as they were for later test files
delete from lessons where id = '20000000-0000-0000-0000-000000000077';
delete from enrollments e where not exists (select 1 from pre_enrolled p where p.class_id = e.class_id and p.student_id = e.student_id);
\echo 'ALL QUESTION REVEAL TESTS PASSED'
