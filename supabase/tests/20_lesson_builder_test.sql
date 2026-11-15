-- save_lesson tests. Runs after 10_rls_test.sql and reuses its fixtures:
-- teacher 1 owns lesson ...0001 (questions ...0001 mc, ...0002 short), student 1 answered both and finished at 100.
\set ON_ERROR_STOP on
\set QUIET on

-- ---------- new lesson
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select save_lesson(
  '{"title":"Photosynthesis","subject":"Science","youtube_id":"abcdefghijk","duration_s":300,"source":"bulk_paste"}',
  '[{"at_s":30,"kind":"mc","prompt":"Where?","choices":["Leaf","Root"],"correct_index":0},
    {"at_s":120,"kind":"short","prompt":"Why?"}]') as new_lesson \gset
select tests.ok((select count(*) from questions where lesson_id = :'new_lesson') = 2, 'save_lesson creates lesson with questions');
select tests.ok((select teacher_id from lessons where id = :'new_lesson') = auth.uid(), 'new lesson belongs to the caller');
select tests.ok((select source from lessons where id = :'new_lesson') = 'bulk_paste', 'source is recorded');
select tests.ok(tests.throws($$select save_lesson('{"title":"x","youtube_id":"abcdefghijk","duration_s":60}', '[{"at_s":90,"kind":"short","prompt":"late"}]')$$),
  'question past the end of the video is rejected');
select tests.ok(tests.throws($$select save_lesson('{"title":"x","youtube_id":"not a yt id","duration_s":60}', '[]')$$),
  'bad YouTube id is rejected');
select tests.ok(tests.throws($$select save_lesson('{"title":"x","youtube_id":"abcdefghijk","duration_s":60}', '[{"at_s":5,"kind":"mc","prompt":"p","choices":["only one"],"correct_index":0}]')$$),
  'MC with fewer than 2 choices is rejected');
commit;

-- edit: replace questions on an unanswered lesson
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select save_lesson(format('{"id":"%s","title":"Photosynthesis 2","youtube_id":"abcdefghijk","duration_s":300}', :'new_lesson')::jsonb,
  '[{"at_s":45,"kind":"short","prompt":"Only one now"}]');
select tests.ok((select count(*) from questions where lesson_id = :'new_lesson') = 1, 'unanswered questions can be removed');
select tests.ok((select title from lessons where id = :'new_lesson') = 'Photosynthesis 2', 'lesson fields update');
commit;

-- ---------- permissions
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a2');
select tests.ok(tests.throws(format($$select save_lesson('{"id":"%s","title":"mine now","youtube_id":"abcdefghijk","duration_s":300}', '[]')$$, :'new_lesson')),
  'other teacher cannot save over teacher 1''s lesson');
select tests.ok(tests.throws($$select save_lesson('{"title":"steal","youtube_id":"dQw4w9WgXcQ","duration_s":100}', '[{"id":"30000000-0000-0000-0000-000000000001","at_s":1,"kind":"short","prompt":"x"}]')$$),
  'cannot pull another lesson''s question into your own lesson');
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok(tests.throws($$select save_lesson('{"title":"x","youtube_id":"abcdefghijk","duration_s":60}', '[]')$$),
  'students cannot create lessons');
commit;

-- ---------- edits after students answered (lesson ...0001)
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select tests.ok(tests.throws($$select save_lesson('{"id":"20000000-0000-0000-0000-000000000001","title":"Supply and demand","youtube_id":"dQw4w9WgXcQ","duration_s":100}',
  '[{"id":"30000000-0000-0000-0000-000000000002","at_s":50,"kind":"short","prompt":"Explain demand."}]')$$),
  'cannot delete a question students answered');
select tests.ok(tests.throws($$select save_lesson('{"id":"20000000-0000-0000-0000-000000000001","title":"Supply and demand","youtube_id":"aaaaaaaaaaa","duration_s":100}',
  '[{"id":"30000000-0000-0000-0000-000000000001","at_s":10,"kind":"mc","prompt":"What is supply?","choices":["A","B","C"],"correct_index":1},
    {"id":"30000000-0000-0000-0000-000000000002","at_s":50,"kind":"short","prompt":"Explain demand."}]')$$),
  'cannot swap the video once students started');
select tests.ok(tests.throws($$select save_lesson('{"id":"20000000-0000-0000-0000-000000000001","title":"Supply and demand","youtube_id":"dQw4w9WgXcQ","duration_s":100}',
  '[{"id":"30000000-0000-0000-0000-000000000001","at_s":10,"kind":"short","prompt":"What is supply?"},
    {"id":"30000000-0000-0000-0000-000000000002","at_s":50,"kind":"short","prompt":"Explain demand."}]')$$),
  'cannot change an answered question''s kind');
-- fix the answer key: student 1 answered 1, key moves to 2 -> wrong -> score 50
select save_lesson('{"id":"20000000-0000-0000-0000-000000000001","title":"Supply and demand","youtube_id":"dQw4w9WgXcQ","duration_s":100}',
  '[{"id":"30000000-0000-0000-0000-000000000001","at_s":10,"kind":"mc","prompt":"What is supply? (fixed typo)","choices":["A","B","C"],"correct_index":2},
    {"id":"30000000-0000-0000-0000-000000000002","at_s":50,"kind":"short","prompt":"Explain demand."}]');
select tests.ok((select is_correct from answers where question_id = '30000000-0000-0000-0000-000000000001') = false, 'changing the MC key re-grades existing answers');
select tests.ok((select score from attempts where student_id = '00000000-0000-0000-0000-0000000000b1') = 50, 'changing the MC key re-scores finished attempts');
select tests.ok((select count(*) from answers) = 2, 'editing an answered lesson keeps student answers');
commit;

\echo 'ALL LESSON BUILDER TESTS PASSED'
