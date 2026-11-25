-- Admin AI kill switch (20261129000200). Reuses the AI grading test's teacher (f1).
\set ON_ERROR_STOP on
\set QUIET on

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000f1');
select tests.ok(tests.throws('select admin_set_ai_enabled(false)'), 'non-admin cannot flip the AI switch');
commit;
select tests.ok((select enabled from ai_settings), 'still on');

insert into admins (email) values ('ai.teacher@district.org');
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000f1');
select tests.ok(admin_set_ai_enabled(false) = false, 'admin turns AI grading off');
select tests.ok((admin_ai_usage() ->> 'enabled')::boolean = false, 'admin view shows it off');
select tests.ok(tests.throws('select admin_set_ai_enabled(null)'), 'null is refused');
commit;
select tests.ok(not (select enabled from ai_settings), 'ai_settings.enabled is false');
select tests.ok(exists (select 1 from admin_audit where action = 'ai_off' and actor_email = 'ai.teacher@district.org'), 'flip is audited');
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000f1');
select admin_set_ai_enabled(true);
commit;
select tests.ok((select enabled from ai_settings), 'back on');
delete from admins where email = 'ai.teacher@district.org';

\echo 'ALL ADMIN AI SWITCH TESTS PASSED'
