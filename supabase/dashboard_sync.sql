-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
create table if not exists public.dashboard_docs (
  owner text not null,
  kind text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner, kind, id)
);

-- Lock the table: only the dashboard's server (service role key) can read or write it.
alter table public.dashboard_docs enable row level security;
