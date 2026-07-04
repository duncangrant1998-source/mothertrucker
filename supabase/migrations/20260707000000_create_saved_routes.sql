create extension if not exists pgcrypto;

create table if not exists saved_routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route_name text not null,
  start_location text not null,
  end_location text not null,
  start_lat double precision not null,
  start_lng double precision not null,
  end_lat double precision not null,
  end_lng double precision not null,
  distance double precision,
  duration double precision,
  load_count integer not null default 0,
  last_used timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists saved_routes_user_id_idx on saved_routes (user_id);

alter table saved_routes enable row level security;

drop policy if exists "Users manage their own saved routes" on saved_routes;

create policy "Users manage their own saved routes"
  on saved_routes
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
