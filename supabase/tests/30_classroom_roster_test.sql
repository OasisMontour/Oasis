-- import_classroom tests. Runs after 10/20 and reuses their users:
-- t1, t2 teachers; s1, s2 enrolled students; s3 not enrolled anywhere.
\set ON_ERROR_STOP on
\set QUIET on

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select import_classroom('[
  {"id":"gc-1","name":"Biology","section":"Period 2","students":[
     {"email":"S3@district.org","name":"Student Three"},
     {"email":"new.kid@district.org","name":"New Kid"},
     {"email":"new.kid@district.org","name":"dupe"},
     {"email":"","name":"no email"}]},
  {"id":"gc-2","name":"Chem","students":[]}
]') as r \gset
select tests.ok((:'r'::jsonb ->> 'created')::int = 2, 'import creates one class per course');
select tests.ok((select name from classes where google_course_id = 'gc-1') = 'Biology · Period 2', 'class name includes section');
select tests.ok((select count(*) from roster_entries r join classes c on c.id = r.class_id where c.google_course_id = 'gc-1') = 2,
  'roster dedupes emails and drops blanks');
select tests.ok((:'r'::jsonb ->> 'newly_enrolled')::int = 1, 'existing student account is enrolled right away');
select tests.ok(exists (select 1 from enrollments e join classes c on c.id = e.class_id
  where c.google_course_id = 'gc-1' and e.student_id = '00000000-0000-0000-0000-0000000000b3'), 'existing student matched by email (case-insensitive)');

-- re-sync: renamed course, student removed from roster
select import_classroom('[{"id":"gc-1","name":"Biology Honors","students":[{"email":"new.kid@district.org","name":"New Kid"}]}]') as r2 \gset
select tests.ok((:'r2'::jsonb ->> 'updated')::int = 1 and (:'r2'::jsonb ->> 'created')::int = 0, 're-import updates instead of duplicating');
select tests.ok((select name from classes where google_course_id = 'gc-1') = 'Biology Honors', 're-import picks up renames');
select tests.ok(not exists (select 1 from enrollments e join classes c on c.id = e.class_id
  where c.google_course_id = 'gc-1' and e.student_id = '00000000-0000-0000-0000-0000000000b3'), 're-import removes students who left the Classroom course');
select tests.ok((:'r2'::jsonb ->> 'removed')::int = 1, 're-import reports how many were removed');
commit;

-- a brand new student signs in for the first time -> auto-enrolled
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b4', 'New.Kid@district.org', '{"full_name":"New Kid"}');
select tests.ok(exists (select 1 from enrollments e join classes c on c.id = e.class_id
  where c.google_course_id = 'gc-1' and e.student_id = '00000000-0000-0000-0000-0000000000b4'), 'new student is enrolled from the roster on first sign-in');

-- a teacher on a roster is not enrolled as a student
insert into public.teacher_allowlist (email) values ('t3@district.org');
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select import_classroom('[{"id":"gc-2","name":"Chem","students":[{"email":"t3@district.org"}]}]');
commit;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a3', 't3@district.org');
select tests.ok(not exists (select 1 from enrollments where student_id = '00000000-0000-0000-0000-0000000000a3'), 'teachers are never enrolled as students');

-- isolation
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a2');
select tests.ok((select count(*) from roster_entries) = 0, 'other teacher cannot see teacher 1''s rosters');
select import_classroom('[{"id":"gc-1","name":"Co-taught Bio","students":[{"email":"s1@district.org"}]}]') as r3 \gset
select tests.ok((:'r3'::jsonb -> 'skipped') ? 'Co-taught Bio', 'co-teacher importing the same course is skipped, not hijacked');
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok(tests.throws($$select import_classroom('[]')$$), 'students cannot import rosters');
select tests.ok((select count(*) from roster_entries) = 0, 'students cannot read rosters');
commit;
select tests.ok((select teacher_id from classes where google_course_id = 'gc-1') = '00000000-0000-0000-0000-0000000000a1', 'course stays with the first teacher');

-- student 1 leaves the fixture course: loses access, but teacher 1 still sees their past work by name
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select import_classroom('[{"id":"gc-fixture","name":"Period 3 Business","students":[{"email":"s2@district.org"}]}]');
select tests.ok((select count(*) from attempts where student_id = '00000000-0000-0000-0000-0000000000b1') = 1, 'teacher keeps results of a student who left');
select tests.ok((select count(*) from profiles where id = '00000000-0000-0000-0000-0000000000b1') = 1, 'teacher still sees that student''s name');
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok(tests.throws($$select get_student_lesson('40000000-0000-0000-0000-000000000001')$$), 'student who left can no longer open the class''s lessons');
commit;

\echo 'ALL CLASSROOM ROSTER TESTS PASSED'
