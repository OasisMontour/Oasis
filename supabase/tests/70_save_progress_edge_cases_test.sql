-- save_progress edge cases from the Nov 23 bug pass (see migration 20261123000000).
\set ON_ERROR_STOP on
\set QUIET on

insert into classes (id, teacher_id, name, google_course_id)
  values ('10000000-0000-0000-0000-000000000070', '00000000-0000-0000-0000-0000000000a1', 'Edge class', 'gc-edge');
insert into enrollments (class_id, student_id) values ('10000000-0000-0000-0000-000000000070', '00000000-0000-0000-0000-0000000000b1');
insert into lessons (id, teacher_id, title, youtube_id, duration_s)
  values ('20000000-0000-0000-0000-000000000070', '00000000-0000-0000-0000-0000000000a1', 'Edge video', 'edgeedgeedg', 600);
insert into questions (id, lesson_id, at_s, kind, prompt, choices, correct_index)
  values ('30000000-0000-0000-0000-000000000070', '20000000-0000-0000-0000-000000000070', 100, 'mc', 'Q at 1:40', '["a","b"]', 0);
insert into assignments (id, lesson_id, class_id)
  values ('40000000-0000-0000-0000-000000000070', '20000000-0000-0000-0000-000000000070', '10000000-0000-0000-0000-000000000070');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select (get_student_lesson('40000000-0000-0000-0000-000000000070') ->> 'attempt_id') as att \gset
reset role;
update attempts set max_watched_s = 100 where id = :'att';
set role authenticated;
select submit_answer(:'att', '30000000-0000-0000-0000-000000000070', '0');
reset role;
-- pretend the student has honestly watched to 5:00
update attempts set max_watched_s = 300, last_pos_s = 300 where id = :'att';

-- 1. Teacher adds a question at 3:20, behind where the student already is.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select save_lesson(
  '{"id":"20000000-0000-0000-0000-000000000070","title":"Edge video","youtube_id":"edgeedgeedg","duration_s":600}',
  '[{"id":"30000000-0000-0000-0000-000000000070","at_s":100,"kind":"mc","prompt":"Q at 1:40","choices":["a","b"],"correct_index":0},
    {"at_s":200,"kind":"short","prompt":"New Q at 3:20"}]');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select tests.ok(not tests.throws(format('select save_progress(%L, 300, 250)', :'att')),
  'a save that does not move forward is accepted even when a new question sits behind the student');
select tests.ok((select last_pos_s from attempts where id = :'att') = 250, 'resume position still saves');
select tests.ok(tests.throws(format('select save_progress(%L, 310, 310)', :'att')),
  'but the student cannot move forward until they answer the new question');
reset role;
select id as newq from questions where lesson_id = '20000000-0000-0000-0000-000000000070' and at_s = 200 \gset
-- new attempts start with an empty watch-credit bucket; pretend real time has passed
update attempts set credit_at = now() - interval '1 hour' where id = :'att';
set role authenticated;
select submit_answer(:'att', :'newq', 'an answer');
select tests.ok(not tests.throws(format('select save_progress(%L, 310, 310)', :'att')),
  'after answering it they can keep going');
reset role;

-- 2. The player's last save lands a hair past duration_s (YouTube reports 600.4, teacher saved floor = 600).
update attempts set max_watched_s = 595, credit_at = now() - interval '1 hour' where id = :'att';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select tests.ok(not tests.throws(format('select save_progress(%L, 600.4, 600.4)', :'att')),
  'a final save slightly past the stored duration is clamped, not rejected');
select tests.ok((select max_watched_s from attempts where id = :'att') = 600, 'progress is clamped to the video length');
select tests.ok(not tests.throws(format('select finish_attempt(%L)', :'att')), 'student can finish');
reset role;

\echo 'ALL EDGE CASE TESTS PASSED'
