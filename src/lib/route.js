// Route-geometry decoding and the guard that decides whether a routing
// response is fit to navigate on.
//
// `H` is a global supplied by the HERE SDK script tags in index.html rather
// than an import, so it is referenced lazily inside the functions here (never
// at module scope) and can be stubbed in tests.

import { buildCumulativeDistances } from './geo';

// Flexible polyline -> array of { lat, lng }. Altitude is discarded; nothing
// downstream uses it.
export const decodeRoutePoints = (polyline) => {
  const flat = H.geo.LineString.fromFlexiblePolyline(polyline).getLatLngAltArray();
  const points = [];
  for (let i = 0; i < flat.length; i += 3) {
    points.push({ lat: flat[i], lng: flat[i + 1] });
  }
  return points;
};

// Decodes a routing-response section into the geometry the renderer and the
// progress logic both read from, or returns null with a reason if it can't.
//
// A response can be a complete HTTP success — actions, instructions and a
// summary all present, enough for the instruction banner to repopulate and
// for a "new route active" badge to appear — while carrying no usable
// polyline. Swapping that into state gives a blank map, no geometry to
// measure off-route distance against, and therefore an immediate off-route
// verdict and another reroute: the failure loops rather than surfacing.
//
// Two points is the minimum: a single-vertex "route" has no segment to match
// a GPS fix against, so every fix would report an infinite off-route distance.
export const decodeSectionGeometry = (section) => {
  if (!section) return { points: null, cumulative: null, reason: 'no section' };
  if (typeof section.polyline !== 'string' || !section.polyline) {
    return { points: null, cumulative: null, reason: 'no polyline' };
  }
  let points;
  try {
    points = decodeRoutePoints(section.polyline);
  } catch (err) {
    return { points: null, cumulative: null, reason: `decode threw: ${err?.message ?? err}` };
  }
  if (!points || points.length < 2) {
    return { points: null, cumulative: null, reason: `only ${points?.length ?? 0} point(s)` };
  }
  return { points, cumulative: buildCumulativeDistances(points), reason: null };
};
