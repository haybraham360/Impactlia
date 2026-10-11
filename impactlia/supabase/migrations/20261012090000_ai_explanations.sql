-- Phase 11: AI explanations, their cache and their trace.
--
-- Two tables. ai_results is the cache: what a model wrote, kept under a hash
-- of exactly what it was given. ai_runs is the trace: one row for every
-- request, whether a model was called or the cache answered.
--
-- Neither changes the analysis. A suggested role lives here and nowhere else:
-- the parser output, its edges and its routes are never written from this
-- phase's code.
--
-- Writes are made with the signed-in member's token and decided by the
-- policies below. Rows are inserted once and never updated, so there is no
-- UPDATE grant.

create type public.ai_task as enum (
  'file-explanation',
  'folder-explanation',
  'role-classification'
);

-- What the cache did for one request. 'read-failed' and 'write-failed' are
-- cache failures: the request carried on to the model, or kept its answer, but
-- the cache did not do its part.
create type public.ai_cache_status as enum ('hit', 'miss', 'read-failed', 'write-failed');

-- 'input-failed': what the model needed could not be assembled, so it was not
-- called. 'model-failed': the call itself failed. 'rejected': the model
-- answered and the answer did not pass validation.
create type public.ai_run_outcome as enum ('succeeded', 'input-failed', 'model-failed', 'rejected');

create table public.ai_results (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  repository_id uuid not null,
  -- The cache's namespace: a file explanation and a folder explanation never
  -- answer for each other.
  task public.ai_task not null,
  -- The file's path, or the folder's ('' is the repository root).
  subject text not null check (char_length(subject) <= 1000),
  -- SHA-256 of the whole input: the evidence, the commit, the prompt version
  -- and the model. The same hash means the same question.
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  -- The exact model and prompt that produced this, so a result can be traced
  -- to what wrote it without storing the source it read.
  model text not null check (char_length(model) between 1 and 100),
  prompt_version text not null check (char_length(prompt_version) between 1 and 50),
  -- The commit of the analysis the evidence came from. Null when that
  -- analysis's archive did not state one.
  source_sha text check (source_sha ~ '^[0-9a-f]{40}$'),
  -- What the result depends on, kept apart so a result that no longer matches
  -- can say which part changed.
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  context_hash text not null check (context_hash ~ '^[0-9a-f]{64}$'),
  body text not null check (char_length(body) between 1 and 20000),
  -- What was left out of the input for size, in words.
  omitted text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint ai_results_repository_fkey
    foreign key (repository_id, organization_id)
    references public.repositories (id, organization_id) on delete cascade,
  -- Scoped to the repository, which belongs to one organization, so a result
  -- can never answer for another repository or another tenant.
  constraint ai_results_one_per_input unique (repository_id, task, input_hash),
  -- The only roles a model may suggest. None of them is structural: a model
  -- can never make a file a page, a route or a controller.
  constraint ai_results_role_is_allowed
    check (
      task <> 'role-classification'
      or body in ('service', 'repository', 'model', 'util', 'config', 'component', 'hook')
    )
);

create index ai_results_repository_created_idx
  on public.ai_results (repository_id, organization_id, created_at desc);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  repository_id uuid not null,
  task public.ai_task not null,
  subject text not null check (char_length(subject) <= 1000),
  model text not null check (char_length(model) between 1 and 100),
  prompt_version text not null check (char_length(prompt_version) between 1 and 50),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  cache_status public.ai_cache_status not null,
  outcome public.ai_run_outcome not null,
  model_called boolean not null,
  -- Null means the provider did not say. Zero means none were used.
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  -- A short description of what went wrong. Never a provider's message, a
  -- key, or anything read from a repository.
  error_summary text check (char_length(error_summary) <= 300),
  -- Whether this run was also sent to the external tracing service.
  external_trace boolean not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  constraint ai_runs_repository_fkey
    foreign key (repository_id, organization_id)
    references public.repositories (id, organization_id) on delete cascade,
  constraint ai_runs_hit_calls_no_model
    check (cache_status <> 'hit' or not model_called),
  -- A run that called no model used no tokens, and says so with zeros rather
  -- than leaving it unknown.
  constraint ai_runs_no_call_means_zero_tokens
    check (model_called or (input_tokens = 0 and output_tokens = 0)),
  constraint ai_runs_error_matches_outcome
    check ((outcome = 'succeeded') = (error_summary is null))
);

create index ai_runs_organization_started_idx
  on public.ai_runs (organization_id, started_at desc);

alter table public.ai_results enable row level security;
alter table public.ai_runs enable row level security;

revoke all on public.ai_results, public.ai_runs from anon, authenticated;
grant select, insert on public.ai_results, public.ai_runs to authenticated;

create policy "Members read their organization's AI results"
  on public.ai_results for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

create policy "Members store AI results for their organization"
  on public.ai_results for insert to authenticated
  with check (organization_id = (select public.requesting_organization_id()));

create policy "Members read their organization's AI runs"
  on public.ai_runs for select to authenticated
  using (organization_id = (select public.requesting_organization_id()));

create policy "Members record AI runs for their organization"
  on public.ai_runs for insert to authenticated
  with check (organization_id = (select public.requesting_organization_id()));
