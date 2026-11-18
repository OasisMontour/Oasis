-- Catch-all: signed-out users can't execute any function in public, whatever migration added it.
\set ON_ERROR_STOP on
\set QUIET on
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
  'anon can execute no function in public');
select tests.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  'every table in public has RLS on');
\echo 'ALL PRIVILEGE TESTS PASSED'
