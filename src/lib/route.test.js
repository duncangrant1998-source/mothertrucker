import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeSectionGeometry } from './route';

// The HERE SDK arrives as a script-tag global, not an import. These tests
// stand in for it so the geometry guard can be exercised without a browser.
const stubHere = (decode) => {
  globalThis.H = {
    geo: {
      LineString: {
        fromFlexiblePolyline: decode
      }
    }
  };
};

const lineStringOf = (flat) => ({ getLatLngAltArray: () => flat });

afterEach(() => {
  delete globalThis.H;
});

describe('decodeSectionGeometry', () => {
  it('decodes a well-formed section into points and cumulative distances', () => {
    stubHere(() => lineStringOf([43.2, -79.6, 0, 43.2, -79.5828, 0, 43.2, -79.5656, 0]));
    const { points, cumulative, reason } = decodeSectionGeometry({ polyline: 'BG...' });
    expect(reason).toBeNull();
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ lat: 43.2, lng: -79.6 });
    expect(cumulative[0]).toBe(0);
    expect(cumulative[2]).toBeGreaterThan(cumulative[1]);
  });

  // The failure mode this guard exists for: a reroute response that is
  // otherwise complete — actions, instructions, a summary, enough to
  // repopulate the banner and flip the badge to "new route active" — but
  // carries no polyline. Swapping that into state blanks the map and leaves
  // nothing to measure off-route distance against, so the next fix reads as
  // off-route and fires another reroute. It has to be refused, not accepted.
  it('rejects a response whose geometry has been stripped', () => {
    const decode = vi.fn();
    stubHere(decode);
    const { points, cumulative, reason } = decodeSectionGeometry({
      summary: { length: 34000, duration: 1500 },
      actions: [{ action: 'depart', offset: 0, instruction: 'Head out' }],
      spans: [{ offset: 0, maxSpeed: 27.8 }]
    });
    expect(points).toBeNull();
    expect(cumulative).toBeNull();
    expect(reason).toBe('no polyline');
    // Never even attempted to decode — nothing to decode.
    expect(decode).not.toHaveBeenCalled();
  });

  it('rejects an empty-string polyline', () => {
    stubHere(() => lineStringOf([]));
    expect(decodeSectionGeometry({ polyline: '' }).reason).toBe('no polyline');
  });

  it('rejects a single-vertex route, which has no segment to match against', () => {
    stubHere(() => lineStringOf([43.2, -79.6, 0]));
    const { points, reason } = decodeSectionGeometry({ polyline: 'BG...' });
    expect(points).toBeNull();
    expect(reason).toBe('only 1 point(s)');
  });

  it('rejects rather than propagates when the decoder throws', () => {
    stubHere(() => {
      throw new Error('bad encoding');
    });
    const { points, reason } = decodeSectionGeometry({ polyline: 'not-a-polyline' });
    expect(points).toBeNull();
    expect(reason).toContain('bad encoding');
  });

  it('rejects a missing section', () => {
    stubHere(() => lineStringOf([]));
    expect(decodeSectionGeometry(undefined).reason).toBe('no section');
  });
});
