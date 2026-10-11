-- The few things a Supabase project provides that the migrations rely on,
-- reduced to what a plain local Postgres needs for them to apply and be
-- checked. Used only by supabase/tests/run.sh, never against a real project.

-- The session token's claims, as PostgREST exposes them to a request.
create schema auth;
create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
grant usage on schema auth to authenticated;

-- Realtime Broadcast: sent messages land in a table, so a test can read what
-- a trigger sent, and the topic a subscriber is joining is a session setting.
create schema realtime;
create table realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null,
  extension text not null default 'broadcast',
  event text,
  payload jsonb,
  private boolean
);
alter table realtime.messages enable row level security;

create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void
language sql
as $$
  insert into realtime.messages (topic, event, payload, private)
  values (send.topic, send.event, send.payload, send.private);
$$;

create function realtime.topic()
returns text
language sql
stable
as $$
  select nullif(current_setting('realtime.topic', true), '');
$$;

grant usage on schema realtime to authenticated;
grant select on realtime.messages to authenticated;
