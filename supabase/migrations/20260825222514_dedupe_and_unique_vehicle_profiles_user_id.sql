-- One vehicle profile per driver.
--
-- VehicleProfile.jsx's upsert resolved conflicts on the primary key (id).
-- `id` defaults to gen_random_uuid() and was absent from the client payload
-- unless a profile had been loaded, so it never collided and every save
-- appended a row. Once a driver had two rows the .single() load failed, the
-- app fell back to Map.jsx's generic default dimensions, and routing stopped
-- using their real truck. Nothing enforced one-row-per-driver in the database,
-- so the condition compounded silently on every subsequent save.

-- Keep the most recent profile per driver, drop the older duplicates.
delete from public.vehicle_profiles p
using (
  select id,
         row_number() over (
           partition by user_id
           order by updated_at desc nulls last, created_at desc nulls last, id desc
         ) as rn
  from public.vehicle_profiles
) ranked
where p.id = ranked.id
  and ranked.rn > 1;

-- Makes the invariant real, and gives the upsert a conflict target so it can
-- locate an existing row by user_id instead of depending on `id` being present
-- in client state.
alter table public.vehicle_profiles
  add constraint vehicle_profiles_user_id_key unique (user_id);
