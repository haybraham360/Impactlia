-- Development seed: sample analysis data for two organizations, to prove that
-- each one sees only its own rows.
--
-- None of this is a real analysis. Every row hangs off a repository with
-- is_seed = true, and the dashboard labels those rows "Sample data".
--
-- Set the two organization ids below (the Overview page shows the current
-- one), then run this file with a privileged role. It can be run again: it
-- replaces the seeded rows for these two organizations and touches nothing
-- else.

do $$
declare
  first_organization constant text := 'org_3KQWR4tjzUGQ0FtBnNCjeFcaNgB';
  second_organization constant text := 'org_3KQcR8ktFNCE2blqDzw0vj4DQYJ';

  repository uuid;
  pull_request uuid;
  analysis uuid;
  changed_file uuid;
  affected_file uuid;
  dependency uuid;
  risk_signal uuid;
  recommendation uuid;
begin
  if first_organization like 'REPLACE_%' or second_organization like 'REPLACE_%' then
    raise exception 'Set both organization ids at the top of seed.sql before running it.';
  end if;
  if first_organization = second_organization then
    raise exception 'The two organization ids must be different.';
  end if;

  insert into public.organizations (id)
  values (first_organization), (second_organization)
  on conflict (id) do nothing;

  delete from public.repositories
  where is_seed
    and organization_id in (first_organization, second_organization);

  -- First organization: one run in each state.
  insert into public.repositories
    (organization_id, provider, provider_repository_id, owner, name, default_branch, is_seed)
  values
    (first_organization, 'github', 'seed-1', 'sample-org', 'storefront', 'main', true)
  returning id into repository;

  insert into public.pull_requests
    (organization_id, repository_id, number, title, author_login, base_ref, head_ref)
  values
    (first_organization, repository, 41, 'Move price formatting into a shared module', 'sample-author', 'main', 'shared-price-format')
  returning id into pull_request;

  insert into public.analyses
    (organization_id, pull_request_id, status, head_sha, changed_file_count, affected_file_count, risk_level, created_at, started_at, completed_at)
  values
    (first_organization, pull_request, 'completed', '0000000000000000000000000000000000000001', 1, 1, 'medium',
     now() - interval '3 hours', now() - interval '3 hours', now() - interval '2 hours 58 minutes')
  returning id into analysis;

  insert into public.analysis_files
    (organization_id, analysis_id, path, kind, change_type, additions, deletions)
  values
    (first_organization, analysis, 'src/lib/price.ts', 'changed', 'modified', 24, 9)
  returning id into changed_file;

  insert into public.analysis_files
    (organization_id, analysis_id, path, kind, impact_depth)
  values
    (first_organization, analysis, 'src/components/cart-total.tsx', 'affected', 1)
  returning id into affected_file;

  insert into public.analysis_dependencies
    (organization_id, analysis_id, source_file_id, target_file_id, kind)
  values
    (first_organization, analysis, affected_file, changed_file, 'import')
  returning id into dependency;

  insert into public.analysis_risk_signals
    (organization_id, analysis_id, signal, level, detail)
  values
    (first_organization, analysis, 'shared_module_changed', 'medium', '{"dependents": 1}')
  returning id into risk_signal;

  insert into public.analysis_recommendations
    (organization_id, analysis_id, position, body, origin)
  values
    (first_organization, analysis, 1, 'Review src/components/cart-total.tsx, which imports the changed module.', 'deterministic')
  returning id into recommendation;

  insert into public.analysis_evidence
    (organization_id, analysis_id, risk_signal_id, recommendation_id, file_id, dependency_id)
  values
    (first_organization, analysis, risk_signal, null, null, dependency),
    (first_organization, analysis, null, recommendation, affected_file, null);

  insert into public.pull_requests
    (organization_id, repository_id, number, title, author_login, base_ref, head_ref)
  values
    (first_organization, repository, 42, 'Add retry to the checkout client', 'sample-author', 'main', 'checkout-retry')
  returning id into pull_request;

  insert into public.analyses
    (organization_id, pull_request_id, status, head_sha, created_at, started_at)
  values
    (first_organization, pull_request, 'running', '0000000000000000000000000000000000000002',
     now() - interval '4 minutes', now() - interval '3 minutes');

  insert into public.pull_requests
    (organization_id, repository_id, number, title, author_login, base_ref, head_ref)
  values
    (first_organization, repository, 43, 'Rename the session cookie', 'sample-reviewer', 'main', 'session-cookie-name')
  returning id into pull_request;

  insert into public.analyses
    (organization_id, pull_request_id, status, head_sha, failure_reason, created_at, started_at, completed_at)
  values
    (first_organization, pull_request, 'failed', '0000000000000000000000000000000000000003',
     'Sample failure: the repository could not be read.',
     now() - interval '1 day', now() - interval '1 day', now() - interval '1 day' + interval '20 seconds');

  insert into public.pull_requests
    (organization_id, repository_id, number, title, author_login, base_ref, head_ref)
  values
    (first_organization, repository, 44, 'Update the order confirmation email', 'sample-reviewer', 'main', 'order-email')
  returning id into pull_request;

  insert into public.analyses
    (organization_id, pull_request_id, status, head_sha, created_at)
  values
    (first_organization, pull_request, 'pending', '0000000000000000000000000000000000000004', now() - interval '1 minute');

  -- Second organization: different repository, different runs.
  insert into public.repositories
    (organization_id, provider, provider_repository_id, owner, name, default_branch, is_seed)
  values
    (second_organization, 'github', 'seed-2', 'sample-org', 'billing-service', 'main', true)
  returning id into repository;

  insert into public.pull_requests
    (organization_id, repository_id, number, title, author_login, base_ref, head_ref)
  values
    (second_organization, repository, 7, 'Round invoice totals in one place', 'sample-author', 'main', 'invoice-rounding')
  returning id into pull_request;

  insert into public.analyses
    (organization_id, pull_request_id, status, head_sha, changed_file_count, affected_file_count, risk_level, created_at, started_at, completed_at)
  values
    (second_organization, pull_request, 'completed', '0000000000000000000000000000000000000005', 1, 1, 'high',
     now() - interval '5 hours', now() - interval '5 hours', now() - interval '4 hours 57 minutes')
  returning id into analysis;

  insert into public.analysis_files
    (organization_id, analysis_id, path, kind, change_type, additions, deletions)
  values
    (second_organization, analysis, 'src/invoices/rounding.ts', 'changed', 'added', 31, 0)
  returning id into changed_file;

  insert into public.analysis_files
    (organization_id, analysis_id, path, kind, impact_depth)
  values
    (second_organization, analysis, 'src/invoices/total.ts', 'affected', 1)
  returning id into affected_file;

  insert into public.analysis_dependencies
    (organization_id, analysis_id, source_file_id, target_file_id, kind)
  values
    (second_organization, analysis, affected_file, changed_file, 'import')
  returning id into dependency;

  insert into public.analysis_risk_signals
    (organization_id, analysis_id, signal, level, detail)
  values
    (second_organization, analysis, 'billing_path_changed', 'high', '{"dependents": 1}')
  returning id into risk_signal;

  insert into public.analysis_recommendations
    (organization_id, analysis_id, position, body, origin)
  values
    (second_organization, analysis, 1, 'Review src/invoices/total.ts, which imports the new module.', 'deterministic')
  returning id into recommendation;

  insert into public.analysis_evidence
    (organization_id, analysis_id, risk_signal_id, recommendation_id, file_id, dependency_id)
  values
    (second_organization, analysis, risk_signal, null, null, dependency),
    (second_organization, analysis, null, recommendation, affected_file, null);

  insert into public.pull_requests
    (organization_id, repository_id, number, title, author_login, base_ref, head_ref)
  values
    (second_organization, repository, 8, 'Remove the legacy tax table', 'sample-author', 'main', 'drop-legacy-tax')
  returning id into pull_request;

  insert into public.analyses
    (organization_id, pull_request_id, status, head_sha, created_at)
  values
    (second_organization, pull_request, 'pending', '0000000000000000000000000000000000000006', now() - interval '2 minutes');
end
$$;
