\set ON_ERROR_STOP on
\set QUIET on

insert into google_tokens (user_id, refresh_token_enc, scopes)
  values ('00000000-0000-0000-0000-0000000000a1', 'v1.fake.fake', 'classroom');

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select tests.ok(tests.throws($$select * from google_tokens$$), 'teacher cannot read the token table, even their own row');
select tests.ok(tests.throws($$delete from google_tokens$$), 'teacher cannot delete from the token table directly');
select tests.ok((classroom_status() ->> 'connected')::boolean, 'classroom_status says connected');
select tests.ok(classroom_status() ->> 'last_synced_at' is not null, 'classroom_status reports last sync time');
select tests.ok(not (classroom_status()::text like '%v1.fake%'), 'classroom_status never returns the token');
select tests.become('00000000-0000-0000-0000-0000000000a2');
select tests.ok(not (classroom_status() ->> 'connected')::boolean, 'other teacher is not connected');
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok(classroom_status() is null, 'students get nothing from classroom_status');
select tests.ok(tests.throws($$insert into google_tokens values ('00000000-0000-0000-0000-0000000000b1', 'x', 'y')$$), 'students cannot write tokens');
commit;

begin;
set local role anon;
select tests.ok(tests.throws($$select classroom_status()$$), 'signed-out users cannot call classroom_status');
commit;

\echo 'ALL GOOGLE TOKEN TESTS PASSED'
