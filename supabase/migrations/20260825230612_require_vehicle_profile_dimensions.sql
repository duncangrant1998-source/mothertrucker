-- The four dimensions HERE routes on are already mandatory in the form
-- (findMissingDimensions in src/lib/vehicleProfile.js), but the database would
-- still have accepted a NULL from any other caller. This moves the guarantee
-- off the client, where it can't be bypassed or drift.
--
-- Safe to apply: verified beforehand that no existing row holds a NULL in any
-- of these columns. Rows written before dimensions were required could have,
-- but none survived the dedupe in 20260825222514.
--
-- Note this does not rule out a zero or negative dimension — the form rejects
-- those, the database still would not. Map.jsx treats 0 as falsy and would
-- substitute its generic default, same as it does for a missing profile.

alter table public.vehicle_profiles
  alter column height set not null,
  alter column width set not null,
  alter column length set not null,
  alter column weight set not null;
