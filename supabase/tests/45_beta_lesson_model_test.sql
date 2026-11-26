-- Beta lesson model: class on a lesson, multi-select (exact match), notes, answer feedback.
\set ON_ERROR_STOP on
\set QUIET on

-- Uses the shared fixtures: teacher a1 teaches class ...0001 (gc-fixture), teacher a2 is another teacher, b1 a student.
create temp table pre_enrolled as select * from enrollments;
insert into enrollments (class_id, student_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1') on conflict do nothing;

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select save_lesson(
  '{"title":"Beta","youtube_id":"dQw4w9WgXcQ","duration_s":100,"class_id":"10000000-0000-0000-0000-000000000001",
    "notes":[{"at_s":5,"body":"  Watch the graph here. "},{"at_s":50,"body":"Halfway!"}]}',
  '[{"at_s":10,"kind":"multi","prompt":"Pick the even ones","choices":["1","2","3","4"],"correct_indexes":[3,1,1]},
    {"at_s":20,"kind":"mc","prompt":"Pick B","choices":["A","B"],"correct_index":1},
    {"at_s":30,"kind":"short","prompt":"Why?"}]') as lid \gset
select tests.ok((select class_id from lessons where id = :'lid') = '10000000-0000-0000-0000-000000000001', 'lesson keeps its class');
select tests.ok((select correct_indexes from questions where lesson_id = :'lid' and kind = 'multi') = '{1,3}', 'multi key saved sorted and de-duplicated');
select tests.ok((select string_agg(body, '|' order by at_s) from lesson_notes where lesson_id = :'lid') = 'Watch the graph here.|Halfway!', 'notes saved and trimmed');
select tests.ok(tests.throws($$select save_lesson('{"title":"x","youtube_id":"dQw4w9WgXcQ","duration_s":100}',
  '[{"at_s":1,"kind":"multi","prompt":"q","choices":["a","b"],"correct_indexes":[]}]')$$), 'multi needs at least one right answer');
select tests.ok(tests.throws($$select save_lesson('{"title":"x","youtube_id":"dQw4w9WgXcQ","duration_s":100}',
  '[{"at_s":1,"kind":"multi","prompt":"q","choices":["a","b"],"correct_indexes":[2]}]')$$), 'multi key must be a real choice');
select tests.ok(tests.throws($$select save_lesson('{"title":"x","youtube_id":"dQw4w9WgXcQ","duration_s":100,"notes":[{"at_s":101,"body":"late"}]}', '[]')$$),
  'note past the end is refused');
select tests.ok(tests.throws($$select save_lesson('{"title":"x","youtube_id":"dQw4w9WgXcQ","duration_s":100,"notes":[{"at_s":1,"body":"  "}]}', '[]')$$),
  'blank note is refused');
select tests.ok(tests.throws($$insert into lesson_notes (lesson_id, at_s, body) values ('$$ || :'lid' || $$', 1, 'x')$$), 'notes are not writable directly');
select tests.become('00000000-0000-0000-0000-0000000000a2');
select tests.ok(tests.throws($$select save_lesson('{"title":"x","youtube_id":"dQw4w9WgXcQ","duration_s":100,"class_id":"10000000-0000-0000-0000-000000000001"}', '[]')$$),
  'cannot put a lesson in someone else''s class');
select tests.ok((select count(*) from lesson_notes where lesson_id = :'lid') = 0, 'other teachers cannot read private notes');
commit;

select id as qm from questions where lesson_id = :'lid' and kind = 'multi' \gset
select id as qc from questions where lesson_id = :'lid' and kind = 'mc' \gset
select id as qs from questions where lesson_id = :'lid' and kind = 'short' \gset
insert into assignments (id, lesson_id, class_id) values ('40000000-0000-0000-0000-000000000451', :'lid', '10000000-0000-0000-0000-000000000001');

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select get_student_lesson('40000000-0000-0000-0000-000000000451') as l \gset
select (:'l'::jsonb ->> 'attempt_id') as att \gset
select tests.ok(jsonb_array_length(:'l'::jsonb -> 'notes') = 2 and (:'l'::jsonb ->> 'show_feedback')::boolean, 'student gets notes and the feedback flag');
select tests.ok(not (:'l'::jsonb::text like '%correct_indexes%'), 'student payload has no multi key');
select tests.ok(tests.throws($$select count(*) from lesson_notes$$) or (select count(*) from lesson_notes) = 0, 'students cannot read notes over REST');
commit;
update attempts set max_watched_s = 100 where id = :'att';

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok(tests.throws($$select submit_answer('$$ || :'att' || $$', '$$ || :'qm' || $$', '1,9')$$), 'multi index out of range refused');
select tests.ok(tests.throws($$select submit_answer('$$ || :'att' || $$', '$$ || :'qm' || $$', 'one,two')$$), 'multi junk refused');
select tests.ok(submit_answer(:'att', :'qm', '3, 1') ->> 'result' = 'correct', 'exact set is correct, in any order');
select tests.ok(submit_answer(:'att', :'qc', '0') ->> 'result' = 'incorrect', 'wrong mc says incorrect');
select tests.ok(submit_answer(:'att', :'qs', 'because') ->> 'result' = 'submitted', 'short answer says submitted');
commit;
select tests.ok((select response from answers where question_id = :'qm') = '1,3', 'multi response stored normalised');
select tests.ok((select score from attempts where id = :'att') is null, 'not finished yet');

-- partial multi answer is wrong (exact match), and a key change re-grades it
delete from answers where question_id = :'qm';
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok(submit_answer(:'att', :'qm', '1') ->> 'result' = 'incorrect', 'partial set is incorrect');
select tests.become('00000000-0000-0000-0000-0000000000a1');
select save_lesson(jsonb_build_object('id', :'lid', 'title', 'Beta', 'youtube_id', 'dQw4w9WgXcQ', 'duration_s', 100),
  (select jsonb_agg(jsonb_build_object('id', id, 'at_s', at_s, 'kind', kind, 'prompt', prompt, 'choices', choices,
     'correct_index', correct_index, 'correct_indexes', case when kind = 'multi' then '[1]'::jsonb end) order by at_s) from questions where lesson_id = :'lid'));
commit;
select tests.ok((select is_correct from answers where question_id = :'qm'), 'key change re-grades multi answers');
select tests.ok((select class_id from lessons where id = :'lid') is not null, 'save without class_id keeps the class');
select tests.ok((select count(*) from lesson_notes where lesson_id = :'lid') = 2, 'save without notes keeps them');

delete from lessons where id = :'lid';
delete from enrollments e where not exists (select 1 from pre_enrolled p where p.class_id = e.class_id and p.student_id = e.student_id);
\echo 'ALL BETA LESSON MODEL TESTS PASSED'
