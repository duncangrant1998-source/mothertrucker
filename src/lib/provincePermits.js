// Hardcoded provincial oversize/overweight permit info. Ontario only for now —
// add more provinces here (plus a matching bounding box below) as they're supported.
export const PROVINCE_PERMITS = {
  Ontario: {
    name: 'Ontario',
    color: '#e85d04',
    permitRequired: 'Oversize and Overweight',
    portalUrl: 'https://www.ontario.ca/page/oversize-overweight-vehicles',
    escort: 'Required for loads exceeding 4.3m height or 3.5m width',
    seasonal: 'Spring load restrictions (Mar-Apr) may reduce allowable axle weights on posted roads',
    phone: '1-800-387-7768'
  }
};

// Rough bounding boxes used to guess which provinces a route's bounding box
// overlaps, since the inspection_stations table only carries Ontario data
// today and has no province column to query directly.
const PROVINCE_BOUNDS = {
  Ontario: { top: 56.9, bottom: 41.6, left: -95.2, right: -74.3 }
};

const rectsOverlap = (a, b) =>
  a.left <= b.right && a.right >= b.left && a.bottom <= b.top && a.top >= b.bottom;

/**
 * Given a HERE Maps H.geo.Rect (route bounding box), returns the list of
 * province keys (into PROVINCE_PERMITS) whose rough bounds overlap it.
 */
export function getProvincesForBounds(bounds) {
  if (!bounds) return [];
  const routeBox = {
    top: bounds.getTop(),
    bottom: bounds.getBottom(),
    left: bounds.getLeft(),
    right: bounds.getRight()
  };
  return Object.keys(PROVINCE_BOUNDS).filter((province) =>
    rectsOverlap(routeBox, PROVINCE_BOUNDS[province])
  );
}
