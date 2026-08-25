// Pure helpers for the vehicle profile form, kept out of the component so the
// rules deciding what reaches the routing engine can be tested on their own.

// The dimensions HERE routes on. All four are required before a profile can be
// saved: Map.jsx substitutes generic defaults (4m, 25t) for anything unset, so
// a driver who saved a blank field would be routed as though those defaults
// were their real truck — plausible-looking, and wrong in the direction that
// puts an oversize load under a low bridge. Single source of truth for both
// the rendered inputs and the validation, so the two can't drift.
export const DIMENSION_FIELDS = [
  { label: 'Height (m)', name: 'height' },
  { label: 'Width (m)', name: 'width' },
  { label: 'Length (m)', name: 'length' },
  { label: 'Weight (kg)', name: 'weight' }
];

export const NUMERIC_FIELDS = DIMENSION_FIELDS.map((f) => f.name);

// A type="number" input hands back '' both for an empty field and for content
// the browser can't parse, and Postgres rejects '' for a numeric column with a
// raw driver error ("invalid input syntax for type numeric") that used to
// surface verbatim in the save message. Validation catches that case first
// now, but this still guards the payload.
export const toNumericOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

// Inverse, for the trip back out of the database: a NULL column would make a
// controlled input flip to uncontrolled and warn, so it becomes '' again.
// Rows saved before dimensions were required can still hold NULL.
export const toFieldValue = (value) => (value === null || value === undefined ? '' : value);

// A dimension has to be a real positive measurement: null means the field was
// left blank (or held something unparseable), and zero or negative is not a
// truck. Returns the offending fields so the driver is told which ones.
export const findMissingDimensions = (profile) =>
  DIMENSION_FIELDS.filter(({ name }) => {
    const value = toNumericOrNull(profile[name]);
    return value === null || value <= 0;
  });
