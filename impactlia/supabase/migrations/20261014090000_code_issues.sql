-- Code issues: problems a tool found in a pull request's changed code, at the
-- lines it adds, alongside what the change could affect.
--
-- An issue is stored only as part of a completed analysis, by
-- complete_analysis, in the same transaction as the rest of the result. Every
-- issue names a changed file of that result, and every file it is linked to
-- is a file of that result: one that does not stops the whole save.
--
-- No source code is stored: an issue keeps its location, the tool's message
-- and the paths of the files that import it.

-- Between computing risk signals and saving the report.
alter type public.analysis_stage add value 'checking' before 'saving';

-- Only the values the analysis produces today. Every issue so far is a
-- compiler diagnostic, and so confirmed under the conditions it records.
create type public.code_issue_category as enum ('syntax', 'type');
create type public.code_issue_status as enum ('confirmed');
create type public.code_issue_source as enum ('compiler');

alter table public.analyses
  -- What the code checks covered: files checked, files skipped and why,
  -- diagnostics set aside. Null on analyses completed before checks existed,
  -- which is not the same as nothing found.
  add column code_check jsonb,
  add constraint analyses_code_check_is_object
    check (code_check is null or jsonb_typeof(code_check) = 'object');

create table public.analysis_code_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null,
  -- The changed file the issue is in.
  file_id uuid not null,
  -- Most severe first, then by file and line.
  position integer not null check (position >= 1),
  title text not null check (char_length(title) <= 200),
  category public.code_issue_category not null,
  -- The same three levels as risk signals; the rule for each category is
  -- written in the application beside the report.
  severity public.risk_level not null,
  status public.code_issue_status not null,
  source public.code_issue_source not null,
  -- The tool's identifier for the rule, like TS2322. Null when it gave none.
  rule_id text check (char_length(rule_id) <= 40),
  -- 1-based, in the head commit the result was built from.
  start_line integer not null check (start_line >= 1),
  start_column integer check (start_column >= 1),
  end_line integer check (end_line >= start_line),
  end_column integer check (end_column >= 1),
  message text not null check (char_length(message) <= 1000),
  -- What the issue was confirmed under.
  conditions text not null check (char_length(conditions) <= 1000),
  -- Files that import the issue's file, as {path, relationship, typeOnly}:
  -- edges of the graph, not evidence that the issue reaches them.
  related_files jsonb not null default '[]'::jsonb
    check (jsonb_typeof(related_files) = 'array'),
  related_file_count integer not null default 0,
  unique (analysis_id, position),
  check (related_file_count >= jsonb_array_length(related_files)),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  foreign key (file_id, analysis_id, organization_id)
    references public.analysis_files (id, analysis_id, organization_id) on delete cascade
);

create index analysis_code_issues_analysis_owner_idx
  on public.analysis_code_issues (analysis_id, organization_id);
create index analysis_code_issues_file_idx
  on public.analysis_code_issues (file_id, analysis_id, organization_id);

alter table public.analysis_code_issues enable row level security;
revoke all on public.analysis_code_issues from anon, authenticated;
grant select, insert on public.analysis_code_issues to authenticated;

create policy "Members read their organization's code issues"
  on public.analysis_code_issues for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

create policy "Members store their organization's code issues"
  on public.analysis_code_issues for insert to authenticated
  with check (organization_id = (select public.requesting_organization_id()));

-- complete_analysis as before, now also storing the code check and the
-- issues. A report without them is refused: every analysis from here on runs
-- the checks, and a missing record would read as "nothing found".
create or replace function public.complete_analysis(run_id uuid, report jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  finished public.analyses;
  expected integer;
  written integer;
  unknown integer;
begin
  update public.analyses as run
  set status = 'completed',
      stage = 'complete',
      last_completed_stage = 'saving',
      graph_sha = complete_analysis.report ->> 'graphSha',
      code_check = complete_analysis.report -> 'codeCheck',
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

  if jsonb_typeof(complete_analysis.report -> 'codeCheck') is distinct from 'object'
    or jsonb_typeof(complete_analysis.report -> 'codeIssues') is distinct from 'array' then
    raise exception 'Analysis %: the report has no code check.', finished.id
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

  -- Each issue is in a changed file of this result, and every file it is
  -- linked to is a file of this result too.
  insert into public.analysis_code_issues (
    organization_id, analysis_id, file_id, position, title, category, severity,
    status, source, rule_id, start_line, start_column, end_line, end_column,
    message, conditions, related_files, related_file_count
  )
  select
    finished.organization_id,
    finished.id,
    file.id,
    entry.ordinality,
    entry.value ->> 'title',
    (entry.value ->> 'category')::public.code_issue_category,
    (entry.value ->> 'severity')::public.risk_level,
    (entry.value ->> 'status')::public.code_issue_status,
    (entry.value ->> 'source')::public.code_issue_source,
    entry.value ->> 'ruleId',
    (entry.value ->> 'startLine')::integer,
    (entry.value ->> 'startColumn')::integer,
    (entry.value ->> 'endLine')::integer,
    (entry.value ->> 'endColumn')::integer,
    entry.value ->> 'message',
    entry.value ->> 'conditions',
    entry.value -> 'relatedFiles',
    (entry.value ->> 'relatedFileCount')::integer
  from jsonb_array_elements(complete_analysis.report -> 'codeIssues')
    with ordinality as entry (value, ordinality)
  join public.analysis_files as file
    on file.analysis_id = finished.id
    and file.kind = 'changed'
    and file.path = entry.value ->> 'path';
  get diagnostics written = row_count;
  expected := jsonb_array_length(complete_analysis.report -> 'codeIssues');
  if written <> expected then
    raise exception 'Analysis %: % of % code issues are not in a changed file of the result.',
      finished.id, expected - written, expected
      using errcode = 'check_violation';
  end if;

  select count(*)
  into unknown
  from jsonb_array_elements(complete_analysis.report -> 'codeIssues') as issue
  cross join lateral jsonb_array_elements(issue.value -> 'relatedFiles') as related
  where not exists (
    select 1 from public.analysis_files as file
    where file.analysis_id = finished.id and file.path = related.value ->> 'path'
  );
  if unknown > 0 then
    raise exception 'Analysis %: % files linked to code issues are not in the result.',
      finished.id, unknown
      using errcode = 'check_violation';
  end if;
end;
$$;

