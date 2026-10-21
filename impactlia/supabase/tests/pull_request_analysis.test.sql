-- Checks for 20261013090000_pull_request_analysis.sql. Run with
-- `pnpm check:database`. Every statement after the setup runs as the
-- `authenticated` role with one organization's token, exactly as the
-- application's requests do, so what passes here passed the policies.
--
-- A failed assertion stops the script with the message beside it.

\set first 'org_first'
\set second 'org_second'

create schema checks;
grant usage on schema checks to authenticated;

-- Acts as a member of one organization from here on.
create function checks.act_as(organization text)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('org_id', organization)::text, false);
$$;

-- Runs a statement and returns the error's SQLSTATE, or null if it succeeded.
create function checks.error_of(statement text)
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

-- Ids the checks share. Rows are written by the members themselves, below.
create table checks.ids (name text primary key, id uuid not null);
grant select, insert on checks.ids to authenticated;
grant execute on all functions in schema checks to authenticated;

set role authenticated;

-- ── A member starts an analysis ────────────────────────────────────────────
select checks.act_as(:'first');

insert into public.organizations (id) values (:'first');

with repository as (
  insert into public.repositories
    (organization_id, provider, provider_repository_id, owner, name, default_branch)
  values (:'first', 'github', '1', 'example', 'storefront', 'main')
  returning id
), pull_request as (
  insert into public.pull_requests
    (organization_id, repository_id, number, title, author_login, base_ref, head_ref)
  select :'first', id, 7, 'Change the price format', 'someone', 'main', 'price-format'
  from repository
  returning id
), analysis as (
  insert into public.analyses
    (organization_id, pull_request_id, status, stage, last_completed_stage,
     base_sha, head_sha, started_at)
  select :'first', id, 'running', 'fetching', 'validating',
    repeat('a', 40), repeat('b', 40), now()
  from pull_request
  returning id, pull_request_id
)
insert into checks.ids (name, id)
select 'analysis', id from analysis
union all
select 'pull_request', pull_request_id from analysis;

do $$
declare
  analysis uuid := (select id from checks.ids where name = 'analysis');
  pull_request uuid := (select id from checks.ids where name = 'pull_request');
  outcome text;
begin
  -- The same pull request at the same commit cannot have two unfinished runs.
  outcome := checks.error_of(format(
    $q$insert into public.analyses (organization_id, pull_request_id, status, head_sha, started_at)
       values ('org_first', %L, 'running', repeat('b', 40), now())$q$, pull_request));
  assert outcome = '23505', format('a duplicate unfinished run was not refused (%s)', outcome);

  -- At another commit it can.
  outcome := checks.error_of(format(
    $q$insert into public.analyses (organization_id, pull_request_id, status, head_sha, started_at)
       values ('org_first', %L, 'running', repeat('c', 40), now())$q$, pull_request));
  assert outcome is null, format('a run at another commit was refused (%s)', outcome);

  -- Progress is stamped by the database.
  update public.analyses
  set stage = 'preparing', last_completed_stage = 'fetching',
      progressed_at = '2000-01-01'
  where id = analysis;
  assert (select progressed_at > now() - interval '1 minute' from public.analyses where id = analysis),
    'progressed_at was taken from the caller instead of the database clock';

  -- Progress is broadcast, but nobody reads it without joining the topic.
  assert not exists (select 1 from realtime.messages),
    'a member could read broadcast messages without joining the topic';
end;
$$;

-- ── A report that names a file it does not contain is refused whole ────────
do $$
declare
  analysis uuid := (select id from checks.ids where name = 'analysis');
  outcome text;
begin
  outcome := checks.error_of(format(
    $q$select public.complete_analysis(%L, %L::jsonb)$q$,
    analysis,
    '{"graphSha": null, "riskLevel": "low", "limitations": [],
      "files": [{"kind": "changed", "path": "src/a.ts", "changeType": "modified",
                 "additions": 1, "deletions": 0, "previousPath": null,
                 "patchAvailable": true, "analysisState": "analysed", "stateReason": null}],
      "dependencies": [{"source": "src/missing.ts", "target": "src/a.ts",
                        "kind": "import", "typeOnly": false}],
      "signals": [], "recommendations": []}'));
  assert outcome = '23514', format('a dependency on an unknown file was accepted (%s)', outcome);
  assert (select status = 'running' from public.analyses where id = analysis),
    'the refused report still changed the run';
  assert not exists (select 1 from public.analysis_files where analysis_id = analysis),
    'the refused report left file rows behind';
end;
$$;

-- ── A code issue must sit in a changed file and link only to known files ───
do $$
declare
  analysis uuid := (select id from checks.ids where name = 'analysis');
  base text := '{"graphSha": null, "riskLevel": "low", "limitations": [],
      "files": [{"kind": "changed", "path": "src/a.ts", "changeType": "modified",
                 "additions": 1, "deletions": 0, "previousPath": null,
                 "patchAvailable": true, "analysisState": "analysed", "stateReason": null}],
      "dependencies": [], "signals": [], "recommendations": [],
      "risk": {"method": 1, "score": 30, "level": "moderate", "summary": "s", "factors": [],
               "confidence": "medium", "limitations": []},
      "testDiscovery": {"testFileCount": 0}, "testRecommendations": [],
      "codeCheck": {"checked": [], "skipped": [], "setAside": [], "omitted": 0}';
  issue text := '{"title": "Type error", "category": "type", "severity": "medium",
      "status": "confirmed", "source": "compiler", "ruleId": "TS2322", "startLine": 1,
      "startColumn": 1, "endLine": 1, "endColumn": 2, "message": "m", "conditions": "c",
      "relatedFileCount": 1, ';
  outcome text;
begin
  outcome := checks.error_of(format($q$select public.complete_analysis(%L, %L::jsonb)$q$, analysis,
    base || ', "codeIssues": [' || issue || '"path": "src/other.ts", "relatedFiles": []}]}'));
  assert outcome = '23514', format('an issue outside the changed files was accepted (%s)', outcome);
  outcome := checks.error_of(format($q$select public.complete_analysis(%L, %L::jsonb)$q$, analysis,
    base || ', "codeIssues": [' || issue || '"path": "src/a.ts",
      "relatedFiles": [{"path": "src/nowhere.ts", "relationship": "import", "typeOnly": false}]}]}'));
  assert outcome = '23514', format('an issue linked to an unknown file was accepted (%s)', outcome);
  outcome := checks.error_of(format($q$select public.complete_analysis(%L, %L::jsonb)$q$, analysis,
    replace(base, ', "codeCheck": {"checked": [], "skipped": [], "setAside": [], "omitted": 0}', '') || '}'));
  assert outcome = '23514', format('a report without a code check was accepted (%s)', outcome);
  assert (select status = 'running' from public.analyses where id = analysis),
    'a refused report still changed the run';
  assert not exists (select 1 from public.analysis_code_issues where analysis_id = analysis),
    'a refused report left code issues behind';
end;
$$;

-- ── A test recommendation must name only changed files of the result ───────
do $$
declare
  analysis uuid := (select id from checks.ids where name = 'analysis');
  base text := '{"graphSha": null, "riskLevel": null, "limitations": [],
      "files": [{"kind": "changed", "path": "src/a.ts", "changeType": "modified",
                 "additions": 1, "deletions": 0, "previousPath": null,
                 "patchAvailable": true, "analysisState": "analysed", "stateReason": null}],
      "dependencies": [], "signals": [], "recommendations": [], "codeIssues": [],
      "codeCheck": {"checked": [], "skipped": [], "setAside": [], "omitted": 0},
      "risk": {"score": 15, "level": "low", "confidence": "high", "factors": [], "summary": "s"},
      "testDiscovery": {}';
  recommendation text := '{"kind": "coverage_unknown", "title": "t", "description": "d",
      "rationale": "r", "priority": "low", "status": "unknown", "confidence": "medium",
      "relationship": null, "symbol": null, "riskAddressed": null, "relatedTestFiles": [],
      "command": null, "workingDirectory": null, "evidence": [], ';
  outcome text;
begin
  outcome := checks.error_of(format($q$select public.complete_analysis(%L, %L::jsonb)$q$, analysis,
    base || ', "testRecommendations": [' || recommendation
      || '"relatedChangedFiles": [{"path": "src/elsewhere.ts", "startLine": null, "endLine": null}]}]}'));
  assert outcome = '23514', format('a recommendation naming an unknown file was accepted (%s)', outcome);
  outcome := checks.error_of(format($q$select public.complete_analysis(%L, %L::jsonb)$q$, analysis,
    base || '}'));
  assert outcome = '23514', format('a report without test recommendations was accepted (%s)', outcome);
  outcome := checks.error_of(format($q$select public.complete_analysis(%L, %L::jsonb)$q$, analysis,
    replace(base, '"risk": {"score": 15', '"risk": {"score": 101') || ', "testRecommendations": []}'));
  assert outcome = '23514', format('a score over 100 was accepted (%s)', outcome);
  assert (select status = 'running' from public.analyses where id = analysis),
    'a refused report still changed the run';
  assert not exists (select 1 from public.analysis_test_recommendations where analysis_id = analysis),
    'a refused report left test recommendations behind';
end;
$$;

-- ── A report is stored whole ───────────────────────────────────────────────
select public.complete_analysis(
  (select id from checks.ids where name = 'analysis'),
  $report${
    "graphSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "riskLevel": "medium",
    "limitations": [{"id": "removed-files", "detail": "1 file was removed.", "files": ["src/gone.ts"]}],
    "files": [
      {"kind": "changed", "path": "src/core.ts", "changeType": "modified", "additions": 3,
       "deletions": 1, "previousPath": null, "patchAvailable": true,
       "analysisState": "analysed", "stateReason": null},
      {"kind": "changed", "path": "src/gone.ts", "changeType": "removed", "additions": 0,
       "deletions": 9, "previousPath": null, "patchAvailable": true,
       "analysisState": "unanalysed", "stateReason": "Removed by this pull request."},
      {"kind": "affected", "path": "src/format.ts", "impactDepth": 1,
       "dependencyPath": ["src/core.ts", "src/format.ts"], "routeCount": 1},
      {"kind": "affected", "path": "src/page.ts", "impactDepth": 2,
       "dependencyPath": ["src/core.ts", "src/format.ts", "src/page.ts"], "routeCount": 1}
    ],
    "dependencies": [
      {"source": "src/format.ts", "target": "src/core.ts", "kind": "import", "typeOnly": false},
      {"source": "src/page.ts", "target": "src/format.ts", "kind": "import+re-export", "typeOnly": true}
    ],
    "signals": [
      {"signal": "transitive-reach", "level": "low",
       "detail": {"rule": "Counts files.", "facts": ["2 files import the changed code."]},
       "evidence": ["src/core.ts"]},
      {"signal": "incomplete-coverage", "level": "medium",
       "detail": {"rule": "Medium when a file was removed.", "facts": ["1 source file was removed."]},
       "evidence": ["src/gone.ts"]}
    ],
    "recommendations": [
      {"body": "Check the direct importers by hand.", "reason": "No test file imports the change.",
       "evidence": ["src/format.ts"]},
      {"body": "Trace the removed file by hand.", "reason": "It is not in the graph.",
       "evidence": ["src/gone.ts"]}
    ],
    "codeIssues": [
      {"title": "Type error", "category": "type", "severity": "medium", "status": "confirmed",
       "source": "compiler", "ruleId": "TS2322", "path": "src/core.ts", "startLine": 4,
       "startColumn": 9, "endLine": 4, "endColumn": 14,
       "message": "Type 'string' is not assignable to type 'number'.",
       "conditions": "Reported by the TypeScript compiler under tsconfig.json.",
       "relatedFiles": [{"path": "src/format.ts", "relationship": "import", "typeOnly": false}],
       "relatedFileCount": 1}
    ],
    "codeCheck": {"checked": ["src/core.ts"], "skipped": [], "setAside": [], "omitted": 0},
    "risk": {"method": 1, "score": 30, "level": "moderate", "summary": "Moderate risk, 30 of 100.",
             "factors": [{"factor": "dependency-reach", "direction": "increases_risk",
                          "explanation": "e", "evidence": [], "contribution": 30}],
             "confidence": "medium", "limitations": ["Removed files cannot be traced."]},
    "testDiscovery": {"testFileCount": 1, "conventions": [], "frameworks": [],
                      "omitted": {"existing": 0, "scenarios": 0, "coverageUnknown": 0},
                      "coverageData": "c", "command": {"found": false, "detail": "d"},
                      "symbolsUnread": []},
    "testRecommendations": [
      {"kind": "existing_test", "title": "src/format.test.ts", "description": "d", "rationale": "r",
       "priority": "high", "status": "found", "confidence": "high",
       "relationship": "imports-changed-symbol", "symbol": "core", "riskAddressed": "regression",
       "relatedChangedFiles": [{"path": "src/core.ts", "startLine": 1, "endLine": 3}],
       "relatedTestFiles": [{"path": "src/format.test.ts", "startLine": 1, "endLine": 1,
                             "relationshipEvidence": "Imports core."}],
       "command": null, "workingDirectory": null, "evidence": ["Imports core."]},
      {"kind": "suggested_scenario", "title": "Both outcomes", "description": "d", "rationale": "r",
       "priority": "medium", "status": "suggested", "confidence": "medium",
       "relationship": null, "symbol": "core", "riskAddressed": "regression",
       "relatedChangedFiles": [{"path": "src/core.ts", "startLine": 2, "endLine": 2}],
       "relatedTestFiles": [], "command": null, "workingDirectory": null, "evidence": []}
    ]
  }$report$::jsonb
);

do $$
declare
  analysis uuid := (select id from checks.ids where name = 'analysis');
  run public.analyses;
  outcome text;
begin
  select * into run from public.analyses where id = analysis;
  assert run.status = 'completed' and run.stage = 'complete' and run.last_completed_stage = 'saving',
    'the run was not marked completed';
  assert run.completed_at is not null, 'completed_at was not stamped';
  assert run.changed_file_count = 2 and run.affected_file_count = 2,
    format('counts are %s changed and %s affected, not 2 and 2', run.changed_file_count, run.affected_file_count);
  assert run.risk_level = 'medium' and run.graph_sha = repeat('b', 40), 'risk level or graph commit was not stored';
  assert jsonb_array_length(run.limitations) = 1, 'limitations were not stored';

  assert (select count(*) from public.analysis_files where analysis_id = analysis) = 4,
    'not every file row was written';
  assert (
    select dependency_path = array['src/core.ts', 'src/format.ts', 'src/page.ts'] and impact_depth = 2
    from public.analysis_files where analysis_id = analysis and path = 'src/page.ts'
  ), 'a dependency path lost its order';
  assert (
    select analysis_state = 'unanalysed' and change_type = 'removed' and dependency_path is null
    from public.analysis_files where analysis_id = analysis and path = 'src/gone.ts'
  ), 'a changed file was stored with the wrong columns';

  -- Dependencies point from the importing file to the imported one.
  assert (
    select count(*) = 2
    from public.analysis_dependencies as dependency
    join public.analysis_files as source on source.id = dependency.source_file_id
    join public.analysis_files as target on target.id = dependency.target_file_id
    where dependency.analysis_id = analysis
      and (source.path, target.path, dependency.type_only) in (
        ('src/format.ts', 'src/core.ts', false),
        ('src/page.ts', 'src/format.ts', true)
      )
  ), 'dependencies were not stored between the right files';

  assert (select count(*) from public.analysis_risk_signals where analysis_id = analysis) = 2,
    'risk signals were not stored';
  assert (
    select file.path = 'src/gone.ts'
    from public.analysis_evidence as evidence
    join public.analysis_risk_signals as signal on signal.id = evidence.risk_signal_id
    join public.analysis_files as file on file.id = evidence.file_id
    where signal.analysis_id = analysis and signal.signal = 'incomplete-coverage'
  ), 'risk evidence points at the wrong file';

  assert (
    select array_agg(body order by position) = array[
      'Check the direct importers by hand.', 'Trace the removed file by hand.']
      and bool_and(origin = 'deterministic') and bool_and(reason is not null)
    from public.analysis_recommendations where analysis_id = analysis
  ), 'recommendations lost their order, origin or reason';
  assert (
    select file.path = 'src/gone.ts'
    from public.analysis_evidence as evidence
    join public.analysis_recommendations as recommendation
      on recommendation.id = evidence.recommendation_id
    join public.analysis_files as file on file.id = evidence.file_id
    where recommendation.analysis_id = analysis and recommendation.position = 2
  ), 'recommendation evidence points at the wrong file';

  assert (
    select issue.rule_id = 'TS2322' and issue.start_line = 4 and issue.status = 'confirmed'
      and file.path = 'src/core.ts' and file.kind = 'changed'
      and issue.related_files -> 0 ->> 'path' = 'src/format.ts'
    from public.analysis_code_issues as issue
    join public.analysis_files as file on file.id = issue.file_id
    where issue.analysis_id = analysis
  ), 'the code issue was not stored against its changed file';
  assert (select code_check -> 'checked' ->> 0 = 'src/core.ts' from public.analyses where id = analysis),
    'the code check was not stored';

  -- The score and the test recommendations belong to this run, and so to its
  -- head commit.
  assert (
    select risk_score = 30 and risk_score_level = 'moderate' and risk_confidence = 'medium'
      and risk_assessment ->> 'summary' = 'Moderate risk, 30 of 100.'
      and test_discovery ->> 'testFileCount' = '1'
    from public.analyses where id = analysis
  ), 'the risk score or test discovery was not stored';
  assert (
    select array_agg(kind::text order by position) = array['existing_test', 'suggested_scenario']
      and bool_and(related_changed_files -> 0 ->> 'path' = 'src/core.ts')
    from public.analysis_test_recommendations where analysis_id = analysis
  ), 'test recommendations lost their order or files';

  -- A finished analysis never changes again.
  outcome := checks.error_of(format(
    $q$update public.analyses set failure_reason = 'x', status = 'failed' where id = %L$q$, analysis));
  assert outcome = '23514', format('a completed run was changed (%s)', outcome);
  outcome := checks.error_of(format(
    $q$select public.complete_analysis(%L, '{}'::jsonb)$q$, analysis));
  assert outcome = '23514', format('a completed run was completed twice (%s)', outcome);
end;
$$;

-- ── A failed run records when, and can then be run again ───────────────────
do $$
declare
  pull_request uuid := (select id from checks.ids where name = 'pull_request');
  other uuid;
  outcome text;
begin
  select id into other from public.analyses
  where pull_request_id = pull_request and head_sha = repeat('c', 40);
  update public.analyses set status = 'failed', failure_reason = 'GitHub took too long to answer.'
  where id = other and status = 'running';
  assert (select status = 'failed' and completed_at is not null and stage = 'validating'
          from public.analyses where id = other), 'a failure was not recorded with its stage and time';

  -- With that one finished, the same commit can be analysed again.
  outcome := checks.error_of(format(
    $q$insert into public.analyses (organization_id, pull_request_id, status, head_sha, started_at)
       values ('org_first', %L, 'running', repeat('c', 40), now())$q$, pull_request));
  assert outcome is null, format('a retry after a failure was refused (%s)', outcome);
end;
$$;

-- ── Live progress reaches the run's own organization ───────────────────────
select set_config('realtime.topic', 'analysis:' || (select id from checks.ids where name = 'analysis'), false);

do $$
begin
  assert (
    select count(*) >= 3 and bool_and(private) and bool_and(event = 'progress')
      and bool_or(payload ->> 'status' = 'completed')
      and bool_and(payload ?& array['id', 'status', 'stage', 'lastCompletedStage', 'failureReason', 'progressedAt'])
    from realtime.messages
    where topic = current_setting('realtime.topic')
  ), 'the run''s organization did not receive its progress';
end;
$$;

-- ── Another organization sees and changes none of it ───────────────────────
select checks.act_as(:'second');
insert into public.organizations (id) values (:'second');

do $$
declare
  analysis uuid := (select id from checks.ids where name = 'analysis');
  pull_request uuid := (select id from checks.ids where name = 'pull_request');
  outcome text;
  touched integer;
begin
  assert not exists (select 1 from public.analyses), 'another organization can read analyses';
  assert not exists (select 1 from public.pull_requests), 'another organization can read pull requests';
  assert not exists (select 1 from public.analysis_files), 'another organization can read analysis files';
  assert not exists (select 1 from public.analysis_dependencies), 'another organization can read dependencies';
  assert not exists (select 1 from public.analysis_risk_signals), 'another organization can read risk signals';
  assert not exists (select 1 from public.analysis_recommendations), 'another organization can read recommendations';
  assert not exists (select 1 from public.analysis_evidence), 'another organization can read evidence';
  assert not exists (select 1 from public.analysis_code_issues), 'another organization can read code issues';
  assert not exists (select 1 from public.analysis_test_recommendations),
    'another organization can read test recommendations';
  -- Still set to the first organization's topic.
  assert not exists (select 1 from realtime.messages), 'another organization can join the run''s topic';

  update public.analyses set stage = 'saving' where pull_request_id = pull_request;
  get diagnostics touched = row_count;
  assert touched = 0, 'another organization changed an analysis';

  outcome := checks.error_of(format(
    $q$select public.complete_analysis(
         (select id from public.analyses where true limit 1), '{}'::jsonb)$q$));
  assert outcome = '23514', format('another organization completed a run (%s)', outcome);
  outcome := checks.error_of(format(
    $q$select public.complete_analysis(%L, '{"files": [], "limitations": []}'::jsonb)$q$, analysis));
  assert outcome = '23514', format('another organization completed a run by its id (%s)', outcome);

  -- Writing a row under the first organization's name is refused.
  outcome := checks.error_of(format(
    $q$insert into public.analyses (organization_id, pull_request_id, status, head_sha, started_at)
       values ('org_first', %L, 'running', repeat('d', 40), now())$q$, pull_request));
  assert outcome = '42501', format('a row was written into another organization (%s)', outcome);
  outcome := checks.error_of(format(
    $q$insert into public.analysis_files (organization_id, analysis_id, path, kind, change_type)
       values ('org_first', %L, 'src/x.ts', 'changed', 'added')$q$, analysis));
  assert outcome = '42501', format('a file row was written into another organization (%s)', outcome);
  outcome := checks.error_of(format(
    $q$insert into public.analysis_code_issues (organization_id, analysis_id, file_id, position,
         title, category, severity, status, source, start_line, message, conditions)
       select 'org_first', %L, gen_random_uuid(), 9, 't', 'type', 'low', 'confirmed', 'compiler',
         1, 'm', 'c'$q$, analysis));
  assert outcome = '42501', format('a code issue was written into another organization (%s)', outcome);
  outcome := checks.error_of(format(
    $q$insert into public.analysis_test_recommendations (organization_id, analysis_id, position,
         kind, title, description, rationale, priority, status, confidence)
       values ('org_first', %L, 9, 'suggested_scenario', 't', 'd', 'r', 'low', 'suggested', 'low')$q$,
    analysis));
  assert outcome = '42501', format('a test recommendation was written into another organization (%s)', outcome);
end;
$$;

-- ── And the first organization still has all of it ─────────────────────────
select checks.act_as(:'first');

do $$
begin
  assert (select count(*) from public.analyses) = 3, 'the first organization lost sight of its analyses';
  assert (select count(*) from public.analysis_files) = 4, 'the first organization lost sight of its files';
end;
$$;

reset role;
