// Pure geodesy for route matching, heading derivation and the nav camera.
//
// Extracted out of Map.jsx so it can be exercised by unit tests without a
// browser, a HERE SDK global, or a phone in a moving vehicle — the matching
// bugs these functions carry are invisible on surface streets and only show
// up at highway vertex spacing, which is the worst possible place to be
// debugging by eye.
//
// Everything here works in WGS84 degrees and metres. Nothing in this file
// touches the DOM, React, or `H`.

const EARTH_RADIUS_M = 6371000;

export const toRad = (deg) => (deg * Math.PI) / 180;
export const toDeg = (rad) => (rad * 180) / Math.PI;

export const haversineMeters = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

// Initial great-circle bearing from `from` to `to`, in degrees clockwise from
// true north — the standard forward azimuth. Argument order matters: this is
// the direction you would travel to get *from* the first argument *to* the
// second, so a caller passing (current, previous) gets a bearing 180 degrees
// from the direction of travel.
export const bearingDegrees = (from, to) => {
  const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
  const x = Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

export const normalizeDegrees = (deg) => ((deg % 360) + 360) % 360;

// Signed shortest angular step from `from` to `to`, in (-180, 180] — used to
// interpolate headings across the 359 to 1 wraparound without spinning the
// long way round.
export const shortestAngleDelta = (from, to) => ((to - from + 540) % 360) - 180;

// Geodesic destination point: where you end up starting at `origin` and
// travelling `meters` along a constant initial bearing. Used by the on-screen
// camera diagnostic to place a marker at a known bearing from the truck.
export const destPoint = (origin, bearingDeg, meters) => {
  const angular = meters / EARTH_RADIUS_M;
  const theta = toRad(bearingDeg);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(theta)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(theta) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { lat: toDeg(lat2), lng: normalizeDegrees(toDeg(lng2) + 180) - 180 };
};

// HERE's ILookAtData.heading is the azimuth from the look-at point *toward
// the camera* — where the camera sits relative to the driver — not the
// direction the camera faces. The SDK documents neither, and getLookAtData()
// echoes back whatever was set, so nothing short of measuring the rendered
// projection distinguishes the two conventions.
//
// Measured on-vehicle across eight samples spanning 0 to 178 degrees, at a
// standstill with the heading pinned and at 112 km/h with it live: the
// rendered screen-up bearing came back as the requested heading plus exactly
// 180, every frame, with no dependence on speed, tilt or zoom.
//
//   requested   0  ->  drawn 180        requested 103  ->  drawn 283
//   requested  90  ->  drawn 270        requested 178  ->  drawn 358
//
// A chase camera that wants the direction of travel at the top of the screen
// therefore has to place the camera *behind* the driver, which is this
// conversion. Nothing upstream of it is inverted — the bearing maths is the
// textbook forward azimuth and is unit-tested as such. This is a unit
// conversion at the SDK boundary, and it lives here, named, rather than being
// folded into the heading pipeline where it would read as a sign error and
// invite someone to "fix" it back.
export const cameraHeadingForTravel = (travelHeadingDeg) => normalizeDegrees(travelHeadingDeg + 180);

// Local equirectangular projection to metres, centred on `refLat`. Over the
// hundreds of metres a single route segment spans, the error against a proper
// geodesic is well under a metre — far below the 50m reroute threshold these
// numbers feed — and it makes the point-to-segment algebra below trivial.
const projectMeters = (p, refLat, cosRefLat) => ({
  x: toRad(p.lng) * cosRefLat * EARTH_RADIUS_M,
  y: toRad(p.lat) * EARTH_RADIUS_M
});

// Perpendicular distance from `p` to the segment a->b, plus how far along
// that segment (0..1) the closest point lies.
//
// This is the distinction that matters on a motorway. HERE's flexible
// polyline only emits a vertex where the road actually changes direction, so
// a straight stretch of the QEW can run several hundred metres between
// consecutive vertices. A vehicle sitting exactly on the centreline halfway
// along such a segment is ~0m from the *route* but can be 150m+ from the
// nearest *vertex* — which is enough to trip an off-route reroute on a truck
// that never left its lane.
export const pointToSegment = (p, a, b) => {
  const cosRefLat = Math.cos(toRad(p.lat));
  const pp = projectMeters(p, p.lat, cosRefLat);
  const pa = projectMeters(a, p.lat, cosRefLat);
  const pb = projectMeters(b, p.lat, cosRefLat);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const lengthSq = dx * dx + dy * dy;
  // A zero-length segment (duplicate vertices do occur in HERE geometry)
  // degrades to a plain point distance rather than dividing by zero.
  const t = lengthSq > 0
    ? Math.max(0, Math.min(1, ((pp.x - pa.x) * dx + (pp.y - pa.y) * dy) / lengthSq))
    : 0;
  const cx = pa.x + t * dx;
  const cy = pa.y + t * dy;
  return { distance: Math.hypot(pp.x - cx, pp.y - cy), t };
};

export const buildCumulativeDistances = (points) => {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineMeters(points[i - 1], points[i]));
  }
  return cumulative;
};

// Matches a GPS fix onto the route polyline.
//
// Searches a window around `fromIndex` (the driver's last known position on
// the route) rather than the whole polyline, since fixes arrive about once a
// second and the driver can only have moved a short way along it. The five
// vertices of slack behind `fromIndex` absorb GPS jitter and a fix that lands
// just short of where the last one matched.
//
// Returns:
//   index     — the start vertex of the closest *segment*. Still monotonic
//               along the route, so it remains usable as the next call's
//               window anchor and for span/station lookups.
//   distance  — perpendicular metres to the route itself, not to a vertex.
//   travelled — metres along the route at the matched point, interpolated
//               within the segment. Previously this was cumulative[index],
//               which on sparse geometry jumped in multi-hundred-metre steps
//               and made the remaining-distance readout lurch.
export const matchToRoute = (points, cumulative, lat, lng, fromIndex = 0, window = points.length) => {
  const p = { lat, lng };
  const start = Math.max(0, Math.min(points.length - 1, fromIndex - 5));
  const end = Math.min(points.length - 1, fromIndex + window);

  // Fewer than two vertices in the window leaves no segment to project onto.
  if (end <= start) {
    return {
      index: start,
      distance: haversineMeters(p, points[start]),
      travelled: cumulative?.[start] ?? 0
    };
  }

  let bestIndex = start;
  let bestDistance = Infinity;
  let bestT = 0;
  for (let i = start; i < end; i++) {
    const { distance, t } = pointToSegment(p, points[i], points[i + 1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      bestT = t;
    }
  }

  const segmentLength = cumulative ? cumulative[bestIndex + 1] - cumulative[bestIndex] : 0;
  return {
    index: bestIndex,
    distance: bestDistance,
    travelled: (cumulative?.[bestIndex] ?? 0) + segmentLength * bestT
  };
};

// The point sitting `distance` metres along the route, interpolated inside
// whichever segment contains it rather than snapped to a vertex.
//
// Snapping is what made a vertex-based heading lookahead degenerate on
// motorways: asking for "the first vertex at least 15m ahead" returns the far
// end of a 400m straight, and asking again for the origin returns the same
// vertex, so the two points coincide and yield no bearing at all.
export const pointAtDistance = (points, cumulative, distance) => {
  const total = cumulative[cumulative.length - 1];
  const target = Math.max(0, Math.min(total, distance));
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(1, lo);
  const segmentLength = cumulative[i] - cumulative[i - 1];
  const t = segmentLength > 0 ? (target - cumulative[i - 1]) / segmentLength : 0;
  return {
    lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * t,
    lng: points[i - 1].lng + (points[i].lng - points[i - 1].lng) * t
  };
};

// How far ahead along the route to look when deriving heading from route
// geometry — far enough that two closely-spaced vertices don't produce a
// noisy near-zero-length bearing.
export const ROUTE_HEADING_LOOKAHEAD_METERS = 15;

// Heading is derived from the route geometry ahead of the driver whenever
// they're on-route: this is what production nav apps do, and unlike
// GeolocationPosition.coords.heading (often null, or wildly noisy at low
// speed) it can't jitter — it only changes as the matched position moves onto
// a genuinely different-angled stretch. A GPS-fix-to-GPS-fix bearing is the
// fallback for when there's no matched route to anchor to (off-route /
// recalculating).
//
// Both branches return a true forward azimuth: on-route it is measured from
// the driver's matched position to a point further along the route, and
// off-route from the previous fix to the current one. Neither is negated,
// mirrored or offset anywhere between here and the camera.
export const deriveTargetHeading = (onRoute, points, cumulative, travelled, prevPos, currentPos) => {
  if (onRoute && points && points.length > 1) {
    const origin = pointAtDistance(points, cumulative, travelled);
    const ahead = pointAtDistance(points, cumulative, travelled + ROUTE_HEADING_LOOKAHEAD_METERS);
    if (ahead.lat !== origin.lat || ahead.lng !== origin.lng) {
      return bearingDegrees(origin, ahead);
    }
  }
  return prevPos ? bearingDegrees(prevPos, currentPos) : null;
};
