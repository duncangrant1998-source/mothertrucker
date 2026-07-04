create table if not exists inspection_stations (
  id text primary key,
  name text,
  highway text,
  direction text,
  region text,
  latitude double precision,
  longitude double precision,
  phone text,
  information text,
  created_at timestamptz not null default now()
);

create index if not exists inspection_stations_lat_lng_idx
  on inspection_stations (latitude, longitude);
