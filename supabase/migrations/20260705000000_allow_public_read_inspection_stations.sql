alter table inspection_stations enable row level security;

drop policy if exists "Allow public read access" on inspection_stations;

create policy "Allow public read access"
  on inspection_stations
  for select
  to anon, authenticated
  using (true);
