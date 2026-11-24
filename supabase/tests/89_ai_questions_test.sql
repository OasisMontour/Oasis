-- AI question generation: teachers only, kill switches, daily/monthly caps, service-role-only refunds,
-- provider budgets charged in units, admin counts.
\set ON_ERROR_STOP on
\set QUIET on

grant usage on schema public to service_role;  -- Supabase grants this; the shim doesn't
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

insert into teacher_allowlist (email) values ('gen.teacher@district.org');
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-000000009a01', 'gen.teacher@district.org', '{}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-000000009a02', 'gen.kid@district.org', '{}', '{"provider":"google"}');

-- ---------- students and signed-out callers
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-000000009a02');
select tests.ok(tests.throws($$select ai_claim_generation()$$), 'student cannot claim a generation run');
select tests.ok(tests.throws($$select ai_refund_generation('00000000-0000-0000-0000-000000009a02')$$), 'student cannot refund runs');
select tests.ok(tests.throws($$select * from ai_generation_usage$$), 'student cannot read generation usage');
commit;
begin;
set local role anon;
select tests.ok(tests.throws($$select ai_claim_generation()$$), 'signed out cannot claim a generation run');
commit;

-- ---------- teacher: claim, count, caps
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-000000009a01');
select ai_claim_generation() as c1 \gset
select tests.ok((:'c1'::jsonb ->> 'ok')::boolean and (:'c1'::jsonb ->> 'left_today')::int = 19, 'first run of the day is allowed, 19 left');
select tests.ok(tests.throws($$select ai_refund_generation('00000000-0000-0000-0000-000000009a01')$$), 'teacher cannot refund their own runs');
select tests.ok(tests.throws($$select * from ai_generation_usage$$) and tests.throws($$update ai_settings set teacher_daily_generations = 1000$$),
  'generation bookkeeping is closed to the API');
select tests.ok(tests.throws($$select ai_provider_take('groq', 1000000, 1)$$), 'teacher cannot touch provider budgets');
commit;
select tests.ok((select runs from ai_generation_usage where teacher_id = '00000000-0000-0000-0000-000000009a01') = 1, 'run is charged');

update ai_settings set teacher_daily_generations = 2;
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-000000009a01');
select ai_claim_generation() as c2 \gset
select ai_claim_generation() as c3 \gset
commit;
select tests.ok((:'c2'::jsonb ->> 'ok')::boolean and (:'c2'::jsonb ->> 'left_today')::int = 0, 'second run allowed, none left');
select tests.ok(:'c3'::jsonb ->> 'reason' = 'teacher_cap', 'third run hits the teacher daily cap');
select tests.ok((select runs from ai_generation_usage where teacher_id = '00000000-0000-0000-0000-000000009a01') = 2, 'refused run is not charged');

-- ---------- service role refund
begin;
set local role service_role;
select ai_refund_generation('00000000-0000-0000-0000-000000009a01');
select ai_refund_generation('00000000-0000-0000-0000-000000009a01');
select ai_refund_generation('00000000-0000-0000-0000-000000009a01');
commit;
select tests.ok((select runs from ai_generation_usage where teacher_id = '00000000-0000-0000-0000-000000009a01') = 0, 'refunds never go below zero');

update ai_settings set teacher_daily_generations = 20, global_monthly_generations = 0;
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-000000009a01');
select ai_claim_generation() as c4 \gset
commit;
select tests.ok(:'c4'::jsonb ->> 'reason' = 'monthly_cap', 'global monthly cap');

update ai_settings set global_monthly_generations = 2000, questions_enabled = false;
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-000000009a01');
select ai_claim_generation() as c5 \gset
commit;
select tests.ok(:'c5'::jsonb ->> 'reason' = 'questions_off', 'questions_enabled = false stops generation');

update ai_settings set questions_enabled = true, enabled = false;
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-000000009a01');
select ai_claim_generation() as c6 \gset
commit;
select tests.ok(:'c6'::jsonb ->> 'reason' = 'disabled', 'the main AI kill switch stops generation too');
update ai_settings set enabled = true;

-- ---------- provider budgets in units
begin;
set local role service_role;
select tests.ok(ai_provider_take('genprov', 100, 40) and ai_provider_take('genprov', 100, 40), 'two 40-unit calls fit in 100');
select tests.ok(not ai_provider_take('genprov', 100, 40), 'a third would go over the cap');
select tests.ok(ai_provider_take('genprov', 100), 'a grade (default 1 unit) still fits in what is left');
select tests.ok(not ai_provider_take('genprov2', 30, 40), 'one call bigger than the whole cap is refused');
select tests.ok(ai_provider_take('genprov3', 5, 0), 'units below 1 still take');
commit;
select tests.ok((select calls from ai_provider_usage where provider = 'genprov') = 81, 'units are what gets counted');
select tests.ok(not exists (select 1 from ai_provider_usage where provider = 'genprov2'), 'refused call is not recorded');
select tests.ok((select calls from ai_provider_usage where provider = 'genprov3') = 1, 'units below 1 count as 1');

-- ---------- admin view
insert into admins (email) values ('gen.teacher@district.org');
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-000000009a01');
select admin_ai_usage() as u \gset
commit;
select tests.ok((:'u'::jsonb ->> 'questions_enabled')::boolean and (:'u'::jsonb ->> 'teacher_daily_generations')::int = 20
  and (:'u'::jsonb ? 'today_generations') and (:'u'::jsonb ? 'month_generations') and (:'u'::jsonb ? 'today_answers'),
  'admin sees generation settings and counts next to grading');
delete from admins where email = 'gen.teacher@district.org';

\echo 'ALL AI QUESTION TESTS PASSED'
