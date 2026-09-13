import { describe, expect, it } from 'vitest';
import {
  bearingDegrees,
  cameraHeadingForTravel,
  destPoint,
  deriveTargetHeading,
  haversineMeters,
  matchToRoute,
  normalizeDegrees,
  pointAtDistance,
  pointToSegment,
  shortestAngleDelta
} from './geo';

// A straight, sparsely-vertexed stretch of road, the shape HERE returns for a
// motorway: two vertices ~1.4km apart with nothing in between, because the
// road genuinely doesn't change direction. This is the geometry that broke
// vertex-based matching.
const SPARSE_HIGHWAY = [
  { lat: 43.2000, lng: -79.6000 },
  { lat: 43.2000, lng: -79.5828 },
  { lat: 43.2000, lng: -79.5656 }
];

describe('bearingDegrees', () => {
  it('reads due north, east, south and west off the cardinal directions', () => {
    const origin = { lat: 43.2, lng: -79.6 };
    expect(bearingDegrees(origin, { lat: 43.3, lng: -79.6 })).toBeCloseTo(0, 1);
    expect(bearingDegrees(origin, { lat: 43.2, lng: -79.5 })).toBeCloseTo(90, 1);
    expect(bearingDegrees(origin, { lat: 43.1, lng: -79.6 })).toBeCloseTo(180, 1);
    expect(bearingDegrees(origin, { lat: 43.2, lng: -79.7 })).toBeCloseTo(270, 1);
  });

  // The defect this guards against is a 180-degree camera: a swapped argument
  // order, or a negated result, both show up here and nowhere else.
  it('is the forward azimuth, so swapping the arguments flips it by 180', () => {
    const a = { lat: 43.2000, lng: -79.6000 };
    const b = { lat: 43.2400, lng: -79.5300 };
    const forward = bearingDegrees(a, b);
    const back = bearingDegrees(b, a);
    expect(Math.abs(shortestAngleDelta(forward, back))).toBeCloseTo(180, 0);
  });

  // Known pair: Hamilton to Toronto is north-east, initial azimuth 41.5.
  it('matches a known coordinate pair', () => {
    const hamilton = { lat: 43.2557, lng: -79.8711 };
    const toronto = { lat: 43.6532, lng: -79.3832 };
    expect(bearingDegrees(hamilton, toronto)).toBeCloseTo(41.5, 0);
  });

  it('never returns a negative bearing', () => {
    const origin = { lat: 43.2, lng: -79.6 };
    expect(bearingDegrees(origin, { lat: 43.1999, lng: -79.6001 })).toBeGreaterThanOrEqual(0);
  });
});

describe('heading wraparound', () => {
  it('normalises into 0..360', () => {
    expect(normalizeDegrees(-1)).toBeCloseTo(359);
    expect(normalizeDegrees(361)).toBeCloseTo(1);
    expect(normalizeDegrees(720)).toBeCloseTo(0);
  });

  // 359 -> 1 is two degrees clockwise, not 358 degrees anticlockwise. Getting
  // this wrong spins the whole map the long way round on a heading that
  // crosses north.
  it('steps the short way across 359 to 1', () => {
    expect(shortestAngleDelta(359, 1)).toBeCloseTo(2);
    expect(shortestAngleDelta(1, 359)).toBeCloseTo(-2);
    expect(shortestAngleDelta(350, 10)).toBeCloseTo(20);
    expect(shortestAngleDelta(10, 350)).toBeCloseTo(-20);
  });

  it('interpolates across the wrap without leaving 0..360', () => {
    const from = 359;
    const to = 1;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const h = normalizeDegrees(from + shortestAngleDelta(from, to) * t);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
      expect(h >= 359 || h <= 1).toBe(true);
    }
  });

  it('picks a consistent direction for an exact 180 reversal', () => {
    expect(Math.abs(shortestAngleDelta(0, 180))).toBeCloseTo(180);
  });
});

describe('cameraHeadingForTravel', () => {
  // Each pair is a measured on-vehicle sample: what was passed to
  // setLookAtData, and the screen-up bearing the engine actually rendered.
  // Feeding the converted value should now render the travel heading itself.
  it.each([
    [0, 180],
    [90, 270],
    [102, 282],
    [103, 283],
    [106, 286],
    [108, 288],
    [178, 358]
  ])('places the camera behind a driver travelling %i degrees', (travel, expected) => {
    expect(cameraHeadingForTravel(travel)).toBeCloseTo(expected, 6);
  });

  it('wraps rather than exceeding 360', () => {
    expect(cameraHeadingForTravel(200)).toBeCloseTo(20);
    expect(cameraHeadingForTravel(359)).toBeCloseTo(179);
    expect(cameraHeadingForTravel(180)).toBeCloseTo(0);
  });

  // Applying it twice must return the original heading — the property that
  // makes "is this the right way round" checkable without a vehicle.
  it('is its own inverse', () => {
    for (const h of [0, 37, 90, 180, 271, 359]) {
      expect(cameraHeadingForTravel(cameraHeadingForTravel(h))).toBeCloseTo(h, 6);
    }
  });
});

describe('destPoint', () => {
  it('lands the requested distance away on the requested bearing', () => {
    const origin = { lat: 43.2, lng: -79.6 };
    for (const bearing of [0, 45, 90, 180, 270, 359]) {
      const p = destPoint(origin, bearing, 200);
      expect(haversineMeters(origin, p)).toBeCloseTo(200, 0);
      // Compared as an angular difference, not as raw degrees: a bearing of 0
      // comes back as 359.999… and is right, not 360 degrees out.
      expect(shortestAngleDelta(bearing, bearingDegrees(origin, p))).toBeCloseTo(0, 1);
    }
  });
});

describe('pointToSegment', () => {
  it('measures perpendicular distance, not distance to an endpoint', () => {
    const a = { lat: 43.2, lng: -79.6 };
    const b = { lat: 43.2, lng: -79.5 };
    // Directly above the midpoint of the segment.
    const p = { lat: 43.2009, lng: -79.55 };
    const { distance, t } = pointToSegment(p, a, b);
    expect(distance).toBeCloseTo(100, -1);
    expect(t).toBeCloseTo(0.5, 2);
  });

  it('clamps to the endpoints for a point beyond the segment', () => {
    const a = { lat: 43.2, lng: -79.6 };
    const b = { lat: 43.2, lng: -79.5 };
    expect(pointToSegment({ lat: 43.2, lng: -79.7 }, a, b).t).toBe(0);
    expect(pointToSegment({ lat: 43.2, lng: -79.4 }, a, b).t).toBe(1);
  });

  it('degrades to a point distance for a zero-length segment', () => {
    const a = { lat: 43.2, lng: -79.6 };
    const { distance, t } = pointToSegment({ lat: 43.2009, lng: -79.6 }, a, a);
    expect(t).toBe(0);
    expect(distance).toBeCloseTo(100, -1);
  });
});

describe('matchToRoute', () => {
  const cumulative = [0, 1393.9, 2787.8];

  // The regression that fired a reroute on the QEW four seconds after the
  // truck merged, while it sat dead centre in its own lane.
  it('reports a near-zero distance for a fix mid-segment on sparse geometry', () => {
    const midway = { lat: 43.2000, lng: -79.5914 };
    const { distance } = matchToRoute(SPARSE_HIGHWAY, cumulative, midway.lat, midway.lng, 0);
    expect(distance).toBeLessThan(5);

    // And the reason the old code got it wrong: the nearest *vertex* is most
    // of a kilometre away, far past the 50m reroute threshold.
    const nearestVertex = Math.min(
      ...SPARSE_HIGHWAY.map((p) => haversineMeters(midway, p))
    );
    expect(nearestVertex).toBeGreaterThan(600);
  });

  it('interpolates travelled distance inside the matched segment', () => {
    const quarter = { lat: 43.2000, lng: -79.5957 };
    const { travelled, index } = matchToRoute(SPARSE_HIGHWAY, cumulative, quarter.lat, quarter.lng, 0);
    expect(index).toBe(0);
    expect(travelled).toBeGreaterThan(300);
    expect(travelled).toBeLessThan(400);
  });

  it('still flags a genuinely off-route fix', () => {
    // ~500m north of the road.
    const off = { lat: 43.2045, lng: -79.5914 };
    const { distance } = matchToRoute(SPARSE_HIGHWAY, cumulative, off.lat, off.lng, 0);
    expect(distance).toBeGreaterThan(400);
  });

  it('advances travelled monotonically along the route', () => {
    let previous = -1;
    for (const lng of [-79.5990, -79.5900, -79.5800, -79.5700]) {
      const { travelled } = matchToRoute(SPARSE_HIGHWAY, cumulative, 43.2, lng, 0);
      expect(travelled).toBeGreaterThan(previous);
      previous = travelled;
    }
  });

  it('handles a single-vertex route without dividing by zero', () => {
    const { index, distance } = matchToRoute([{ lat: 43.2, lng: -79.6 }], [0], 43.2, -79.6, 0);
    expect(index).toBe(0);
    expect(distance).toBeCloseTo(0, 1);
  });
});

describe('pointAtDistance', () => {
  const cumulative = [0, 1393.9, 2787.8];

  it('interpolates inside a segment rather than snapping to a vertex', () => {
    const p = pointAtDistance(SPARSE_HIGHWAY, cumulative, 697);
    expect(p.lat).toBeCloseTo(43.2, 5);
    expect(p.lng).toBeGreaterThan(-79.6);
    expect(p.lng).toBeLessThan(-79.5828);
  });

  it('clamps at both ends', () => {
    expect(pointAtDistance(SPARSE_HIGHWAY, cumulative, -50).lng).toBeCloseTo(-79.6, 5);
    expect(pointAtDistance(SPARSE_HIGHWAY, cumulative, 99999).lng).toBeCloseTo(-79.5656, 5);
  });
});

describe('deriveTargetHeading', () => {
  const cumulative = [0, 1393.9, 2787.8];

  // On a long straight the old vertex-snapped lookahead returned the same
  // vertex for both the origin and the point ahead, so it silently fell
  // through to the noisier fix-to-fix bearing for the whole straight.
  it('derives an eastbound heading from route geometry mid-straight', () => {
    const heading = deriveTargetHeading(true, SPARSE_HIGHWAY, cumulative, 697, null, null);
    expect(heading).toBeCloseTo(90, 0);
  });

  it('falls back to the fix-to-fix bearing when off-route', () => {
    const prev = { lat: 43.2000, lng: -79.6000 };
    const current = { lat: 43.2100, lng: -79.6000 };
    expect(deriveTargetHeading(false, SPARSE_HIGHWAY, cumulative, 0, prev, current)).toBeCloseTo(0, 1);
  });

  it('returns null off-route with no previous fix to measure from', () => {
    expect(deriveTargetHeading(false, SPARSE_HIGHWAY, cumulative, 0, null, { lat: 43.2, lng: -79.6 })).toBeNull();
  });

  // Direction of travel, not direction travelled from. A camera fed the
  // reciprocal of this points the driver at where they have just been.
  it('points along the direction of travel, never against it', () => {
    const prev = { lat: 43.2000, lng: -79.6000 };
    const current = { lat: 43.2000, lng: -79.5900 };
    expect(deriveTargetHeading(false, null, null, 0, prev, current)).toBeCloseTo(90, 0);
  });
});
