-- Checks for 20261022090000_members.sql. Run with `pnpm check:database`.
-- Every statement after the setup runs as `authenticated` with one person's
-- token, exactly as the start page's request does.
--
-- A failed assertion stops the script with the message beside it.

create schema member_checks;
grant usage on schema member_checks to authenticated, anon;

create function member_checks.act_as(user_id text, organization text)
returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id, 'org_id', organization)::text,
    false
  );
$$;

create function member_checks.error_of(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate;
end;
$$;

grant execute on all functions in schema member_checks to authenticated, anon;

insert into public.organizations (id) values ('org_member_a'), ('org_member_b');

set role authenticated;
select member_checks.act_as('user_alice', 'org_member_a');

do $$
declare
  outcome text;
begin
  -- A verified person records themselves once.
  insert into public.members (user_id, organization_id) values ('user_alice', 'org_member_a');
  assert (select count(*) from public.members) = 1, 'the first visit was not recorded';

  -- Signing in again creates nothing new, and the application's upsert
  -- (insert, ignoring a duplicate) succeeds without a second row.
  insert into public.members (user_id, organization_id) values ('user_alice', 'org_member_a')
  on conflict (user_id) do nothing;
  assert (select count(*) from public.members where user_id = 'user_alice') = 1,
    'a repeated sign-in created a second row';

  -- Nobody can record someone else, or record themselves in another
  -- organization than the one their session is in.
  outcome := member_checks.error_of(
    $q$insert into public.members (user_id, organization_id) values ('user_mallory', 'org_member_a')$q$);
  assert outcome = '42501', format('a row was created for another user (%s)', outcome);
  outcome := member_checks.error_of(
    $q$insert into public.members (user_id, organization_id) values ('user_alice2', 'org_member_b')$q$);
  assert outcome = '42501', format('a row was created in another organization (%s)', outcome);

  -- The row does not change after it is written.
  outcome := member_checks.error_of(
    $q$update public.members set organization_id = 'org_member_b' where user_id = 'user_alice'$q$);
  assert outcome = '42501', format('a member row could be changed (%s)', outcome);
  outcome := member_checks.error_of($q$delete from public.members where user_id = 'user_alice'$q$);
  assert outcome = '42501', format('a member row could be deleted (%s)', outcome);

  -- An id that is not a Clerk user id is refused outright.
  outcome := member_checks.error_of(
    $q$insert into public.members (user_id, organization_id) values ('anonymous', 'org_member_a')$q$);
  assert outcome in ('42501', '23514'), format('a non-Clerk id was accepted (%s)', outcome);
end;
$$;

-- Another person, even in the same organization, sees only their own row.
select member_checks.act_as('user_bob', 'org_member_a');

do $$
begin
  assert (select count(*) from public.members) = 0, 'a person could read someone else''s row';
  insert into public.members (user_id, organization_id) values ('user_bob', 'org_member_a');
  assert (select count(*) from public.members) = 1, 'a person could not read their own row';
end;
$$;

reset role;

-- Without a session there is no access at all.
set role anon;

do $$
begin
  assert member_checks.error_of($q$select count(*) from public.members$q$) = '42501',
    'members could be read without a session';
end;
$$;

reset role;
