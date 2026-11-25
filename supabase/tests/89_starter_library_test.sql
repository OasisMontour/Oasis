begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok(not exists(select 1 from public.starter_lessons), 'student cannot read starter keys');
select tests.become('00000000-0000-0000-0000-0000000000a2');
select tests.ok(exists(select 1 from public.starter_lessons), 'teacher sees starter lessons');
rollback;
