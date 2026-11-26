-- AI question drafts: caps, switches, refunds, who can call what.
\set ON_ERROR_STOP on
\set QUIET on

insert into teacher_allowlist (email) values ('gen.teacher@district.org');
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'gen.teacher@district.org', '{}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'gen.kid@district.org', '{}', '{"provider":"google"}');
update ai_settings set gen_teacher_daily_cap = 2 where id;

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000d1');
select tests.ok((ai_gen_claim() ->> 'left_today')::int = 1, 'first run, one left');
select tests.ok((ai_gen_claim() ->> 'left_today')::int = 0, 'second run, none left');
select tests.ok(ai_gen_claim() ->> 'reason' = 'teacher_cap', 'third run hits the daily cap');
select tests.ok(tests.throws($$select ai_gen_refund('00000000-0000-0000-0000-0000000000d1')$$), 'teacher cannot refund themselves');
select tests.ok(tests.throws($$update ai_gen_usage set runs = 0$$), 'teacher cannot reset their usage');
select tests.become('00000000-0000-0000-0000-0000000000d2');
select tests.ok(tests.throws($$select ai_gen_claim()$$), 'students cannot claim');
commit;

set role service_role;
select ai_gen_refund('00000000-0000-0000-0000-0000000000d1');
reset role;
select tests.ok((select runs from ai_gen_usage where teacher_id = '00000000-0000-0000-0000-0000000000d1') = 1, 'refund gives one back');

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000d1');
select tests.ok((ai_gen_claim() ->> 'ok')::boolean, 'refunded run is usable');
commit;

update ai_settings set gen_enabled = false where id;
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000d1');
select tests.ok(ai_gen_claim() ->> 'reason' = 'disabled', 'draft switch off');
commit;
update ai_settings set gen_enabled = true, enabled = false, gen_teacher_daily_cap = 100 where id;
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000d1');
select tests.ok(ai_gen_claim() ->> 'reason' = 'disabled', 'master AI kill switch also stops drafts');
commit;
update ai_settings set enabled = true, gen_global_monthly_cap = 0 where id;
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000d1');
select tests.ok(ai_gen_claim() ->> 'reason' = 'monthly_cap', 'global monthly cap');
commit;
update ai_settings set gen_global_monthly_cap = 1500, gen_teacher_daily_cap = 15 where id;
\echo ALL AI DRAFT TESTS PASSED
