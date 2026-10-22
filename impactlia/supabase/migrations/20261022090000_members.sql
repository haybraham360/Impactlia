-- One row per person who has used Impactlia, keyed by their Clerk user id.
--
-- Clerk owns identity: email, name, sign-in methods and sessions stay there.
-- This row records only that a verified Clerk user reached the workspace,
-- which workspace they started in, and when, so that "has this person been
-- set up" is a fact in the database rather than something inferred.
--
-- Written once, on the first visit to the start page after sign-in, with the
-- member's own session token. The policies tie the row to the token's own
-- user id and organization, so no one can create or read a row for anyone
-- else, whatever a request says.

-- The user the request is acting as, from the signed session token.
create function public.requesting_user_id()
returns text
language sql
stable
set search_path = ''
as $$
  select auth.jwt() ->> 'sub';
$$;

revoke execute on function public.requesting_user_id() from public, anon;
grant execute on function public.requesting_user_id() to authenticated;

create table public.members (
  -- Clerk's user id, which never changes for an account.
  user_id text primary key check (user_id ~ '^user_[A-Za-z0-9]{1,64}$'),
  -- The workspace this person started in. Null once that organization is
  -- deleted; the person's row stays.
  organization_id text references public.organizations (id) on delete set null,
  created_at timestamptz not null default now()
);

create index members_organization_idx on public.members (organization_id);

alter table public.members enable row level security;
revoke all on public.members from anon, authenticated;
-- No update or delete: the row is a record of the first visit and does not
-- change. A repeated sign-in inserts nothing.
grant select, insert on public.members to authenticated;

create policy "Members read their own row"
  on public.members for select to authenticated
  using (user_id = (select public.requesting_user_id()));

create policy "Members record themselves in their current organization"
  on public.members for insert to authenticated
  with check (
    user_id = (select public.requesting_user_id())
    and organization_id = (select public.requesting_organization_id())
  );
