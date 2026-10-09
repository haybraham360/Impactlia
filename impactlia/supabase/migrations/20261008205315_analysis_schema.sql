-- Phase 2: the tables behind repository → pull request → analysis run →
-- results, and the policies that keep each organization to its own rows.
--
-- Ownership. Every table carries organization_id itself, so every policy is
-- the same single comparison against the token's organization claim and never
-- a join. Children reference their parent with a composite key that includes
-- organization_id, which makes it impossible for a row to sit under a parent
-- from a different organization. Deleting an organization cascades through
-- everything it owns.
--
-- Writes. Nothing in the application writes these tables yet, so there are
-- only SELECT policies and only a SELECT grant. The phase that adds a writer
-- adds its policy.

-- The organization the request is acting as, read from the signed session
-- token. Clerk names the claim differently across its two token versions; both
-- are signed by Clerk, so reading either is safe.
create function public.requesting_organization_id()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id');
$$;

revoke execute on function public.requesting_organization_id() from public, anon;
grant execute on function public.requesting_organization_id() to authenticated;

create type public.source_control_provider as enum ('github');
create type public.analysis_status as enum ('pending', 'running', 'completed', 'failed');
create type public.risk_level as enum ('low', 'medium', 'high');
-- Changed: modified by the pull request itself. Affected: reachable from a
-- changed file through repository relationships. Never the same thing.
create type public.analysis_file_kind as enum ('changed', 'affected');
create type public.file_change_type as enum ('added', 'modified', 'removed', 'renamed');
-- Whether a recommendation was computed from the analysis or written by AI.
create type public.finding_origin as enum ('deterministic', 'ai');

-- Identity lives with the identity provider; this row exists so everything an
-- organization owns hangs off one key. id is the provider's organization id.
create table public.organizations (
  id text primary key,
  created_at timestamptz not null default now()
);

create table public.repositories (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  provider public.source_control_provider not null,
  -- The provider's own stable id, which survives a rename or transfer.
  provider_repository_id text not null,
  owner text not null,
  name text not null,
  default_branch text not null,
  -- Development seed data. Everything under a seeded repository is sample
  -- data and is labelled as such wherever it is shown.
  is_seed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, provider, provider_repository_id)
);

create table public.pull_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  repository_id uuid not null,
  number integer not null check (number > 0),
  title text not null,
  author_login text not null,
  base_ref text not null,
  head_ref text not null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (repository_id, number),
  foreign key (repository_id, organization_id)
    references public.repositories (id, organization_id) on delete cascade
);

create index pull_requests_repository_owner_idx
  on public.pull_requests (repository_id, organization_id);

-- One analysis run of one pull request at one commit. A pull request's
-- analysis state is the state of its latest run; it is not stored twice.
create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  pull_request_id uuid not null,
  status public.analysis_status not null default 'pending',
  -- The commit that was analyzed, so a run can be reproduced.
  head_sha text not null,
  -- Summary results. Present only once the run has completed.
  changed_file_count integer check (changed_file_count >= 0),
  affected_file_count integer check (affected_file_count >= 0),
  risk_level public.risk_level,
  failure_reason text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (id, organization_id),
  foreign key (pull_request_id, organization_id)
    references public.pull_requests (id, organization_id) on delete cascade,
  constraint analyses_started_matches_status
    check ((status = 'pending') = (started_at is null)),
  constraint analyses_finished_matches_status
    check ((status in ('completed', 'failed')) = (completed_at is not null)),
  constraint analyses_failure_reason_matches_status
    check ((status = 'failed') = (failure_reason is not null)),
  constraint analyses_summary_only_when_completed
    check (
      case
        when status = 'completed'
          then changed_file_count is not null and affected_file_count is not null
        else changed_file_count is null
          and affected_file_count is null
          and risk_level is null
      end
    )
);

create index analyses_organization_created_idx
  on public.analyses (organization_id, created_at desc);
create index analyses_pull_request_owner_idx
  on public.analyses (pull_request_id, organization_id);

-- The files in a run's impact set. A file appears once per run: either the
-- pull request changed it, or it is affected through a dependency.
create table public.analysis_files (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null,
  path text not null,
  kind public.analysis_file_kind not null,
  change_type public.file_change_type,
  additions integer check (additions >= 0),
  deletions integer check (deletions >= 0),
  -- Shortest number of dependency steps from a changed file. 1 is a direct
  -- dependent.
  impact_depth integer check (impact_depth >= 1),
  unique (id, analysis_id, organization_id),
  unique (analysis_id, path),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  constraint analysis_files_columns_match_kind
    check (
      case kind
        when 'changed'
          then change_type is not null and impact_depth is null
        else impact_depth is not null
          and change_type is null
          and additions is null
          and deletions is null
      end
    )
);

create index analysis_files_analysis_owner_idx
  on public.analysis_files (analysis_id, organization_id);

-- A relationship found in the repository: source depends on target. Both ends
-- must be files of the same run.
create table public.analysis_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null,
  source_file_id uuid not null,
  target_file_id uuid not null,
  -- How the relationship is expressed in the source language (an import, a
  -- re-export, …). Left open because it differs per language.
  kind text not null,
  unique (id, analysis_id, organization_id),
  unique (analysis_id, source_file_id, target_file_id, kind),
  check (source_file_id <> target_file_id),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  foreign key (source_file_id, analysis_id, organization_id)
    references public.analysis_files (id, analysis_id, organization_id) on delete cascade,
  foreign key (target_file_id, analysis_id, organization_id)
    references public.analysis_files (id, analysis_id, organization_id) on delete cascade
);

create index analysis_dependencies_analysis_owner_idx
  on public.analysis_dependencies (analysis_id, organization_id);
create index analysis_dependencies_source_idx
  on public.analysis_dependencies (source_file_id, analysis_id, organization_id);
create index analysis_dependencies_target_idx
  on public.analysis_dependencies (target_file_id, analysis_id, organization_id);

-- One identifiable reason a run got its risk level.
create table public.analysis_risk_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null,
  -- Which signal this is, as named by the analysis methodology.
  signal text not null,
  level public.risk_level not null,
  -- The measurements behind the signal. They differ per signal.
  detail jsonb not null default '{}'::jsonb,
  unique (id, analysis_id, organization_id),
  unique (analysis_id, signal),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade
);

create index analysis_risk_signals_analysis_owner_idx
  on public.analysis_risk_signals (analysis_id, organization_id);

create table public.analysis_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null,
  position integer not null check (position >= 1),
  body text not null,
  origin public.finding_origin not null,
  unique (id, analysis_id, organization_id),
  unique (analysis_id, position),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade
);

create index analysis_recommendations_analysis_owner_idx
  on public.analysis_recommendations (analysis_id, organization_id);

-- Why a signal or recommendation exists: it points at the file or the
-- dependency in this run that supports it.
create table public.analysis_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null,
  risk_signal_id uuid,
  recommendation_id uuid,
  file_id uuid,
  dependency_id uuid,
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  foreign key (risk_signal_id, analysis_id, organization_id)
    references public.analysis_risk_signals (id, analysis_id, organization_id) on delete cascade,
  foreign key (recommendation_id, analysis_id, organization_id)
    references public.analysis_recommendations (id, analysis_id, organization_id) on delete cascade,
  foreign key (file_id, analysis_id, organization_id)
    references public.analysis_files (id, analysis_id, organization_id) on delete cascade,
  foreign key (dependency_id, analysis_id, organization_id)
    references public.analysis_dependencies (id, analysis_id, organization_id) on delete cascade,
  constraint analysis_evidence_supports_one_finding
    check (num_nonnulls(risk_signal_id, recommendation_id) = 1),
  constraint analysis_evidence_points_at_one_thing
    check (num_nonnulls(file_id, dependency_id) = 1)
);

create index analysis_evidence_analysis_owner_idx
  on public.analysis_evidence (analysis_id, organization_id);
create index analysis_evidence_risk_signal_idx
  on public.analysis_evidence (risk_signal_id, analysis_id, organization_id);
create index analysis_evidence_recommendation_idx
  on public.analysis_evidence (recommendation_id, analysis_id, organization_id);
create index analysis_evidence_file_idx
  on public.analysis_evidence (file_id, analysis_id, organization_id);
create index analysis_evidence_dependency_idx
  on public.analysis_evidence (dependency_id, analysis_id, organization_id);

-- Row-level security on every table, and read access for signed-in requests
-- only. The claim is wrapped in a select so it is evaluated once per query
-- rather than once per row.
alter table public.organizations enable row level security;
alter table public.repositories enable row level security;
alter table public.pull_requests enable row level security;
alter table public.analyses enable row level security;
alter table public.analysis_files enable row level security;
alter table public.analysis_dependencies enable row level security;
alter table public.analysis_risk_signals enable row level security;
alter table public.analysis_recommendations enable row level security;
alter table public.analysis_evidence enable row level security;

revoke all on
  public.organizations,
  public.repositories,
  public.pull_requests,
  public.analyses,
  public.analysis_files,
  public.analysis_dependencies,
  public.analysis_risk_signals,
  public.analysis_recommendations,
  public.analysis_evidence
from anon, authenticated;

grant select on
  public.organizations,
  public.repositories,
  public.pull_requests,
  public.analyses,
  public.analysis_files,
  public.analysis_dependencies,
  public.analysis_risk_signals,
  public.analysis_recommendations,
  public.analysis_evidence
to authenticated;

create policy "Members read their own organization"
  on public.organizations for select to authenticated
  using (id = (select public.requesting_organization_id()));

create policy "Members read their organization's repositories"
  on public.repositories for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

create policy "Members read their organization's pull requests"
  on public.pull_requests for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

create policy "Members read their organization's analyses"
  on public.analyses for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

create policy "Members read their organization's analysis files"
  on public.analysis_files for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

create policy "Members read their organization's analysis dependencies"
  on public.analysis_dependencies for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

create policy "Members read their organization's risk signals"
  on public.analysis_risk_signals for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

create policy "Members read their organization's recommendations"
  on public.analysis_recommendations for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

create policy "Members read their organization's evidence"
  on public.analysis_evidence for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));
