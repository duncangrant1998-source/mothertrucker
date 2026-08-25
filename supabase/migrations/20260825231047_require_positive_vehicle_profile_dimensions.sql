-- Completes what 20260825230612 started. NOT NULL stopped a missing dimension
-- but not a zero or negative one, which is the more dangerous case: Map.jsx
-- reads `profile?.height || 4`, so a stored 0 is falsy and gets silently
-- replaced by the generic 4m / 25t default. A driver with a zeroed profile
-- would be routed as though those defaults were their real truck, with nothing
-- on screen to say so.
--
-- The form already rejects zero and negative (findMissingDimensions in
-- src/lib/vehicleProfile.js). This makes it true regardless of caller.
--
-- Safe to apply: verified beforehand that no existing row violates it.
--
-- One constraint rather than four per-column ones: Postgres includes a
-- "Failing row contains (...)" DETAIL line on violation, so the offending
-- column is still identifiable from the error.

alter table public.vehicle_profiles
  add constraint vehicle_profiles_dimensions_positive
  check (height > 0 and width > 0 and length > 0 and weight > 0);
