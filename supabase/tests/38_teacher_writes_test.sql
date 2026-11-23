-- Red-team regression (Nov 23): lesson/question/assignment writes only go through the safe paths.
\set ON_ERROR_STOP on
\set QUIET on

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select save_lesson('{"title":"Locked","youtube_id":"abcdefghijk","duration_s":300}',
  '[{"at_s":10,"kind":"short","prompt":"p"}]') as lid \gset
select tests.ok(:'lid' is not null, 'save_lesson still works');
select tests.ok(tests.throws(format('delete from questions where lesson_id = %L', :'lid')), 'teacher cannot delete questions directly');
select tests.ok(tests.throws(format('update questions set prompt = %L where lesson_id = %L', 'x', :'lid')), 'teacher cannot edit questions directly');
select tests.ok(tests.throws(format('update lessons set youtube_id = %L where id = %L', 'AAAAAAAAAAA', :'lid')), 'teacher cannot edit lessons directly');
select tests.ok(tests.throws(format('delete from lessons where id = %L', :'lid')), 'teacher cannot delete lessons directly');
select tests.ok(tests.throws($$insert into lessons (teacher_id, title, youtube_id, duration_s) values (auth.uid(), 'x', 'abcdefghijk', 5)$$),
  'teacher cannot insert lessons directly');
select tests.ok(tests.throws($$select save_lesson('{"title":"nan","youtube_id":"abcdefghijk","duration_s":"NaN"}', '[]')$$), 'NaN duration refused');
select tests.ok(tests.throws($$select save_lesson('{"title":"inf","youtube_id":"abcdefghijk","duration_s":"Infinity"}', '[]')$$), 'Infinity duration refused');

insert into assignments (lesson_id, class_id) values (:'lid', '10000000-0000-0000-0000-000000000001') returning id as aid \gset
select tests.ok(:'aid' is not null, 'teacher can still assign a lesson');
update assignments set due_at = now() + interval '1 day', google_coursework_id = 'cw-1' where id = :'aid';
select tests.ok((select google_coursework_id from assignments where id = :'aid') = 'cw-1', 'due date and coursework id are still editable');
select tests.ok(tests.throws(format('update assignments set lesson_id = lesson_id where id = %L', :'aid')), 'assignment cannot be moved to another lesson');
select tests.ok(tests.throws(format('delete from assignments where id = %L', :'aid')), 'assignment cannot be deleted directly');
reset role;
delete from lessons where id = :'lid';
\echo 'ALL TEACHER WRITE TESTS PASSED'
