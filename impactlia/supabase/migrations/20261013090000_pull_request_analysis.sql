-- Phase 12: analysing a real pull request.
--
-- Lifecycle. An analysis is one run of one pull request at one head commit.
-- It is inserted as 'running' once the repository and the pull request have
-- been checked with GitHub, moves through the stages below and ends as
-- 'completed' or 'failed'. A finished analysis never changes again: a retry or
-- a re-analysis is a new row, so earlier results stay exactly as they were.
--
-- Results. Everything a completed analysis found is written by
-- complete_analysis in one transaction with the status change, so a run is
-- never 'completed' with part of its result missing.
--
-- Writes. Every write is made with the signed-in member's token and is decided
-- by the policies here, the same way reads are.

-- In the order an analysis passes through them. While it is running, `stage`
-- is the work in progress; on a failed analysis it is the stage that failed.
create type public.analysis_stage as enum (
  'validating',
  'fetching',
  'preparing',
  'mapping',
  'calculating',
  'scoring',
  'saving',
  'complete'
);

-- Whether a changed file is a node in the graph the analysis was run against.
create type public.analysis_file_state as enum ('analysed', 'unanalysed');

alter table public.analyses
  add column stage public.analysis_stage not null default 'validating',
  add column last_completed_stage public.analysis_stage,
  -- The pull request's base commit when the run started. Null only on rows
  -- written before this column existed.
  add column base_sha text check (base_sha ~ '^[0-9a-f]{40}$'),
  -- The commit the downloaded archive says it was built from. Null when the
  -- archive did not state one; it is never filled in otherwise.
  add column graph_sha text check (graph_sha ~ '^[0-9a-f]{40}$'),
  -- What the analysis could not establish, as a list of
  -- {id, detail, files}. Present only once the run has completed.
  add column limitations jsonb not null default '[]'::jsonb,
  -- When the run last recorded progress. A running analysis whose progress is
  -- older than the application's threshold is shown as stale.
  add column progressed_at timestamptz not null default now(),
  add constraint analyses_failure_reason_length
    check (char_length(failure_reason) <= 500),
  add constraint analyses_limitations_is_list
    check (jsonb_typeof(limitations) = 'array');

-- At most one unfinished analysis of a pull request at one commit. Two
-- submissions arriving together cannot both start, and a retry cannot overlap
-- the run it replaces.
create unique index analyses_one_unfinished_per_revision
  on public.analyses (pull_request_id, head_sha)
  where status in ('pending', 'running');

alter table public.analysis_files
  -- The path a renamed file had before the pull request.
  add column previous_path text,
  -- Whether GitHub returned the file's patch. It does not for binary files or
  -- for patches over its size limit.
  add column patch_available boolean,
  add column analysis_state public.analysis_file_state,
  -- Why a changed file is not, or not fully, covered by the graph.
  add column state_reason text check (char_length(state_reason) <= 300),
  -- One shortest chain of real dependencies from a changed file to this one.
  -- Each neighbouring pair is a row in analysis_dependencies.
  add column dependency_path text[],
  -- How many files one step closer have a dependency to this one.
  add column route_count integer check (route_count >= 1),
  add constraint analysis_files_report_columns_match_kind
    check (
      case kind
        when 'changed'
          then dependency_path is null and route_count is null
        else previous_path is null
          and patch_available is null
          and analysis_state is null
          and state_reason is null
      end
    );

alter table public.analysis_dependencies
  add column type_only boolean not null default false;

alter table public.analysis_recommendations
  -- The computed fact that led to the recommendation.
  add column reason text check (char_length(reason) <= 500);

-- Keeps finished analyses finished and stamps progress with the database's
-- clock, so staleness never depends on an application server's clock.
create function public.analyses_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('completed', 'failed') then
    raise exception 'Analysis % has finished and cannot change.', old.id
      using errcode = 'check_violation';
  end if;
  if new.organization_id <> old.organization_id
    or new.pull_request_id <> old.pull_request_id
    or new.head_sha <> old.head_sha then
    raise exception 'An analysis cannot move to another owner, pull request or commit.'
      using errcode = 'check_violation';
  end if;
  new.progressed_at := now();
  if new.status in ('completed', 'failed') then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

create trigger analyses_before_update
  before update on public.analyses
  for each row execute function public.analyses_before_update();

-- Completing an analysis and storing its result happen together or not at
-- all. Runs with the caller's rights, so the policies below decide whether it
-- may. The two file counts are counted from the document being stored rather
-- than passed in, so they cannot disagree with the rows.
--
-- `report` is the document lib/impact/report.ts describes. Dependencies and
-- evidence name files by path; one that names a path with no file row stops
-- the whole save rather than being dropped.
create function public.complete_analysis(run_id uuid, report jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  finished public.analyses;
  expected integer;
  written integer;
begin
  update public.analyses as run
  set status = 'completed',
      stage = 'complete',
      last_completed_stage = 'saving',
      graph_sha = complete_analysis.report ->> 'graphSha',
      risk_level = (complete_analysis.report ->> 'riskLevel')::public.risk_level,
      limitations = complete_analysis.report -> 'limitations',
      changed_file_count = (
        select count(*) from jsonb_array_elements(complete_analysis.report -> 'files') as entry
        where entry.value ->> 'kind' = 'changed'
      ),
      affected_file_count = (
        select count(*) from jsonb_array_elements(complete_analysis.report -> 'files') as entry
        where entry.value ->> 'kind' = 'affected'
      )
  where run.id = complete_analysis.run_id
    and run.status = 'running'
  returning run.* into finished;

  if not found then
    raise exception 'Analysis % is not running.', complete_analysis.run_id
      using errcode = 'check_violation';
  end if;

  insert into public.analysis_files (
    organization_id, analysis_id, path, kind, change_type, additions, deletions,
    impact_depth, previous_path, patch_available, analysis_state, state_reason,
    dependency_path, route_count
  )
  select
    finished.organization_id,
    finished.id,
    entry.value ->> 'path',
    (entry.value ->> 'kind')::public.analysis_file_kind,
    (entry.value ->> 'changeType')::public.file_change_type,
    (entry.value ->> 'additions')::integer,
    (entry.value ->> 'deletions')::integer,
    (entry.value ->> 'impactDepth')::integer,
    entry.value ->> 'previousPath',
    (entry.value ->> 'patchAvailable')::boolean,
    (entry.value ->> 'analysisState')::public.analysis_file_state,
    entry.value ->> 'stateReason',
    case
      when jsonb_typeof(entry.value -> 'dependencyPath') = 'array'
        then array(select jsonb_array_elements_text(entry.value -> 'dependencyPath'))
    end,
    (entry.value ->> 'routeCount')::integer
  from jsonb_array_elements(complete_analysis.report -> 'files') as entry;

  insert into public.analysis_dependencies (
    organization_id, analysis_id, source_file_id, target_file_id, kind, type_only
  )
  select
    finished.organization_id,
    finished.id,
    source.id,
    target.id,
    entry.value ->> 'kind',
    (entry.value ->> 'typeOnly')::boolean
  from jsonb_array_elements(complete_analysis.report -> 'dependencies') as entry
  join public.analysis_files as source
    on source.analysis_id = finished.id and source.path = entry.value ->> 'source'
  join public.analysis_files as target
    on target.analysis_id = finished.id and target.path = entry.value ->> 'target';
  get diagnostics written = row_count;
  expected := jsonb_array_length(complete_analysis.report -> 'dependencies');
  if written <> expected then
    raise exception 'Analysis %: % of % dependencies name a file that is not in the result.',
      finished.id, expected - written, expected
      using errcode = 'check_violation';
  end if;

  insert into public.analysis_risk_signals (organization_id, analysis_id, signal, level, detail)
  select
    finished.organization_id,
    finished.id,
    entry.value ->> 'signal',
    (entry.value ->> 'level')::public.risk_level,
    entry.value -> 'detail'
  from jsonb_array_elements(complete_analysis.report -> 'signals') as entry;

  insert into public.analysis_evidence (organization_id, analysis_id, risk_signal_id, file_id)
  select finished.organization_id, finished.id, signal.id, file.id
  from jsonb_array_elements(complete_analysis.report -> 'signals') as entry
  cross join lateral jsonb_array_elements_text(entry.value -> 'evidence') as evidence (path)
  join public.analysis_risk_signals as signal
    on signal.analysis_id = finished.id and signal.signal = entry.value ->> 'signal'
  join public.analysis_files as file
    on file.analysis_id = finished.id and file.path = evidence.path;
  get diagnostics written = row_count;
  select coalesce(sum(jsonb_array_length(entry.value -> 'evidence')), 0)
  into expected
  from jsonb_array_elements(complete_analysis.report -> 'signals') as entry;
  if written <> expected then
    raise exception 'Analysis %: % of % pieces of risk evidence name a file that is not in the result.',
      finished.id, expected - written, expected
      using errcode = 'check_violation';
  end if;

  insert into public.analysis_recommendations (
    organization_id, analysis_id, position, body, reason, origin
  )
  select
    finished.organization_id,
    finished.id,
    entry.ordinality,
    entry.value ->> 'body',
    entry.value ->> 'reason',
    'deterministic'
  from jsonb_array_elements(complete_analysis.report -> 'recommendations')
    with ordinality as entry (value, ordinality);

  insert into public.analysis_evidence (organization_id, analysis_id, recommendation_id, file_id)
  select finished.organization_id, finished.id, recommendation.id, file.id
  from jsonb_array_elements(complete_analysis.report -> 'recommendations')
    with ordinality as entry (value, ordinality)
  cross join lateral jsonb_array_elements_text(entry.value -> 'evidence') as evidence (path)
  join public.analysis_recommendations as recommendation
    on recommendation.analysis_id = finished.id and recommendation.position = entry.ordinality
  join public.analysis_files as file
    on file.analysis_id = finished.id and file.path = evidence.path;
  get diagnostics written = row_count;
  select coalesce(sum(jsonb_array_length(entry.value -> 'evidence')), 0)
  into expected
  from jsonb_array_elements(complete_analysis.report -> 'recommendations') as entry;
  if written <> expected then
    raise exception 'Analysis %: % of % pieces of recommendation evidence name a file that is not in the result.',
      finished.id, expected - written, expected
      using errcode = 'check_violation';
  end if;
end;
$$;

revoke execute on function public.complete_analysis(uuid, jsonb) from public, anon;
grant execute on function public.complete_analysis(uuid, jsonb) to authenticated;

-- Grants and policies. This phase is the first writer of these tables.
grant insert, update on public.pull_requests, public.analyses to authenticated;
grant insert on
  public.analysis_files,
  public.analysis_dependencies,
  public.analysis_risk_signals,
  public.analysis_recommendations,
  public.analysis_evidence
to authenticated;

create policy "Members add pull requests to their organization"
  on public.pull_requests for insert to authenticated
  with check (organization_id = (select public.requesting_organization_id()));

create policy "Members update their organization's pull requests"
  on public.pull_requests for update to authenticated
  using (organization_id = (select public.requesting_organization_id()))
  with check (organization_id = (select public.requesting_organization_id()));

create policy "Members start analyses in their organization"
  on public.analyses for insert to authenticated
  with check (organization_id = (select public.requesting_organization_id()));

create policy "Members update their organization's analyses"
  on public.analyses for update to authenticated
  using (organization_id = (select public.requesting_organization_id()))
  with check (organization_id = (select public.requesting_organization_id()));

create policy "Members store their organization's analysis files"
  on public.analysis_files for insert to authenticated
  with check (organization_id = (select public.requesting_organization_id()));

create policy "Members store their organization's analysis dependencies"
  on public.analysis_dependencies for insert to authenticated
  with check (organization_id = (select public.requesting_organization_id()));

create policy "Members store their organization's risk signals"
  on public.analysis_risk_signals for insert to authenticated
  with check (organization_id = (select public.requesting_organization_id()));

create policy "Members store their organization's recommendations"
  on public.analysis_recommendations for insert to authenticated
  with check (organization_id = (select public.requesting_organization_id()));

create policy "Members store their organization's evidence"
  on public.analysis_evidence for insert to authenticated
  with check (organization_id = (select public.requesting_organization_id()));

-- Live progress, the same way repository runs report theirs: each analysis has
-- a private Realtime Broadcast topic, "analysis:<id>", and the trigger sends
-- only what the progress view shows.
create function public.analyses_broadcast_progress()
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
    'analysis:' || new.id::text,
    true
  );
  return null;
end;
$$;

revoke execute on function public.analyses_broadcast_progress() from public, anon, authenticated;

create trigger analyses_broadcast_progress
  after insert or update on public.analyses
  for each row execute function public.analyses_broadcast_progress();

create policy "Members receive their organization's analysis progress"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1
      from public.analyses as run
      where 'analysis:' || run.id::text = (select realtime.topic())
        and run.organization_id = (select public.requesting_organization_id())
    )
  );
