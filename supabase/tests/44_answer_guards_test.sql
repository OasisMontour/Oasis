-- submit_answer rejects empty short answers and out-of-range MC indexes (20261129000100).
\set ON_ERROR_STOP on
\set QUIET on

insert into lessons (id, teacher_id, title, youtube_id, duration_s)
  values ('20000000-0000-0000-0000-000000000044', '00000000-0000-0000-0000-0000000000a1', 'Guards', 'guardsguard', 100);
insert into questions (id, lesson_id, at_s, kind, prompt, choices, correct_index) values
  ('30000000-0000-0000-0000-000000000441', '20000000-0000-0000-0000-000000000044', 0, 'mc', 'Pick one', '["a","b","c"]', 2),
  ('30000000-0000-0000-0000-000000000442', '20000000-0000-0000-0000-000000000044', 0, 'short', 'Explain', null, null);
insert into assignments (id, lesson_id, class_id)
  values ('40000000-0000-0000-0000-000000000044', '20000000-0000-0000-0000-000000000044', '10000000-0000-0000-0000-000000000001');
insert into enrollments (class_id, student_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1') on conflict do nothing;

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select (get_student_lesson('40000000-0000-0000-0000-000000000044') ->> 'attempt_id') as att \gset
select tests.ok(tests.throws(format($$select submit_answer(%L, '30000000-0000-0000-0000-000000000442', '   ')$$, :'att')), 'empty short answer is rejected');
select tests.ok(tests.throws(format($$select submit_answer(%L, '30000000-0000-0000-0000-000000000442', '')$$, :'att')), 'blank short answer is rejected');
select tests.ok(tests.throws(format($$select submit_answer(%L, '30000000-0000-0000-0000-000000000441', '3')$$, :'att')), 'mc index past the last choice is rejected');
select tests.ok(tests.throws(format($$select submit_answer(%L, '30000000-0000-0000-0000-000000000441', '99999999999')$$, :'att')), 'huge mc index is rejected');
select tests.ok(tests.throws(format($$select submit_answer(%L, '30000000-0000-0000-0000-000000000441', '-1')$$, :'att')), 'negative mc index is rejected');
commit;
select tests.ok((select count(*) from answers where attempt_id = :'att') = 0, 'nothing was stored');
-- the error text for the huge index is ours, not Postgres's integer overflow
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
  perform submit_answer((select id from attempts where assignment_id = '40000000-0000-0000-0000-000000000044'), '30000000-0000-0000-0000-000000000441', '99999999999');
exception when others then
  if sqlerrm <> 'mc response must be a choice index' then raise exception 'FAIL: huge index error was %', sqlerrm; end if;
end $$;
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select submit_answer(:'att', '30000000-0000-0000-0000-000000000441', '2');
select submit_answer(:'att', '30000000-0000-0000-0000-000000000442', '  Because energy  ');
commit;
select tests.ok((select is_correct from answers where attempt_id = :'att' and question_id = '30000000-0000-0000-0000-000000000441'), 'valid mc index still works');
select tests.ok((select response from answers where attempt_id = :'att' and question_id = '30000000-0000-0000-0000-000000000442') = 'Because energy', 'short answer is trimmed');

-- leave no fixtures behind for later test files
delete from lessons where id = '20000000-0000-0000-0000-000000000044';
\echo ALL ANSWER GUARD TESTS PASSED
