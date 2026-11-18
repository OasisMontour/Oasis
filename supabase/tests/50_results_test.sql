-- assignment_results tests. Runs after 10-40 and reuses the fixture class/lesson/assignment.
-- State on entry: gc-fixture roster is only s2 (test 30); b1 finished (score 50, 1 focus event, left the roster);
-- b2 enrolled, no attempt; teachers a1 (owner) and a2.
\set ON_ERROR_STOP on
\set QUIET on

-- a roster entry for someone who never signed in
insert into roster_entries (class_id, email, name)
  values ('10000000-0000-0000-0000-000000000001', 'ghost@district.org', 'Ghost Student');

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select assignment_results('40000000-0000-0000-0000-000000000001') as r \gset
commit;

select tests.ok(:'r'::jsonb #>> '{assignment,lesson_title}' = 'Supply and demand', 'header has lesson title');
select tests.ok(:'r'::jsonb #>> '{assignment,class_name}' = 'Period 3 Business', 'header has class name');
select tests.ok((:'r'::jsonb #>> '{assignment,duration_s}')::numeric = 100, 'header has duration');
select tests.ok(:'r'::jsonb #> '{assignment,due_at}' = 'null'::jsonb and :'r'::jsonb #> '{assignment,google_coursework_id}' = 'null'::jsonb,
  'header has due_at and google_coursework_id keys (null)');
select tests.ok((select count(*) from jsonb_object_keys(:'r'::jsonb -> 'assignment')) = 8, 'header has exactly 8 keys');

select tests.ok(jsonb_array_length(:'r'::jsonb -> 'questions') = 2, 'both questions listed');
select tests.ok((:'r'::jsonb #>> '{questions,0,at_s}')::numeric = 10 and (:'r'::jsonb #>> '{questions,1,at_s}')::numeric = 50, 'questions ordered by time');
select tests.ok(not exists (
  select 1 from jsonb_array_elements(:'r'::jsonb -> 'questions') q, unnest(array['id','at_s','kind','prompt','choices','correct_index']) k
  where not q ? k), 'every question has every field');
select tests.ok((:'r'::jsonb #>> '{questions,0,correct_index}')::int = (select correct_index from questions where id = '30000000-0000-0000-0000-000000000001'), 'teacher sees the correct index');

select tests.ok(jsonb_array_length(:'r'::jsonb -> 'students') = 3, 'finished student, enrolled student and ghost all listed');
select tests.ok((select string_agg(s ->> 'email', ',' order by ord) from jsonb_array_elements(:'r'::jsonb -> 'students') with ordinality t(s, ord))
  = 's2@district.org,ghost@district.org,s1@district.org', 'sorted by name (blank first), then email');

select s as s1 from jsonb_array_elements(:'r'::jsonb -> 'students') s where s ->> 'email' = 's1@district.org' \gset
select s as s2 from jsonb_array_elements(:'r'::jsonb -> 'students') s where s ->> 'email' = 's2@district.org' \gset
select s as sg from jsonb_array_elements(:'r'::jsonb -> 'students') s where s ->> 'email' = 'ghost@district.org' \gset

select tests.ok(:'s1'::jsonb ->> 'status' = 'finished', 'student 1 finished');
select tests.ok((:'s1'::jsonb ->> 'progress_pct')::int = 100, 'student 1 progress 100');
select tests.ok((:'s1'::jsonb ->> 'score')::numeric = 50, 'student 1 score 50');
select tests.ok(:'s1'::jsonb ->> 'finished_at' is not null, 'student 1 has finished_at');
select tests.ok(:'s1'::jsonb ->> 'name' = 'Student One', 'name from profile');
select tests.ok((:'s1'::jsonb ->> 'on_roster')::boolean = false, 'student who left the course still appears with on_roster=false');
select tests.ok((:'s1'::jsonb ->> 'late')::boolean = false, 'no due date means not late');
select tests.ok((:'s1'::jsonb ->> 'focus_events')::int = 1, 'focus events counted');
select tests.ok((select count(*) from jsonb_object_keys(:'s1'::jsonb -> 'answers')) = (select count(*) from answers), 'student 1 answers all present');
select tests.ok(not exists (
  select 1 from answers an left join jsonb_each(:'s1'::jsonb -> 'answers') e on e.key = an.question_id::text
  where e.key is null
     or e.value ->> 'response' is distinct from an.response
     or (e.value -> 'is_correct') is distinct from to_jsonb(an.is_correct)
     or e.value ->> 'graded_by' is distinct from an.graded_by), 'answer detail matches the answers table');

select tests.ok(:'s2'::jsonb ->> 'status' = 'not_started', 'student 2 not started');
select tests.ok((:'s2'::jsonb ->> 'on_roster')::boolean, 'student 2 on roster');
select tests.ok((:'s2'::jsonb ->> 'progress_pct')::int = 0 and :'s2'::jsonb -> 'score' = 'null'::jsonb and :'s2'::jsonb -> 'answers' = '{}'::jsonb
  and (:'s2'::jsonb ->> 'focus_events')::int = 0, 'student 2 has empty progress, score, answers');
select tests.ok(:'sg'::jsonb ->> 'status' = 'not_signed_in' and :'sg'::jsonb -> 'student_id' = 'null'::jsonb
  and :'sg'::jsonb ->> 'name' = 'Ghost Student' and (:'sg'::jsonb ->> 'on_roster')::boolean, 'roster-only student is not_signed_in with roster name');

-- focus_events ignores no_fullscreen_support; attempt_id is exposed
insert into focus_events (attempt_id, kind, video_s)
  select id, 'no_fullscreen_support', 1 from attempts where student_id = '00000000-0000-0000-0000-0000000000b1';
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select assignment_results('40000000-0000-0000-0000-000000000001') as rf \gset
commit;
select tests.ok((select (s ->> 'focus_events')::int from jsonb_array_elements(:'rf'::jsonb -> 'students') s where s ->> 'email' = 's1@district.org') = 1,
  'no_fullscreen_support is not counted as a focus event');
select tests.ok((select (s ->> 'attempt_id')::uuid from jsonb_array_elements(:'rf'::jsonb -> 'students') s where s ->> 'email' = 's1@district.org')
  = (select id from attempts where student_id = '00000000-0000-0000-0000-0000000000b1'), 'student row exposes attempt_id');
select tests.ok((select s -> 'attempt_id' from jsonb_array_elements(:'rf'::jsonb -> 'students') s where s ->> 'email' = 'ghost@district.org') = 'null'::jsonb,
  'attempt_id is null without an attempt');

-- late flag: due date in the past
update assignments set due_at = now() - interval '1 day' where id = '40000000-0000-0000-0000-000000000001';
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select assignment_results('40000000-0000-0000-0000-000000000001') as r2 \gset
commit;
select tests.ok((select (s ->> 'late')::boolean from jsonb_array_elements(:'r2'::jsonb -> 'students') s where s ->> 'email' = 's1@district.org'),
  'finished after the deadline is late');
select tests.ok((select (s ->> 'late')::boolean from jsonb_array_elements(:'r2'::jsonb -> 'students') s where s ->> 'email' = 's2@district.org'),
  'unfinished past the deadline is late');

-- future deadline: finished student not late
update assignments set due_at = now() + interval '1 day' where id = '40000000-0000-0000-0000-000000000001';
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select assignment_results('40000000-0000-0000-0000-000000000001') as r3 \gset
commit;
select tests.ok(not exists (select 1 from jsonb_array_elements(:'r3'::jsonb -> 'students') s where (s ->> 'late')::boolean), 'nobody is late before the deadline');
update assignments set due_at = null where id = '40000000-0000-0000-0000-000000000001';

-- in progress + progress_pct: student 2 starts and watches 25s
insert into attempts (assignment_id, student_id, max_watched_s)
  values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 25);
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select assignment_results('40000000-0000-0000-0000-000000000001') as r4 \gset
commit;
select tests.ok((select s ->> 'status' from jsonb_array_elements(:'r4'::jsonb -> 'students') s where s ->> 'email' = 's2@district.org') = 'in_progress', 'started student is in_progress');
select tests.ok((select (s ->> 'progress_pct')::int from jsonb_array_elements(:'r4'::jsonb -> 'students') s where s ->> 'email' = 's2@district.org') = 25, 'progress is a percentage of duration');

-- access control
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a2');
select tests.ok(tests.throws($$select assignment_results('40000000-0000-0000-0000-000000000001')$$), 'other teacher is refused');
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok(tests.throws($$select assignment_results('40000000-0000-0000-0000-000000000001')$$), 'student is refused');
select tests.become('00000000-0000-0000-0000-0000000000a1');
select tests.ok(tests.throws($$select assignment_results('99999999-0000-0000-0000-000000000001')$$), 'unknown assignment is refused');
commit;
begin;
set local role anon;
select tests.ok(tests.throws($$select assignment_results('40000000-0000-0000-0000-000000000001')$$), 'anon cannot execute');
commit;

\echo 'ALL RESULTS TESTS PASSED'
