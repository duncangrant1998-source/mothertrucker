alter table vehicle_profiles
  add column if not exists speed_unit text not null default 'auto';
