-- Automatic pull request analysis through the Impactlia GitHub App.
--
-- An organization connects an installation of the App, turns automatic
-- analysis on for a repository it has added, and from then on GitHub's
-- pull_request webhooks queue one job per pull request per head commit. A
-- job runs the same analysis a member starts by hand and publishes one
-- Impactlia comment on the pull request.
--
-- Writers. Webhooks and the retry sweep have no signed-in member, so jobs,
-- deliveries and installations are written only by the server's service role,
-- through the functions below or with the organization taken from the
-- installation row. Members read their own organization's rows and nothing
-- else, by policy. The one thing a member writes is the repository's own
-- opt-in, and the composite foreign key keeps that to an installation of the
-- member's own organization.
--
-- Stored from GitHub: ids, the installation's account login, commit SHAs and
-- pull request numbers. No payload, token or source code is kept.

-- An installation of the App, linked to the organization of the member who
-- installed it once GitHub confirmed that member can see it.
create table public.github_installations (
  installation_id bigint primary key check (installation_id > 0),
  organization_id text not null references public.organizations (id) on delete cascade,
  account_login text not null check (char_length(account_login) between 1 and 100),
  -- Set by GitHub's installation events. A removed installation stays as a
  -- record so the repositories that used it can say why they stopped.
  suspended_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (installation_id, organization_id)
);

alter table public.github_installations enable row level security;
revoke all on public.github_installations from anon, authenticated;
grant select on public.github_installations to authenticated;
grant select, insert, update on public.github_installations to service_role;

create policy "Members read their organization's GitHub installations"
  on public.github_installations for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

alter table public.repositories
  add column automatic_analysis boolean not null default false,
  add column github_installation_id bigint,
  -- An installation of the same organization, or none.
  add constraint repositories_installation_same_organization
    foreign key (github_installation_id, organization_id)
    references public.github_installations (installation_id, organization_id),
  add constraint repositories_automatic_needs_installation
    check (not automatic_analysis or github_installation_id is not null);

create index repositories_installation_idx
  on public.repositories (github_installation_id, provider_repository_id)
  where github_installation_id is not null;

-- Every webhook delivery that was acted on, by GitHub's own delivery id.
-- Recorded in the same transaction as what it caused, so a redelivery is
-- recognised and changes nothing.
create table public.github_webhook_deliveries (
  delivery_id uuid primary key,
  event text not null check (char_length(event) <= 100),
  received_at timestamptz not null default now()
);

alter table public.github_webhook_deliveries enable row level security;
revoke all on public.github_webhook_deliveries from anon, authenticated;
grant select, insert on public.github_webhook_deliveries to service_role;

-- 'queued': waiting for its first or next attempt. 'running': claimed by one
-- process. 'completed': the analysis finished and its comment was handled.
-- 'failed': it could not finish, for the reason in `message`. 'stale': the
-- pull request moved to a newer commit, so this one's result is not current.
-- 'skipped': not analysed, because of a setting or the pull request closing.
create type public.automatic_analysis_status as enum (
  'queued', 'running', 'completed', 'failed', 'stale', 'skipped'
);

-- One job per pull request per head commit. A new commit is a new job; a
-- new event for a commit that already has one queues that job again.
create table public.automatic_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  repository_id uuid not null,
  installation_id bigint not null,
  pull_request_number integer not null check (pull_request_number > 0),
  head_sha text not null check (head_sha ~ '^[0-9a-f]{40}$'),
  status public.automatic_analysis_status not null default 'queued',
  -- Attempts started, including one that stopped without finishing.
  attempts smallint not null default 0 check (attempts between 0 and 100),
  next_attempt_at timestamptz not null default now(),
  -- When the running attempt claimed the job. An attempt silent for longer
  -- than the claim window is treated as abandoned and can be claimed again.
  locked_at timestamptz,
  -- The analysis the latest attempt ran or reused.
  analysis_id uuid,
  -- What happened, written for the member. Never a secret or a stack trace.
  message text check (char_length(message) <= 500),
  -- The Impactlia comment on the pull request, once one was published.
  comment_id bigint check (comment_id > 0),
  comment_published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automatic_analyses_one_per_revision
    unique (repository_id, pull_request_number, head_sha),
  foreign key (repository_id, organization_id)
    references public.repositories (id, organization_id) on delete cascade,
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id),
  constraint automatic_analyses_lock_matches_status
    check ((status = 'running') = (locked_at is not null))
);

create index automatic_analyses_organization_created_idx
  on public.automatic_analyses (organization_id, created_at desc);
create index automatic_analyses_repository_created_idx
  on public.automatic_analyses (repository_id, created_at desc);
create index automatic_analyses_due_idx
  on public.automatic_analyses (next_attempt_at)
  where status in ('queued', 'running');
create index automatic_analyses_analysis_idx
  on public.automatic_analyses (analysis_id, organization_id)
  where analysis_id is not null;

create function public.automatic_analyses_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id <> old.organization_id
    or new.repository_id <> old.repository_id
    or new.pull_request_number <> old.pull_request_number
    or new.head_sha <> old.head_sha then
    raise exception 'An automatic analysis cannot move to another pull request or commit.'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger automatic_analyses_before_update
  before update on public.automatic_analyses
  for each row execute function public.automatic_analyses_before_update();

alter table public.automatic_analyses enable row level security;
revoke all on public.automatic_analyses from anon, authenticated;
grant select on public.automatic_analyses to authenticated;
grant select, insert, update on public.automatic_analyses to service_role;

create policy "Members read their organization's automatic analyses"
  on public.automatic_analyses for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

-- The service role runs the analysis itself on a job's behalf, so it writes
-- the same tables a member's analysis does.
grant select, insert, update on public.pull_requests, public.analyses to service_role;
grant select, insert on
  public.analysis_files,
  public.analysis_dependencies,
  public.analysis_risk_signals,
  public.analysis_recommendations,
  public.analysis_evidence,
  public.analysis_code_issues,
  public.analysis_test_recommendations
to service_role;
grant select on public.repositories, public.organizations to service_role;
grant execute on function public.complete_analysis(uuid, jsonb) to service_role;

-- How long a claimed attempt may stay silent before it is treated as
-- abandoned. Longer than an analysis's own limit, so a live one is never
-- claimed twice.
create function public.automatic_analysis_claim_window()
returns interval
language sql
immutable
as $$ select interval '10 minutes' $$;

-- ── Webhook entry points ───────────────────────────────────────────────────
-- Each records the delivery first. A delivery seen before returns
-- 'duplicate' and changes nothing else.

-- pull_request opened, synchronize or reopened. Returns what happened and the
-- job to run now, if any.
create function public.queue_automatic_analysis(
  delivery uuid,
  event text,
  installation bigint,
  provider_repository_id text,
  pull_request_number integer,
  head_sha text,
  is_private boolean
)
returns table (outcome text, job_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  repository public.repositories;
  connected public.github_installations;
  reason text;
  job uuid;
begin
  insert into public.github_webhook_deliveries (delivery_id, event)
  values (queue_automatic_analysis.delivery, queue_automatic_analysis.event)
  on conflict do nothing;
  if not found then
    return query select 'duplicate'::text, null::uuid;
    return;
  end if;

  -- Only a repository an organization added and linked to this very
  -- installation. Anything else is not Impactlia's to analyse.
  select r.* into repository
  from public.repositories as r
  where r.github_installation_id = queue_automatic_analysis.installation
    and r.provider = 'github'
    and r.provider_repository_id = queue_automatic_analysis.provider_repository_id
    and not r.is_seed;
  if not found then
    return query select 'not-connected'::text, null::uuid;
    return;
  end if;

  select i.* into connected
  from public.github_installations as i
  where i.installation_id = queue_automatic_analysis.installation;

  reason := case
    when connected.removed_at is not null
      then 'The Impactlia GitHub App was removed from this account, so nothing was analysed.'
    when connected.suspended_at is not null
      then 'The Impactlia GitHub App is suspended on this account, so nothing was analysed.'
    when not repository.automatic_analysis
      then 'Automatic analysis is turned off for this repository.'
    when queue_automatic_analysis.is_private
      then 'The repository is private. Only public repositories are analysed.'
  end;

  if reason is not null then
    insert into public.automatic_analyses as existing (
      organization_id, repository_id, installation_id, pull_request_number, head_sha,
      status, message
    )
    values (
      repository.organization_id, repository.id, queue_automatic_analysis.installation,
      queue_automatic_analysis.pull_request_number, queue_automatic_analysis.head_sha,
      'skipped', reason
    )
    on conflict on constraint automatic_analyses_one_per_revision do update
      set message = excluded.message
      where existing.status = 'skipped';
    return query select 'skipped'::text, null::uuid;
    return;
  end if;

  -- An older commit of the same pull request still waiting is not worth
  -- analysing any more. One already running finds out before it publishes.
  update public.automatic_analyses as older
  set status = 'stale',
      message = 'A newer commit was pushed before this one was analysed.'
  where older.repository_id = repository.id
    and older.pull_request_number = queue_automatic_analysis.pull_request_number
    and older.head_sha <> queue_automatic_analysis.head_sha
    and older.status = 'queued';

  insert into public.automatic_analyses as existing (
    organization_id, repository_id, installation_id, pull_request_number, head_sha
  )
  values (
    repository.organization_id, repository.id, queue_automatic_analysis.installation,
    queue_automatic_analysis.pull_request_number, queue_automatic_analysis.head_sha
  )
  on conflict on constraint automatic_analyses_one_per_revision do update
    -- A new event for a commit whose job has finished queues it again: a
    -- reopened pull request, or a push back to an earlier commit. The
    -- stored analysis of that commit is reused, so only the comment is redone.
    set status = 'queued',
        attempts = 0,
        next_attempt_at = now(),
        installation_id = excluded.installation_id,
        message = null
    where existing.status in ('completed', 'failed', 'stale', 'skipped')
  returning existing.id into job;

  if job is null then
    -- Already queued or running for this commit.
    return query select 'already-queued'::text, null::uuid;
    return;
  end if;
  return query select 'queued'::text, job;
end;
$$;

-- pull_request closed. Waiting jobs of that pull request are skipped; one
-- already running checks the state before it publishes.
create function public.close_automatic_analyses(
  delivery uuid,
  installation bigint,
  provider_repository_id text,
  pull_request_number integer
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.github_webhook_deliveries (delivery_id, event)
  values (close_automatic_analyses.delivery, 'pull_request')
  on conflict do nothing;
  if not found then
    return 'duplicate';
  end if;

  update public.automatic_analyses as job
  set status = 'skipped',
      message = 'The pull request was closed before it was analysed.'
  from public.repositories as repository
  where repository.id = job.repository_id
    and repository.github_installation_id = close_automatic_analyses.installation
    and repository.provider_repository_id = close_automatic_analyses.provider_repository_id
    and job.pull_request_number = close_automatic_analyses.pull_request_number
    and job.status = 'queued';
  return 'closed';
end;
$$;

-- installation deleted, suspend or unsuspend.
create function public.record_github_installation_event(
  delivery uuid,
  installation bigint,
  action text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if record_github_installation_event.action not in ('deleted', 'suspend', 'unsuspend') then
    raise exception 'Unknown installation action %.', record_github_installation_event.action
      using errcode = 'check_violation';
  end if;

  insert into public.github_webhook_deliveries (delivery_id, event)
  values (record_github_installation_event.delivery, 'installation')
  on conflict do nothing;
  if not found then
    return 'duplicate';
  end if;

  update public.github_installations as i
  set removed_at = case when record_github_installation_event.action = 'deleted' then now() else i.removed_at end,
      suspended_at = case record_github_installation_event.action
        when 'suspend' then now()
        when 'unsuspend' then null
        else i.suspended_at
      end
  where i.installation_id = record_github_installation_event.installation;

  if record_github_installation_event.action in ('deleted', 'suspend') then
    update public.automatic_analyses as job
    set status = 'skipped',
        message = case record_github_installation_event.action
          when 'deleted' then 'The Impactlia GitHub App was removed before this was analysed.'
          else 'The Impactlia GitHub App was suspended before this was analysed.'
        end
    where job.installation_id = record_github_installation_event.installation
      and job.status = 'queued';
  end if;
  return 'recorded';
end;
$$;

-- ── Running jobs ───────────────────────────────────────────────────────────

-- Claims a job for one attempt: one that is due, or one whose attempt went
-- silent past the claim window. At most one job per repository runs at a
-- time, which keeps one busy repository from using up every GitHub request
-- and every server slot. Returns nothing when the job is not claimable now.
create function public.claim_automatic_analysis(job uuid)
returns setof public.automatic_analyses
language plpgsql
security invoker
set search_path = ''
as $$
declare
  repository uuid;
begin
  select a.repository_id into repository
  from public.automatic_analyses as a
  where a.id = claim_automatic_analysis.job;
  if not found then
    return;
  end if;

  -- Two claims for jobs of the same repository wait for each other here, so
  -- the check below sees the other's claim.
  perform pg_advisory_xact_lock(hashtextextended(repository::text, 0));

  return query
  update public.automatic_analyses as a
  set status = 'running',
      locked_at = now(),
      attempts = a.attempts + 1
  where a.id = claim_automatic_analysis.job
    and (
      (a.status = 'queued' and a.next_attempt_at <= now())
      or (a.status = 'running' and a.locked_at < now() - public.automatic_analysis_claim_window())
    )
    and not exists (
      select 1 from public.automatic_analyses as other
      where other.repository_id = a.repository_id
        and other.id <> a.id
        and other.status = 'running'
        and other.locked_at >= now() - public.automatic_analysis_claim_window()
    )
  returning a.*;
end;
$$;

-- Every function here is for the server's service role alone.
revoke execute on function
  public.queue_automatic_analysis(uuid, text, bigint, text, integer, text, boolean),
  public.close_automatic_analyses(uuid, bigint, text, integer),
  public.record_github_installation_event(uuid, bigint, text),
  public.claim_automatic_analysis(uuid),
  public.automatic_analysis_claim_window()
from public, anon, authenticated;
grant execute on function
  public.queue_automatic_analysis(uuid, text, bigint, text, integer, text, boolean),
  public.close_automatic_analyses(uuid, bigint, text, integer),
  public.record_github_installation_event(uuid, bigint, text),
  public.claim_automatic_analysis(uuid),
  public.automatic_analysis_claim_window()
to service_role;
