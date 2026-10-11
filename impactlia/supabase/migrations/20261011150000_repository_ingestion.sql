-- Phase 8: analysing a whole public repository, without a pull request.
--
-- Lifecycle. A repository row is the one canonical record of a repository in
-- an organization. Each attempt to analyse it is a repository_runs row that
-- starts as 'running', moves through the stages below and ends as 'completed'
-- or 'failed'. A finished run never changes again: a retry or a re-analysis is
-- a new run. The repository's current graph is the one row in
-- repository_graphs, replaced only when a run completes, so a run that fails
-- leaves the previous graph exactly as it was.
--
-- Writes. Every write is made with the signed-in member's token and is decided
-- by the policies here, the same way reads are.

create type public.repository_run_status as enum ('running', 'completed', 'failed');

-- In the order a run passes through them. While a run is running, `stage` is
-- the work in progress; on a failed run it is the stage that failed.
create type public.repository_run_stage as enum (
  'validating',
  'fetching',
  'preparing',
  'parsing',
  'calculating',
  'saving',
  'complete'
);

create table public.repository_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  -- Null only on a run that failed before the repository could be identified.
  repository_id uuid,
  -- What was submitted, kept so a failed submission can be shown and retried.
  requested_url text not null check (char_length(requested_url) between 1 and 300),
  status public.repository_run_status not null default 'running',
  stage public.repository_run_stage not null default 'validating',
  last_completed_stage public.repository_run_stage,
  -- The commit the archive was built from, as stated by the archive itself.
  -- Null when the archive did not state one; it is never filled in otherwise.
  source_sha text check (source_sha ~ '^[0-9a-f]{40}$'),
  -- Written for the person who started the run. Never an internal error.
  failure_reason text check (char_length(failure_reason) <= 500),
  -- Summary of the stored graph. Present only once the run has completed.
  file_count integer check (file_count >= 0),
  edge_count integer check (edge_count >= 0),
  unresolved_count integer check (unresolved_count >= 0),
  created_at timestamptz not null default now(),
  -- When the run last recorded progress. A running run whose progress is older
  -- than the application's threshold is shown as stale.
  progressed_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, organization_id),
  -- The relationships are named because queries pick them by name.
  constraint repository_runs_repository_fkey
    foreign key (repository_id, organization_id)
    references public.repositories (id, organization_id) on delete cascade,
  constraint repository_runs_finished_matches_status
    check ((status in ('completed', 'failed')) = (completed_at is not null)),
  constraint repository_runs_failure_reason_matches_status
    check ((status = 'failed') = (failure_reason is not null)),
  constraint repository_runs_complete_stage_matches_status
    check ((status = 'completed') = (stage = 'complete')),
  constraint repository_runs_summary_only_when_completed
    check (
      case
        when status = 'completed'
          then repository_id is not null
            and file_count is not null
            and edge_count is not null
            and unresolved_count is not null
        else file_count is null and edge_count is null and unresolved_count is null
      end
    ),
  constraint repository_runs_running_has_repository
    check (status <> 'running' or repository_id is not null)
);

create index repository_runs_organization_created_idx
  on public.repository_runs (organization_id, created_at desc);
create index repository_runs_repository_created_idx
  on public.repository_runs (repository_id, organization_id, created_at desc);

-- At most one run of a repository at a time. Two submissions arriving together
-- cannot both start, and a retry cannot overlap the run it replaces.
create unique index repository_runs_one_running_per_repository
  on public.repository_runs (repository_id)
  where status = 'running';

-- The repository's current graph: the parser's output document, exactly as the
-- parser contract defines it, from the run named here.
create table public.repository_graphs (
  repository_id uuid primary key,
  organization_id text not null,
  run_id uuid not null,
  parser_output jsonb not null,
  constraint repository_graphs_repository_fkey
    foreign key (repository_id, organization_id)
    references public.repositories (id, organization_id) on delete cascade,
  constraint repository_graphs_run_fkey
    foreign key (run_id, organization_id)
    references public.repository_runs (id, organization_id) on delete cascade
);

create index repository_graphs_run_owner_idx
  on public.repository_graphs (run_id, organization_id);

-- Keeps finished runs finished and stamps progress with the database's clock,
-- so staleness never depends on an application server's clock.
create function public.repository_runs_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'running' then
    raise exception 'Repository run % has finished and cannot change.', old.id
      using errcode = 'check_violation';
  end if;
  if new.organization_id <> old.organization_id
    or new.repository_id is distinct from old.repository_id then
    raise exception 'A repository run cannot move to another owner or repository.'
      using errcode = 'check_violation';
  end if;
  new.progressed_at := now();
  if new.status <> 'running' then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

create trigger repository_runs_before_update
  before update on public.repository_runs
  for each row execute function public.repository_runs_before_update();

-- Completing a run and replacing the repository's graph happen together or
-- not at all. Runs with the caller's rights, so the policies below decide
-- whether it may. The summary counts are read from the document being stored
-- rather than passed in, so they cannot disagree with it.
create function public.complete_repository_run(
  run_id uuid,
  parser_output jsonb,
  -- Omitted when the archive did not state its commit.
  source_sha text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  finished public.repository_runs;
begin
  update public.repository_runs as run
  set status = 'completed',
      stage = 'complete',
      last_completed_stage = 'saving',
      source_sha = complete_repository_run.source_sha,
      file_count = jsonb_array_length(complete_repository_run.parser_output -> 'files'),
      edge_count = jsonb_array_length(complete_repository_run.parser_output -> 'edges'),
      unresolved_count =
        (complete_repository_run.parser_output #>> '{coverage,references,unresolved}')::integer
  where run.id = complete_repository_run.run_id
    and run.status = 'running'
  returning run.* into finished;

  if not found then
    raise exception 'Repository run % is not running.', complete_repository_run.run_id
      using errcode = 'check_violation';
  end if;

  insert into public.repository_graphs (repository_id, organization_id, run_id, parser_output)
  values (
    finished.repository_id,
    finished.organization_id,
    finished.id,
    complete_repository_run.parser_output
  )
  on conflict (repository_id) do update
    set run_id = excluded.run_id,
        parser_output = excluded.parser_output;
end;
$$;

revoke execute on function public.complete_repository_run(uuid, jsonb, text) from public, anon;
grant execute on function public.complete_repository_run(uuid, jsonb, text) to authenticated;

-- Row-level security and grants.
alter table public.repository_runs enable row level security;
alter table public.repository_graphs enable row level security;

revoke all on public.repository_runs, public.repository_graphs from anon, authenticated;

grant select, insert, update on public.repository_runs, public.repository_graphs to authenticated;
-- This phase is the first writer of these two. An organization's row is
-- created the first time one of its members submits a repository.
grant insert on public.organizations to authenticated;
grant insert, update on public.repositories to authenticated;

create policy "Members register their own organization"
  on public.organizations for insert to authenticated
  with check (id = (select public.requesting_organization_id()));

create policy "Members add repositories to their organization"
  on public.repositories for insert to authenticated
  with check (organization_id = (select public.requesting_organization_id()));

create policy "Members update their organization's repositories"
  on public.repositories for update to authenticated
  using (organization_id = (select public.requesting_organization_id()))
  with check (organization_id = (select public.requesting_organization_id()));

create policy "Members read their organization's repository runs"
  on public.repository_runs for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

create policy "Members start repository runs in their organization"
  on public.repository_runs for insert to authenticated
  with check (organization_id = (select public.requesting_organization_id()));

create policy "Members update their organization's repository runs"
  on public.repository_runs for update to authenticated
  using (organization_id = (select public.requesting_organization_id()))
  with check (organization_id = (select public.requesting_organization_id()));

create policy "Members read their organization's repository graphs"
  on public.repository_graphs for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

create policy "Members store their organization's repository graphs"
  on public.repository_graphs for insert to authenticated
  with check (organization_id = (select public.requesting_organization_id()));

create policy "Members replace their organization's repository graphs"
  on public.repository_graphs for update to authenticated
  using (organization_id = (select public.requesting_organization_id()))
  with check (organization_id = (select public.requesting_organization_id()));

-- Live progress.
--
-- Each run has its own private Realtime Broadcast topic, "repository-run:<id>".
-- Broadcast needs no publication: the trigger below sends the message, and
-- sends only what the progress page shows, never the row.
--
-- Runs as its owner because members have no right to write to
-- realtime.messages themselves.
create function public.repository_runs_broadcast_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'status', new.status,
      'stage', new.stage,
      'lastCompletedStage', new.last_completed_stage,
      'failureReason', new.failure_reason,
      'progressedAt', new.progressed_at
    ),
    'progress',
    'repository-run:' || new.id::text,
    true
  );
  return null;
end;
$$;

revoke execute on function public.repository_runs_broadcast_progress() from public, anon, authenticated;

create trigger repository_runs_broadcast_progress
  after insert or update on public.repository_runs
  for each row execute function public.repository_runs_broadcast_progress();

-- Who may join a run's topic. The run is looked up through its own policy as
-- well as compared here, so a member of another organization finds no run and
-- is refused the subscription.
create policy "Members receive their organization's run progress"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1
      from public.repository_runs as run
      where 'repository-run:' || run.id::text = (select realtime.topic())
        and run.organization_id = (select public.requesting_organization_id())
    )
  );
