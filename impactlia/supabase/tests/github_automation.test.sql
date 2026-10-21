-- Checks for 20261021120000_github_pull_request_automation.sql. Run with
-- `pnpm check:database`. Members act through the `authenticated` role with
-- one organization's token; webhooks and jobs act through `service_role`,
-- exactly as the server does.
--
-- A failed assertion stops the script with the message beside it.

\set first 'org_auto_first'
\set second 'org_auto_second'

create schema automation_checks;
grant usage on schema automation_checks to authenticated, service_role;

create function automation_checks.act_as(organization text)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('org_id', organization)::text, false);
$$;

create function automation_checks.error_of(statement text)
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

grant execute on all functions in schema automation_checks to authenticated, service_role;

-- Setup, as the database owner: two organizations, each with a repository,
-- and one installation per organization.
insert into public.organizations (id) values (:'first'), (:'second');
insert into public.github_installations (installation_id, organization_id, account_login)
values (101, :'first', 'first-account'), (202, :'second', 'second-account');
insert into public.repositories
  (organization_id, provider, provider_repository_id, owner, name, default_branch)
values
  (:'first', 'github', '5001', 'first-account', 'shop', 'main'),
  (:'first', 'github', '5002', 'first-account', 'docs', 'main'),
  (:'second', 'github', '6001', 'second-account', 'api', 'main');

-- ── Members ────────────────────────────────────────────────────────────────
set role authenticated;
select automation_checks.act_as(:'first');

do $$
declare
  outcome text;
begin
  assert (select count(*) from public.github_installations) = 1,
    'a member saw installations of another organization';

  -- Linking an installation is the server's job, after GitHub confirmed it.
  outcome := automation_checks.error_of($q$
    insert into public.github_installations (installation_id, organization_id, account_login)
    values (303, 'org_auto_first', 'someone')$q$);
  assert outcome = '42501', format('a member linked an installation directly (%s)', outcome);

  outcome := automation_checks.error_of($q$select count(*) from public.github_webhook_deliveries$q$);
  assert outcome = '42501', format('a member could read webhook deliveries (%s)', outcome);

  outcome := automation_checks.error_of($q$
    select * from public.queue_automatic_analysis(gen_random_uuid(), 'pull_request', 101, '5001', 1,
      repeat('a', 40), false)$q$);
  assert outcome = '42501', format('a member could queue an analysis directly (%s)', outcome);

  outcome := automation_checks.error_of($q$
    insert into public.automatic_analyses
      (organization_id, repository_id, installation_id, pull_request_number, head_sha)
    select 'org_auto_first', id, 101, 1, repeat('a', 40) from public.repositories limit 1$q$);
  assert outcome = '42501', format('a member wrote a job directly (%s)', outcome);

  -- Turning automatic analysis on is the member's own setting...
  update public.repositories
  set automatic_analysis = true, github_installation_id = 101
  where provider_repository_id = '5001';
  assert (select automatic_analysis from public.repositories where provider_repository_id = '5001'),
    'a member could not turn automatic analysis on';

  -- ...but only with an installation of the member's own organization.
  outcome := automation_checks.error_of($q$
    update public.repositories set github_installation_id = 202
    where provider_repository_id = '5002'$q$);
  assert outcome = '23503', format('a repository was linked to another organization''s installation (%s)', outcome);

  outcome := automation_checks.error_of($q$
    update public.repositories set automatic_analysis = true
    where provider_repository_id = '5002'$q$);
  assert outcome = '23514', format('automatic analysis was turned on with no installation (%s)', outcome);
end;
$$;

reset role;

-- A linked repository with automatic analysis off.
update public.repositories set github_installation_id = 101 where provider_repository_id = '5002';

-- ── Webhooks, as the server ────────────────────────────────────────────────
set role service_role;

do $$
declare
  first_delivery uuid := gen_random_uuid();
  result record;
  first_job uuid;
  newer_job uuid;
begin
  select * into result from public.queue_automatic_analysis(
    first_delivery, 'pull_request', 101, '5001', 7, repeat('a', 40), false);
  assert result.outcome = 'queued' and result.job_id is not null,
    format('an enabled repository''s pull request was not queued (%s)', result.outcome);
  first_job := result.job_id;

  -- The same delivery again changes nothing.
  select * into result from public.queue_automatic_analysis(
    first_delivery, 'pull_request', 101, '5001', 7, repeat('a', 40), false);
  assert result.outcome = 'duplicate', format('a redelivery was not recognised (%s)', result.outcome);
  assert (select count(*) from public.automatic_analyses where repository_id =
    (select id from public.repositories where provider_repository_id = '5001')) = 1,
    'a redelivery created a second job';

  -- Another delivery for the same commit does not start a second job.
  select * into result from public.queue_automatic_analysis(
    gen_random_uuid(), 'pull_request', 101, '5001', 7, repeat('a', 40), false);
  assert result.outcome = 'already-queued', format('a second job was queued for one commit (%s)', result.outcome);

  -- A newer commit queues its own job and retires the waiting one.
  select * into result from public.queue_automatic_analysis(
    gen_random_uuid(), 'pull_request', 101, '5001', 7, repeat('b', 40), false);
  assert result.outcome = 'queued', format('a newer commit was not queued (%s)', result.outcome);
  newer_job := result.job_id;
  assert (select status = 'stale' from public.automatic_analyses where id = first_job),
    'the older commit''s waiting job was not marked stale';

  -- The wrong installation, an unknown repository, a disabled one, a private one.
  select * into result from public.queue_automatic_analysis(
    gen_random_uuid(), 'pull_request', 202, '5001', 7, repeat('c', 40), false);
  assert result.outcome = 'not-connected', 'an event from another installation was accepted';
  select * into result from public.queue_automatic_analysis(
    gen_random_uuid(), 'pull_request', 101, '9999', 1, repeat('c', 40), false);
  assert result.outcome = 'not-connected', 'an event for an unknown repository was accepted';

  select * into result from public.queue_automatic_analysis(
    gen_random_uuid(), 'pull_request', 101, '5002', 3, repeat('d', 40), false);
  assert result.outcome = 'skipped' and result.job_id is null, 'a disabled repository was queued';
  assert (select message like '%turned off%' from public.automatic_analyses
          where pull_request_number = 3), 'a skipped job does not say why';

  select * into result from public.queue_automatic_analysis(
    gen_random_uuid(), 'pull_request', 101, '5001', 8, repeat('e', 40), true);
  assert result.outcome = 'skipped', 'a private repository was queued';

  -- Claiming: once, and one job per repository at a time.
  assert (select count(*) from public.claim_automatic_analysis(newer_job)) = 1, 'a due job could not be claimed';
  assert (select count(*) from public.claim_automatic_analysis(newer_job)) = 0, 'a job was claimed twice';
  select * into result from public.queue_automatic_analysis(
    gen_random_uuid(), 'pull_request', 101, '5001', 9, repeat('f', 40), false);
  assert (select count(*) from public.claim_automatic_analysis(result.job_id)) = 0,
    'two jobs of one repository ran at once';

  -- An attempt that went silent past the window can be claimed again.
  update public.automatic_analyses set locked_at = now() - interval '11 minutes' where id = newer_job;
  assert (select attempts = 2 from public.claim_automatic_analysis(newer_job)),
    'an abandoned attempt could not be recovered';

  -- Closing skips what is still waiting.
  perform public.close_automatic_analyses(gen_random_uuid(), 101, '5001', 9);
  assert (select status = 'skipped' from public.automatic_analyses where id = result.job_id),
    'a closed pull request''s waiting job was not skipped';

  -- Removing the installation is recorded, and a redelivery of that is not.
  assert public.record_github_installation_event(first_delivery, 101, 'deleted') = 'duplicate',
    'an installation event reused a delivery id';
  assert public.record_github_installation_event(gen_random_uuid(), 101, 'deleted') = 'recorded',
    'an installation removal was not recorded';
  assert (select removed_at is not null from public.github_installations where installation_id = 101),
    'the removal was not stored';
  select * into result from public.queue_automatic_analysis(
    gen_random_uuid(), 'pull_request', 101, '5001', 10, repeat('1', 40), false);
  assert result.outcome = 'skipped', 'a removed installation still queued analyses';
end;
$$;

reset role;

-- ── The other organization sees none of it ─────────────────────────────────
set role authenticated;
select automation_checks.act_as(:'second');

do $$
begin
  assert (select count(*) from public.automatic_analyses) = 0,
    'a member saw another organization''s automatic analyses';
  assert (select count(*) from public.github_installations) = 1,
    'a member saw another organization''s installation';
end;
$$;

select automation_checks.act_as(:'first');

do $$
begin
  assert (select count(*) from public.automatic_analyses) > 0,
    'a member could not see their own organization''s automatic analyses';
end;
$$;

reset role;
