-- Integrated bug pass (Nov 23): a student removed from the class mid-lesson can't keep writing to their attempt,
-- and the error says why ("not assigned to you"), so the player can show it instead of blaming the Wi-Fi.
\set ON_ERROR_STOP on
\set QUIET on

-- true if the statement raises an error whose message contains msg
create or replace function tests.throws_msg(stmt text, msg text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return position(msg in sqlerrm) > 0;
end $$;
grant execute on function tests.throws_msg(text, text) to authenticated;

insert into lessons (id, teacher_id, title, youtube_id, duration_s)
  values ('20000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-0000000000a1', 'Removed', 'abcdefghijk', 600);
insert into questions (id, lesson_id, at_s, kind, prompt, choices, correct_index) values
  ('30000000-0000-0000-0000-000000000421', '20000000-0000-0000-0000-000000000042', 0, 'mc', 'Q0', '["a","b"]', 1),
  ('30000000-0000-0000-0000-000000000422', '20000000-0000-0000-0000-000000000042', 5, 'short', 'Q1', null, null);
insert into assignments (id, lesson_id, class_id)
  values ('40000000-0000-0000-0000-000000000042', '20000000-0000-0000-0000-000000000042', '10000000-0000-0000-0000-000000000001');
create temp table pre_enrolled as select * from enrollments;
insert into enrollments (class_id, student_id) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1')
  on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select (get_student_lesson('40000000-0000-0000-0000-000000000042') ->> 'attempt_id') as att \gset
select submit_answer(:'att', '30000000-0000-0000-0000-000000000421', '1');
select save_progress(:'att', 0, 0);
select log_focus_event(:'att', 'blur', 3);
select tests.ok(true, 'an enrolled student can save, answer and log as before');

-- Classroom sync takes them off the roster
reset role;
select set_config('request.jwt.claim.sub', '', false);
delete from enrollments where class_id = '10000000-0000-0000-0000-000000000001' and student_id = '00000000-0000-0000-0000-0000000000b1';
update attempts set max_watched_s = 600, watch_credit_s = 30 where id = :'att';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select tests.ok(tests.throws_msg(format('select save_progress(%L, 600, 600)', :'att'), 'not assigned to you'), 'removed student: save_progress says not assigned');
select tests.ok(tests.throws_msg(format('select submit_answer(%L, %L, %L)', :'att', '30000000-0000-0000-0000-000000000422', 'x'), 'not assigned to you'),
  'removed student: submit_answer says not assigned');
select tests.ok(tests.throws_msg(format('select log_focus_event(%L, %L, 1)', :'att', 'blur'), 'not assigned to you'), 'removed student: log_focus_event says not assigned');
select tests.ok(tests.throws_msg(format('select get_question(%L, %L)', :'att', '30000000-0000-0000-0000-000000000422'), 'not assigned to you'),
  'removed student: get_question says not assigned (unchanged)');

-- the teacher still sees and can grade what they did
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select grade_answer(:'att', '30000000-0000-0000-0000-000000000421', false);
select tests.ok(true, 'teacher can still grade a removed student''s answer');
select tests.ok(jsonb_array_length(assignment_results('40000000-0000-0000-0000-000000000042') -> 'students') >= 1, 'teacher still sees the removed student''s attempt');
reset role;

-- back on the roster: they can carry on
select set_config('request.jwt.claim.sub', '', false);
insert into enrollments (class_id, student_id) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select submit_answer(:'att', '30000000-0000-0000-0000-000000000422', 'back again');
select tests.ok(true, 're-added student can answer again');
reset role;

delete from lessons where id = '20000000-0000-0000-0000-000000000042';
delete from enrollments e where not exists (select 1 from pre_enrolled p where p.class_id = e.class_id and p.student_id = e.student_id);
\echo 'ALL REMOVED STUDENT TESTS PASSED'
