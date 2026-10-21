-- Test recommendations and the risk score: which existing tests relate to a
-- pull request's change, which scenarios are worth testing, where no test was
-- found, the repository's test command, and a 0-100 score that weighs the
-- documented risk factors.
--
-- Both are stored only as part of a completed analysis, by complete_analysis,
-- in the same transaction as the rest of the result, so they always belong to
-- the head commit that analysis is of. A newer commit gets a new analysis;
-- nothing here is updated in place.
--
-- No source code is stored: a recommendation keeps paths, line numbers, the
-- names of declarations and the analysis's own sentences. A test command is
-- the repository's own package.json script.

-- Between checking the changed code and saving the report.
alter type public.analysis_stage add value 'recommending' before 'saving';

-- Four levels for the score, kept apart from risk_level, which signals, code
-- issues and earlier analyses still use with its three.
create type public.risk_score_level as enum ('low', 'moderate', 'high', 'very_high');
create type public.analysis_confidence as enum ('high', 'medium', 'low');
create type public.recommendation_priority as enum ('high', 'medium', 'low');
create type public.test_recommendation_kind as enum (
  'existing_test', 'suggested_scenario', 'coverage_unknown', 'test_command'
);
-- 'found': a test file at the head commit. 'suggested': a test that may not
-- exist. 'unknown': none was found, which does not show none exists.
create type public.test_recommendation_status as enum ('found', 'suggested', 'unknown');
create type public.test_relationship as enum (
  'imports-changed-symbol', 'imports-changed-file', 'changed-in-pull-request',
  'imports-indirectly', 'name-only'
);

alter table public.analyses
  -- Null with a null level is "Insufficient evidence", and on analyses
  -- completed before the score existed.
  add column risk_score smallint check (risk_score between 0 and 100),
  add column risk_score_level public.risk_score_level,
  add column risk_confidence public.analysis_confidence,
  -- The factors, their points and evidence, the summary and what lowered the
  -- confidence, exactly as the analysis wrote them.
  add column risk_assessment jsonb,
  -- What the search for tests covered, so that none found can be told apart
  -- from none looked for.
  add column test_discovery jsonb,
  add constraint analyses_risk_score_has_level
    check ((risk_score is null) = (risk_score_level is null)),
  add constraint analyses_risk_assessment_is_object
    check (risk_assessment is null or jsonb_typeof(risk_assessment) = 'object'),
  add constraint analyses_test_discovery_is_object
    check (test_discovery is null or jsonb_typeof(test_discovery) = 'object');

create table public.analysis_test_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null,
  -- Existing tests strongest first, then the command, scenarios and files
  -- with no test found.
  position integer not null check (position >= 1),
  kind public.test_recommendation_kind not null,
  title text not null check (char_length(title) <= 5000),
  description text not null check (char_length(description) <= 10000),
  rationale text not null check (char_length(rationale) <= 2000),
  priority public.recommendation_priority not null,
  status public.test_recommendation_status not null,
  confidence public.analysis_confidence not null,
  relationship public.test_relationship,
  -- A declaration read from a changed file, like format or Cart.total.
  symbol text check (char_length(symbol) <= 500),
  risk_addressed text check (char_length(risk_addressed) <= 100),
  -- {path, startLine, endLine}, lines of the head commit.
  related_changed_files jsonb not null default '[]'::jsonb
    check (jsonb_typeof(related_changed_files) = 'array'),
  -- {path, startLine, endLine, relationshipEvidence}.
  related_test_files jsonb not null default '[]'::jsonb
    check (jsonb_typeof(related_test_files) = 'array'),
  command text check (char_length(command) <= 5000),
  working_directory text check (char_length(working_directory) <= 5000),
  -- Sentences, each a fact the recommendation rests on.
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  unique (analysis_id, position),
  check ((relationship is not null) = (kind = 'existing_test')),
  check ((command is not null) = (kind = 'test_command')),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade
);

create index analysis_test_recommendations_analysis_owner_idx
  on public.analysis_test_recommendations (analysis_id, organization_id);

alter table public.analysis_test_recommendations enable row level security;
revoke all on public.analysis_test_recommendations from anon, authenticated;
grant select, insert on public.analysis_test_recommendations to authenticated;

create policy "Members read their organization's test recommendations"
  on public.analysis_test_recommendations for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

create policy "Members store their organization's test recommendations"
  on public.analysis_test_recommendations for insert to authenticated
  with check (organization_id = (select public.requesting_organization_id()));

-- complete_analysis as before, now also storing the risk score and the test
-- recommendations. A report without them is refused: every analysis from here
-- on produces both, and a missing record would read as "nothing found".
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
      -- The three-level label of earlier analyses. A report from here on has
      -- a score instead, so this is null for it.
      risk_level = (complete_analysis.report ->> 'riskLevel')::public.risk_level,
      risk_score = (complete_analysis.report #>> '{risk,score}')::smallint,
      risk_score_level = (complete_analysis.report #>> '{risk,level}')::public.risk_score_level,
      risk_confidence = (complete_analysis.report #>> '{risk,confidence}')::public.analysis_confidence,
      risk_assessment = complete_analysis.report -> 'risk',
      test_discovery = complete_analysis.report -> 'testDiscovery',
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

  if jsonb_typeof(complete_analysis.report -> 'risk') is distinct from 'object'
    or jsonb_typeof(complete_analysis.report -> 'testDiscovery') is distinct from 'object'
    or jsonb_typeof(complete_analysis.report -> 'testRecommendations') is distinct from 'array' then
    raise exception 'Analysis %: the report has no risk assessment or no test recommendations.', finished.id
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

  -- Test recommendations, in the order the analysis ranked them. Every
  -- changed file one names is a changed file of this result. Test files are
  -- checked against the graph before the report is sent: a test tied to the
  -- change only by its name is not one of the result's files.
  insert into public.analysis_test_recommendations (
    organization_id, analysis_id, position, kind, title, description, rationale,
    priority, status, confidence, relationship, symbol, risk_addressed,
    related_changed_files, related_test_files, command, working_directory, evidence
  )
  select
    finished.organization_id,
    finished.id,
    entry.ordinality,
    (entry.value ->> 'kind')::public.test_recommendation_kind,
    entry.value ->> 'title',
    entry.value ->> 'description',
    entry.value ->> 'rationale',
    (entry.value ->> 'priority')::public.recommendation_priority,
    (entry.value ->> 'status')::public.test_recommendation_status,
    (entry.value ->> 'confidence')::public.analysis_confidence,
    (entry.value ->> 'relationship')::public.test_relationship,
    entry.value ->> 'symbol',
    entry.value ->> 'riskAddressed',
    entry.value -> 'relatedChangedFiles',
    entry.value -> 'relatedTestFiles',
    entry.value ->> 'command',
    entry.value ->> 'workingDirectory',
    entry.value -> 'evidence'
  from jsonb_array_elements(complete_analysis.report -> 'testRecommendations')
    with ordinality as entry (value, ordinality);

  select count(*)
  into unknown
  from jsonb_array_elements(complete_analysis.report -> 'testRecommendations') as recommendation
  cross join lateral jsonb_array_elements(recommendation.value -> 'relatedChangedFiles') as related
  where not exists (
    select 1 from public.analysis_files as file
    where file.analysis_id = finished.id
      and file.kind = 'changed'
      and file.path = related.value ->> 'path'
  );
  if unknown > 0 then
    raise exception 'Analysis %: % changed files named by test recommendations are not in the result.',
      finished.id, unknown
      using errcode = 'check_violation';
  end if;
end;
$$;

