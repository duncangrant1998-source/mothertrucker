import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { getStationsNearRoute } from '../lib/inspectionStations';
import { PROVINCE_PERMITS, getProvincesForBounds } from '../lib/provincePermits';

const WEIGH_STATION_TERMS = ['weigh station', 'inspection station'];

const ROUTE_CONFIGS = [
  { id: 'fastest', label: 'Fastest', routingMode: 'fast', avoidTolls: false },
  { id: 'notolls', label: 'No Tolls', routingMode: 'fast', avoidTolls: true },
  { id: 'shortest', label: 'Shortest', routingMode: 'short', avoidTolls: false }
];

// HERE's canvas-rendered polylines can't consume CSS custom properties, so the
// route-normal token is duplicated here (day/night) and picked via the same
// mechanism tokens.css responds to: a manual data-theme override on <html>
// (set by the drawer's Color Scheme toggle) takes precedence, falling back to
// prefers-color-scheme when no manual choice has been made.
const ROUTE_NORMAL_COLOR = { day: '#2E9E52', night: '#5FCB7A' };
const isNightMode = () => {
  if (typeof document !== 'undefined') {
    const override = document.documentElement.getAttribute('data-theme');
    if (override === 'dark') return true;
    if (override === 'light') return false;
  }
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
};
const selectedRouteStyle = () => ({ strokeColor: ROUTE_NORMAL_COLOR[isNightMode() ? 'night' : 'day'], lineWidth: 5 });
const UNSELECTED_ROUTE_STYLE = { strokeColor: 'rgba(148,163,184,0.6)', lineWidth: 4 };

// The topographic base layer has a genuine night scheme (unlike satellite
// imagery, which looks the same regardless of theme), so Dark Mode swaps it
// to HERE's "logistics.night" style instead of relying on CSS filters.
const getTopoLayer = (defaultLayers, colorScheme) => (
  colorScheme === 'dark' ? defaultLayers.vector.normal.logisticsnight : defaultLayers.vector.normal.logistics
);

// The satellite photography itself can't get darker, but HERE's hybrid
// scheme overlays roads/labels/sky on top of the imagery as a separate
// vector layer, and that overlay has its own day/night styling. "base" goes
// through setBaseLayer like the topo layer; "overlay" is added on top via
// addLayer/removeLayer since setBaseLayer only takes a single layer.
const getSatelliteLayers = (defaultLayers, colorScheme) => (
  colorScheme === 'dark'
    ? { base: defaultLayers.hybrid.night.raster, overlay: defaultLayers.hybrid.night.vector }
    : { base: defaultLayers.hybrid.day.raster, overlay: defaultLayers.hybrid.day.vector }
);

// Close "driving" zoom (not an overview level) with a moderate forward tilt
// for the classic chase-camera turn-by-turn look; flat/north-up otherwise.
const NAV_ZOOM = 18;
const NAV_TILT = 45;
// Distance at which route-derived heading is no longer trusted (falls back
// to GPS-fix-to-fix bearing) — deliberately looser than REROUTE_TRIGGER_METERS
// below, since "is this still a decent proxy for my heading" is a lower bar
// than "request a whole new route."
const OFF_ROUTE_METERS = 100;

// Automatic-reroute trigger: a single fix past this distance from the route
// polyline only starts counting toward confirmation — it takes
// REROUTE_CONFIRM_FIXES consecutive qualifying fixes (hysteresis) before a
// reroute actually fires, so one noisy fix or a wide lane doesn't trigger it.
const REROUTE_TRIGGER_METERS = 50;
const REROUTE_CONFIRM_FIXES = 3;
// Minimum gap between reroute *attempts* (successful or failed) — guards
// against firing a new request on every ~1s GPS fix while off-route, and
// throttles retries after a failure instead of hammering the API.
const REROUTE_COOLDOWN_MS = 5000;
const REROUTE_SUCCESS_NOTICE_MS = 4000;

// Below this speed, GPS-derived bearing is essentially noise (two nearly-
// identical fixes with GPS jitter can point anywhere), so heading target
// updates are frozen rather than fed to the marker/camera.
const MIN_HEADING_SPEED_MPS = 5 / 3.6;

// How far ahead along the route polyline (in meters) to look when deriving
// heading from route geometry — far enough that two closely-spaced polyline
// vertices don't produce a noisy near-zero-length bearing.
const ROUTE_HEADING_LOOKAHEAD_METERS = 15;

// GPS fixes arrive in bursts roughly once a second; the marker/camera are
// animated from their last rendered pose to each new fix over this long,
// clamped so a delayed or back-to-back-fast fix can't produce a stalled or
// instant-snap animation.
const NAV_ANIM_MIN_MS = 300;
const NAV_ANIM_MAX_MS = 2000;
const NAV_ANIM_DEFAULT_MS = 1000;

// Distance thresholds for the two-stage proximity alert system (stations,
// highway exits, and turn maneuvers all share the same pipeline).
const ALERT_TOAST_METERS = 2000;
const ALERT_BANNER_METERS = 500;
const ALERT_PASSED_METERS = 100;
const ALERT_TOAST_DURATION_MS = 15000;

// The only alert-worthy proximity event that isn't already continuously
// visible in the top instruction banner — turn/exit maneuvers are covered by
// that banner's live NEXT/THEN text, so surfacing them here too would just
// repeat the same instruction in a second banner underneath it.
const STATION_ALERT_STYLE = { background: '#dc2626', color: 'white', defaultName: 'MTO Inspection Station' };

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

const haversineMeters = (a, b) => {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const bearingDegrees = (from, to) => {
  const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
  const x = Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

const normalizeDegrees = (deg) => ((deg % 360) + 360) % 360;

// Signed shortest angular step from `from` to `to`, in (-180, 180] — used to
// interpolate headings across the 359°→1° wraparound without spinning the
// long way round.
const shortestAngleDelta = (from, to) => ((to - from + 540) % 360) - 180;

// Walks the cumulative-distance table to find a point a fixed distance ahead
// of `index` along the route polyline, so route-derived heading is measured
// over a short but non-trivial stretch of road rather than between two
// nearly-identical adjacent vertices (which would be noisy).
const lookaheadRoutePoint = (points, cumulative, index, metersAhead) => {
  const targetDist = cumulative[index] + metersAhead;
  for (let i = index; i < points.length; i++) {
    if (cumulative[i] >= targetDist) return points[i];
  }
  return points[points.length - 1];
};

// Heading is derived from the route geometry ahead of the driver whenever
// they're on-route: this is what production nav apps do, and unlike
// GeolocationPosition.coords.heading (often null, or wildly noisy at low
// speed) it can't jitter — it only changes once the matched route index
// moves onto a genuinely different-angled segment. A GPS-fix-to-GPS-fix
// bearing is the fallback for when there's no matched route to anchor to
// (off-route / recalculating).
const deriveTargetHeading = (onRoute, points, cumulative, index, prevPos, currentPos) => {
  if (onRoute && points && points.length > 1) {
    const origin = points[index];
    const ahead = lookaheadRoutePoint(points, cumulative, index, ROUTE_HEADING_LOOKAHEAD_METERS);
    if (ahead.lat !== origin.lat || ahead.lng !== origin.lng) {
      return bearingDegrees(origin, ahead);
    }
  }
  return prevPos ? bearingDegrees(prevPos, currentPos) : null;
};

const decodeRoutePoints = (polyline) => {
  const flat = H.geo.LineString.fromFlexiblePolyline(polyline).getLatLngAltArray();
  const points = [];
  for (let i = 0; i < flat.length; i += 3) {
    points.push({ lat: flat[i], lng: flat[i + 1] });
  }
  return points;
};

const buildCumulativeDistances = (points) => {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineMeters(points[i - 1], points[i]));
  }
  return cumulative;
};

// Counts inspection stations that lie ahead of the driver's current route
// index, for the "MTO AHEAD" data panel column. Independent from the alert
// pipeline below (updateProximityAlerts) so it can't perturb alert timing.
const countStationsAhead = (points, stations, index) => {
  if (!points?.length || !stations?.length) return 0;
  let count = 0;
  for (const station of stations) {
    if (station.latitude == null || station.longitude == null) continue;
    const { index: stationIndex } = nearestPointIndex(points, station.latitude, station.longitude, 0, points.length - 1);
    if (stationIndex >= index) count++;
  }
  return count;
};

// Searches a window around fromIndex (the driver's last known position on the
// route) instead of the whole polyline, since GPS ticks arrive ~once a second
// and the driver can only have moved a short distance along the route.
const nearestPointIndex = (points, lat, lng, fromIndex = 0, window = points.length) => {
  const start = Math.max(0, fromIndex - 5);
  const end = Math.min(points.length - 1, fromIndex + window);
  let bestIndex = start;
  let bestDistance = Infinity;
  for (let i = start; i <= end; i++) {
    const d = haversineMeters({ lat, lng }, points[i]);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }
  return { index: bestIndex, distance: bestDistance };
};

const formatDistance = (meters) => {
  if (meters < 950) return `${Math.max(0, Math.round(meters))} m`;
  return `${(meters / 1000).toFixed(1)} km`;
};

const MPS_TO_KPH = 3.6;
const MPS_TO_MPH = 2.23694;

const unitLabel = (unit) => (unit === 'mph' ? 'mph' : 'km/h');

const formatSpeedValue = (mps, unit) => {
  if (mps == null) return '—';
  return Math.round(mps * (unit === 'mph' ? MPS_TO_MPH : MPS_TO_KPH));
};

// Autosuggest dropdown: fetch enough results for a meaningful "See more"
// expansion, but only show the top 3 by default so the collapsed list is
// short enough to fit above an on-screen keyboard.
const SUGGESTION_FETCH_LIMIT = 8;
const SUGGESTION_VISIBLE_COUNT = 3;
// Every suggestion row (and the "See more" row) renders at exactly this
// height — enforced via a fixed `height` + single-line ellipsis text, not
// just `minHeight` — so the container's height can be computed as an exact
// multiple of it with zero remainder. That's what guarantees no row is ever
// half-visible: the box is never taller than a whole number of rows.
const SUGGESTION_ROW_HEIGHT = 44;
// Breathing room kept between the bottom of the dropdown and the edge of
// the visible viewport (or the top of the on-screen keyboard).
const DROPDOWN_BOTTOM_MARGIN = 8;
// Used only for the brief window before the first position measurement
// lands (or on a browser missing getBoundingClientRect entirely) — dvh is
// the closest CSS-only proxy for "actually visible area."
const DROPDOWN_FALLBACK_MAX_HEIGHT = '40dvh';

// Pure row-fitting logic, kept separate from rendering so it's unit-
// testable on its own. Decides exactly which rows to show and how tall the
// container should be, given how much vertical space is actually available:
//  - Collapsed (default): shows up to SUGGESTION_VISIBLE_COUNT results, with
//    a "See more" row appended if there are more. If availableHeight can't
//    fit all of those, rows are trimmed (results before "See more" is ever
//    dropped) so the container height is always an exact multiple of the
//    row height — never a fraction of one, so nothing can render half-cut.
//  - Expanded: shows everything, scrollable (overflow: 'auto') within
//    availableHeight — the one place a partial row at the scroll boundary
//    is expected/acceptable, same as any normal scrolling list.
const layoutSuggestionRows = (results, expanded, availableHeight) => {
  if (expanded) {
    return {
      visible: results,
      showSeeMore: false,
      height: availableHeight == null ? null : Math.min(availableHeight, results.length * SUGGESTION_ROW_HEIGHT),
      overflow: 'auto'
    };
  }

  const desiredVisible = Math.min(SUGGESTION_VISIBLE_COUNT, results.length);
  const wantsSeeMore = results.length > desiredVisible;

  if (availableHeight == null) {
    // No measurement yet — fall back to the simple cap; the caller applies
    // DROPDOWN_FALLBACK_MAX_HEIGHT + overflow:auto as a safety net for this case.
    return { visible: results.slice(0, desiredVisible), showSeeMore: wantsSeeMore, height: null, overflow: 'auto' };
  }

  const rowsThatFit = Math.max(0, Math.floor(availableHeight / SUGGESTION_ROW_HEIGHT));

  if (!wantsSeeMore) {
    const visibleCount = Math.min(desiredVisible, rowsThatFit);
    return { visible: results.slice(0, visibleCount), showSeeMore: false, height: visibleCount * SUGGESTION_ROW_HEIGHT, overflow: 'hidden' };
  }

  // Reserve one row for "See more" whenever there's more to show, so the
  // affordance to reach the rest is never crowded out by one extra result.
  const roomForResults = Math.max(0, rowsThatFit - 1);
  const visibleCount = Math.min(desiredVisible, roomForResults);
  const showSeeMore = rowsThatFit >= 1 && results.length > visibleCount;
  const rowCount = visibleCount + (showSeeMore ? 1 : 0);
  return { visible: results.slice(0, visibleCount), showSeeMore, height: rowCount * SUGGESTION_ROW_HEIGHT, overflow: 'hidden' };
};

const SUGGESTION_ROW_STYLE = {
  height: `${SUGGESTION_ROW_HEIGHT}px`,
  padding: '0 8px',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  fontFamily: 'var(--font-display)',
  color: 'var(--color-text-primary)',
  fontSize: '13px',
  cursor: 'pointer',
  borderBottom: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
};

// Renders the autosuggest dropdown through a portal to document.body,
// positioned with `position: fixed` from the input wrapper's live
// getBoundingClientRect. This — not the dropdown's own max-height — is what
// actually keeps it from being clipped by mt-route-card's max-height +
// overflow-y:auto: a child positioned inside a scrolling ancestor is always
// clipped at that ancestor's edge no matter how its own size is computed,
// regardless of keyboard state. Escaping via portal + fixed positioning lays
// it out against the true viewport instead, so it can no longer be clipped
// by the card at all. Recomputes on visualViewport resize/scroll (keyboard
// show/hide), window resize, and any ancestor scroll — 'scroll' events don't
// bubble, so the ancestor-scroll listener is capture-phase on document.
const SuggestionDropdown = ({ wrapperRef, isOpen, loading, results, expanded, onExpand, onSelect, formatItem, onPointerEnter, onPointerLeave }) => {
  const [geometry, setGeometry] = useState(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const recompute = () => {
      if (!wrapperRef.current) return;
      const wrapperRect = wrapperRef.current.getBoundingClientRect();
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      setGeometry({
        left: wrapperRect.left,
        top: wrapperRect.bottom + 2,
        width: wrapperRect.width,
        availableHeight: Math.max(0, visibleBottom - (wrapperRect.bottom + 2) - DROPDOWN_BOTTOM_MARGIN)
      });
    };
    recompute();
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    vv?.addEventListener('resize', recompute);
    vv?.addEventListener('scroll', recompute);
    window.addEventListener('resize', recompute);
    document.addEventListener('scroll', recompute, true);
    return () => {
      vv?.removeEventListener('resize', recompute);
      vv?.removeEventListener('scroll', recompute);
      window.removeEventListener('resize', recompute);
      document.removeEventListener('scroll', recompute, true);
    };
  }, [isOpen, wrapperRef]);

  if (!isOpen || typeof document === 'undefined') return null;

  const layout = loading ? null : layoutSuggestionRows(results, expanded, geometry?.availableHeight ?? null);

  const containerStyle = {
    position: 'fixed',
    left: geometry?.left ?? 0,
    top: geometry?.top ?? 0,
    width: geometry?.width ?? 'auto',
    zIndex: 3100,
    background: 'var(--color-panel)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-soft)',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
    visibility: geometry ? 'visible' : 'hidden',
    boxSizing: 'border-box',
    ...(loading
      ? {}
      : layout.height != null
        ? { height: `${layout.height}px`, overflowY: layout.overflow }
        : { maxHeight: DROPDOWN_FALLBACK_MAX_HEIGHT, overflowY: 'auto' })
  };

  return createPortal(
    <div onMouseEnter={onPointerEnter} onMouseLeave={onPointerLeave} style={containerStyle}>
      {loading ? (
        <div style={{ ...SUGGESTION_ROW_STYLE, cursor: 'default', fontSize: '12px', color: 'var(--color-text-muted)' }}>Searching…</div>
      ) : (
        <>
          {layout.visible.map((item) => (
            <div
              key={item.id}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
              style={SUGGESTION_ROW_STYLE}
            >
              {formatItem(item)}
            </div>
          ))}
          {layout.showSeeMore && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                onExpand();
              }}
              style={{ ...SUGGESTION_ROW_STYLE, justifyContent: 'center', color: '#e85d04', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '12px', borderBottom: 'none' }}
            >
              See more ({results.length - layout.visible.length} more)
            </div>
          )}
        </>
      )}
    </div>,
    document.body
  );
};

// Same pattern as the autosuggest dropdown fix, applied to the two other
// spots that turned out to have the identical bug: an ancestor with
// max-height + overflow clipping content mid-element, sized against 100vh
// rather than what's actually visible once mobile browser chrome (and, for
// the route card, the keyboard) is accounted for.
//
// How much vertical room is actually available in the visible viewport
// after reserving `margin` px top and bottom — accounts for the on-screen
// keyboard via VisualViewport (keyboard show/hide fires resize/scroll on
// it) and, on browsers where VisualViewport already excludes it, mobile
// browser chrome like Safari's collapsing bottom bar. Falls back to
// window.innerHeight where VisualViewport isn't supported; the caller is
// expected to also apply env(safe-area-inset-*) in CSS for the static
// home-indicator/notch reservation, which this can't see from JS.
const useAvailableViewportHeight = (margin) => {
  const [height, setHeight] = useState(null);

  useEffect(() => {
    const recompute = () => {
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      const visibleHeight = vv ? vv.height : window.innerHeight;
      setHeight(Math.max(0, visibleHeight - margin * 2));
    };
    recompute();
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    vv?.addEventListener('resize', recompute);
    vv?.addEventListener('scroll', recompute);
    window.addEventListener('resize', recompute);
    return () => {
      vv?.removeEventListener('resize', recompute);
      vv?.removeEventListener('scroll', recompute);
      window.removeEventListener('resize', recompute);
    };
  }, [margin]);

  return height;
};

// Caps the route-options list to an exact multiple of ROUTE_OPTION_ROW_HEIGHT
// so it can never show a fraction of a row at rest — the same guarantee
// layoutSuggestionRows makes for the autosuggest dropdown, adapted for a
// small (max 3-item) list that just needs to scroll rather than paginate.
// header/footer are measured via ResizeObserver (not a hand-maintained
// dependency list) so any change to their content — the saved-routes
// dropdown opening, an error message appearing, the station-count warning
// showing — automatically re-triggers the calculation.
//
// Critical: the ceiling this budgets against is read directly off the card
// via getComputedStyle(cardRef.current).maxHeight, NOT re-derived from
// `cardMaxHeightHint` (a raw VisualViewport number) the way an earlier
// version of this hook did. That earlier version's own height - 32 estimate
// didn't include env(safe-area-inset-bottom), which the CSS max-height
// formula on .mt-route-card does — so on any device with a nonzero inset,
// the JS estimate came out taller than the card's real enforced ceiling,
// letting the options list claim more height than actually existed and
// pushing the footer (Start Navigation included) past the card's clipped
// edge — i.e. it disappeared entirely, not just scrolled out of reach.
// Reading the browser's own already-resolved value instead of a second,
// independently-computed one removes that whole class of divergence.
// `cardMaxHeightHint` is still taken as a dependency purely so this re-runs
// in step with the card's own VisualViewport-driven re-renders (React's
// effect-ordering guarantees the DOM already reflects the new
// --card-max-height by the time this layout effect's recompute runs); its
// numeric value is never used directly. getComputedStyle returning 'none'
// (outside the mobile breakpoint, e.g. desktop) means there's no CSS
// ceiling to budget against, so the list is left uncapped.
const useOptionsListHeight = (cardRef, headerRef, footerRef, cardMaxHeightHint, itemCount, rowHeight) => {
  const [height, setHeight] = useState(null);

  useLayoutEffect(() => {
    if (!itemCount) {
      setHeight(null);
      return undefined;
    }
    const recompute = () => {
      if (!cardRef.current || !headerRef.current || !footerRef.current) return;
      const resolvedMaxHeight = parseFloat(getComputedStyle(cardRef.current).maxHeight);
      if (!Number.isFinite(resolvedMaxHeight)) {
        setHeight(null);
        return;
      }
      const headerH = headerRef.current.getBoundingClientRect().height;
      const footerH = footerRef.current.getBoundingClientRect().height;
      const available = Math.max(0, resolvedMaxHeight - headerH - footerH - CARD_VERTICAL_PADDING);
      const desired = itemCount * rowHeight;
      const rowsThatFit = Math.floor(available / rowHeight);
      setHeight(Math.min(desired, Math.max(0, rowsThatFit) * rowHeight));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    if (cardRef.current) ro.observe(cardRef.current);
    if (headerRef.current) ro.observe(headerRef.current);
    if (footerRef.current) ro.observe(footerRef.current);
    return () => ro.disconnect();
  }, [itemCount, cardMaxHeightHint, rowHeight, cardRef, headerRef, footerRef]);

  return height;
};

const CARD_MARGIN = 16;
// PANEL_STYLE-driven padding on .mt-route-card (16px top + 16px bottom).
const CARD_VERTICAL_PADDING = 32;
const ROUTE_OPTION_ROW_HEIGHT = 56;
const PERMIT_PANEL_MARGIN = 20;
const PERMIT_PANEL_MAX_HEIGHT = 230;

const SPEED_UNIT_OPTIONS = [
  { value: 'auto', label: 'Auto-detect (default)' },
  { value: 'kmh', label: 'Kilometers per hour' },
  { value: 'mph', label: 'Miles per hour' }
];

const MENU_ITEM_STYLE = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  minHeight: '44px',
  boxSizing: 'border-box',
  textAlign: 'left',
  padding: '10px 14px',
  border: 'none',
  background: 'var(--color-panel)',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-display)',
  fontSize: '13px',
  letterSpacing: '0.01em',
  cursor: 'pointer',
  borderBottom: '1px solid var(--color-border)'
};

// Shared "Industrial Precision" primitives: all-caps muted micro-labels,
// monospace data readouts, and flat bordered panels with sharp (<=2px) corners.
const LABEL_STYLE = {
  fontFamily: 'var(--font-display)',
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--color-text-muted)'
};

const MONO_STYLE = {
  fontFamily: 'var(--font-mono)',
  letterSpacing: 'normal'
};

const PANEL_STYLE = {
  background: 'var(--color-panel)',
  border: '1px solid var(--color-border)',
  borderRadius: 0,
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-display)'
};

// Distributes each span's HERE-reported duration across the points it covers
// (proportional to distance travelled within the span), so remaining-time/ETA
// can be read off by point index the same way remaining distance already is.
// Falls back to a constant-average-speed split when spans/durations aren't
// available, e.g. before the routing response includes span data.
const buildCumulativeSpanDurations = (points, spans, cumulativeDistance, totalDuration) => {
  const n = points.length;
  const durations = new Array(n).fill(0);
  if (!spans || !spans.length) {
    const totalDistance = cumulativeDistance[n - 1] || 1;
    for (let i = 0; i < n; i++) durations[i] = (cumulativeDistance[i] / totalDistance) * totalDuration;
    return durations;
  }
  let runningDuration = 0;
  for (let s = 0; s < spans.length; s++) {
    const startIdx = spans[s].offset;
    const endIdx = s + 1 < spans.length ? spans[s + 1].offset : n - 1;
    const spanDuration = spans[s].duration ?? 0;
    const spanDist = (cumulativeDistance[endIdx] - cumulativeDistance[startIdx]) || 1;
    for (let i = startIdx; i <= endIdx; i++) {
      const ratio = (cumulativeDistance[i] - cumulativeDistance[startIdx]) / spanDist;
      durations[i] = runningDuration + ratio * spanDuration;
    }
    runningDuration += spanDuration;
  }
  return durations;
};

// HERE's spans array is sorted by ascending offset (start point index of each
// span) — the last span whose offset hasn't passed `index` yet is the one
// the driver is currently on.
//
// The response field is `maxSpeed`, not `speedLimit` — per HERE Routing API
// v8's own OpenAPI spec, `speedLimit` is a deprecated alias that only
// appears if the request explicitly asks for spans=speedLimit; requesting
// spans=maxSpeed (as this app does) returns spans with a `maxSpeed` field
// instead, and reading `.speedLimit` off of them is always undefined. Its
// value is either a number in m/s, or the literal string "unlimited" (e.g.
// German autobahns) per the MaxSpeed schema — both are passed through here
// and disambiguated at render time.
const speedLimitAtIndex = (spans, index) => {
  for (let s = spans.length - 1; s >= 0; s--) {
    if (spans[s].offset <= index) return spans[s].maxSpeed ?? null;
  }
  return null;
};

const describeAction = (action) => {
  if (action.instruction) return action.instruction;
  const road = action.nextRoad?.name?.[0]?.value || action.currentRoad?.name?.[0]?.value;
  if (action.action === 'depart') return road ? `Head out on ${road}` : 'Head out';
  if (action.action === 'arrive') return 'Arrive at destination';
  if (action.direction) return road ? `Turn ${action.direction} onto ${road}` : `Turn ${action.direction}`;
  return road ? `Continue on ${road}` : 'Continue';
};

const buildNavActions = (section, cumulative) => (section.actions || []).map((action) => ({
  text: describeAction(action),
  distanceMeters: cumulative[action.offset] ?? cumulative[cumulative.length - 1]
}));

// Top-down truck silhouette (cab + cargo box) instead of a plain arrow, so
// the marker itself reads as "truck" — rotates with heading, cab pointing
// in the direction of travel, matching the chase camera's rotation.
const createDriverIcon = (headingDeg) => new H.map.Icon(
  '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">' +
    `<g transform="rotate(${headingDeg} 17 22)">` +
      '<rect x="6" y="12" width="22" height="28" rx="3" fill="#2563eb" stroke="white" stroke-width="2"/>' +
      '<rect x="11" y="3" width="12" height="10" rx="2" fill="#2563eb" stroke="white" stroke-width="2"/>' +
      '<line x1="10" y1="20" x2="24" y2="20" stroke="white" stroke-width="1.2" opacity="0.55"/>' +
      '<line x1="10" y1="28" x2="24" y2="28" stroke="white" stroke-width="1.2" opacity="0.55"/>' +
    '</g>' +
  '</svg>',
  { size: { w: 34, h: 44 }, anchor: { x: 17, y: 22 } }
);

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

const MapView = ({ profile, mapLayer, gridOverlay, colorScheme, onNavigatingChange }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const platformRef = useRef(null);
  const defaultLayersRef = useRef(null);
  const hybridOverlayLayerRef = useRef(null);
  const uiRef = useRef(null);
  const bubbleRef = useRef(null);
  const weighIconRef = useRef(null);
  const weighMarkersRef = useRef([]);
  const inspectionIconRef = useRef(null);
  const inspectionMarkersRef = useRef([]);
  const currentInspectionStationsRef = useRef([]);
  const watchIdRef = useRef(null);
  const driverMarkerRef = useRef(null);
  const navPolylineRef = useRef(null);
  const navRoutePointsRef = useRef(null);
  const navCumulativeRef = useRef(null);
  const navActionsRef = useRef([]);
  const lastIndexRef = useRef(0);
  const lastPositionRef = useRef(null);
  const lastFixTimestampRef = useRef(null);
  // Last heading target accepted by the low-speed gate (route-bearing or
  // GPS-diff derived) — the animation's "to" heading each fix.
  const smoothedHeadingRef = useRef(null);
  // The marker/camera pose actually on screen right now (post-interpolation)
  // — the animation's "from" anchor for the next leg, and what a mid-flight
  // new fix animates onward from instead of the fix's raw point.
  const displayedPoseRef = useRef(null);
  // { fromLat, fromLng, fromHeading, toLat, toLng, toHeading, startTime,
  //   duration, settled } for the requestAnimationFrame loop below.
  const navAnimRef = useRef(null);
  const navRafRef = useRef(null);
  const recalculatingRef = useRef(false);
  // Consecutive fixes in a row measured > REROUTE_TRIGGER_METERS from the
  // route — reset to 0 the moment a fix comes back within range.
  const offRouteStreakRef = useRef(0);
  // Date.now() of the last reroute attempt (success or failure) — gates the
  // cooldown in REROUTE_COOLDOWN_MS.
  const lastRerouteAttemptRef = useRef(0);
  const rerouteNoticeTimeoutRef = useRef(null);
  const routeStartRef = useRef(null);
  const routeEndRef = useRef(null);
  const routeDropdownRef = useRef(null);
  const navSpansRef = useRef([]);
  const navCumulativeDurationRef = useRef([]);
  const navTotalLengthRef = useRef(0);
  const navTotalDurationRef = useRef(0);
  const navTollRef = useRef(null);
  const alertStateRef = useRef(new Map());
  const toastTimeoutRef = useRef(null);
  const autoUnitIntervalRef = useRef(null);
  const wakeLockRef = useRef(null);
  const optionsMenuRef = useRef(null);
  const routeCardRef = useRef(null);
  const routeCardHeaderRef = useRef(null);
  const routeCardFooterRef = useRef(null);
  const startWrapperRef = useRef(null);
  const endWrapperRef = useRef(null);
  const startSuggestTimeout = useRef(null);
  const endSuggestTimeout = useRef(null);
  const startInteractingRef = useRef(false);
  const endInteractingRef = useRef(false);
  const startRequestId = useRef(0);
  const endRequestId = useRef(0);
  const startResolvedRef = useRef(null);
  const endResolvedRef = useRef(null);
  // Most recent real GPS fix (from the mount-time one-shot below), used to
  // bias autosuggest ranking toward the driver's actual location instead of
  // the app's fixed center-of-Canada default.
  const driverPositionRef = useRef(null);
  const [startLocation, setStartLocation] = useState('');
  const [endLocation, setEndLocation] = useState('');
  const [startSuggestions, setStartSuggestions] = useState([]);
  const [endSuggestions, setEndSuggestions] = useState([]);
  const [startSuggestLoading, setStartSuggestLoading] = useState(false);
  const [endSuggestLoading, setEndSuggestLoading] = useState(false);
  // "See more" state — collapsed (top SUGGESTION_VISIBLE_COUNT) until tapped.
  const [startSuggestionsExpanded, setStartSuggestionsExpanded] = useState(false);
  const [endSuggestionsExpanded, setEndSuggestionsExpanded] = useState(false);
  const [searching, setSearching] = useState(false);
  const [routeOptions, setRouteOptions] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [error, setError] = useState('');
  const [inspectionStationCount, setInspectionStationCount] = useState(0);
  const [navigating, setNavigating] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  // { type: 'success' | 'failed', text } | null — post-attempt reroute
  // feedback shown once `recalculating` clears. 'success' auto-dismisses;
  // 'failed' stays up until the next attempt resolves one way or the other.
  const [rerouteNotice, setRerouteNotice] = useState(null);
  const [currentInstruction, setCurrentInstruction] = useState(null);
  const [nextInstruction, setNextInstruction] = useState(null);
  const [toastAlert, setToastAlert] = useState(null);
  const [bannerAlert, setBannerAlert] = useState(null);
  const [provincesOnRoute, setProvincesOnRoute] = useState([]);
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false);
  const [speedUnitMenuOpen, setSpeedUnitMenuOpen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showMtoContactModal, setShowMtoContactModal] = useState(false);
  const [speedUnit, setSpeedUnit] = useState('auto');
  const [autoUnit, setAutoUnit] = useState('kmh');
  const [currentSpeedMps, setCurrentSpeedMps] = useState(null);
  // Number (m/s), the literal string 'unlimited' (see speedLimitAtIndex), or
  // null when unknown.
  const [currentSpeedLimit, setCurrentSpeedLimit] = useState(null);
  const [tripStats, setTripStats] = useState(null);
  const [savedRoutes, setSavedRoutes] = useState([]);
  const [showRouteDropdown, setShowRouteDropdown] = useState(false);
  const [routeDropdownExpanded, setRouteDropdownExpanded] = useState(false);
  const [routeSearchQuery, setRouteSearchQuery] = useState('');
  const [showSaveRouteModal, setShowSaveRouteModal] = useState(false);
  const [saveRouteName, setSaveRouteName] = useState('');
  const [savingRoute, setSavingRoute] = useState(false);
  const [saveRouteError, setSaveRouteError] = useState('');

  const effectiveSpeedUnit = speedUnit === 'auto' ? autoUnit : speedUnit;

  useEffect(() => {
    if (!mapInstance.current && mapRef.current) {
      const platform = new H.service.Platform({
        apikey: import.meta.env.VITE_HERE_API_KEY
      });
      const defaultLayers = platform.createDefaultLayers();
      defaultLayersRef.current = defaultLayers;
      // Requires the pinned 3.2.8.0 SDK in index.html — every 3.1.x build
      // (bisected 3.1.10.0 through 3.1.69.2) renders raster base layers
      // (including satellite) as a blank canvas, see index.html for details.
      const map = new H.Map(
        mapRef.current,
        mapLayer === 'satellite' ? getSatelliteLayers(defaultLayers, colorScheme).base : getTopoLayer(defaultLayers, colorScheme),
        {
          zoom: 5,
          center: { lat: 56.1304, lng: -106.3468 }
        }
      );
      new H.mapevents.Behavior(new H.mapevents.MapEvents(map));
      const ui = H.ui.UI.createDefault(map, defaultLayers);

      // Move the layer swatch, zoom buttons, and scale bar to bottom-left so
      // they stay clear of the trip stats panel docked bottom-right.
      ['mapsettings', 'zoom', 'scalebar'].forEach((controlName) => {
        const control = ui.getControl(controlName);
        if (control) control.setAlignment(H.ui.LayoutAlignment.LEFT_BOTTOM);
      });

      weighIconRef.current = new H.map.Icon(
        '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18">' +
          '<circle cx="9" cy="9" r="7" fill="#1d4ed8" stroke="white" stroke-width="2"/>' +
        '</svg>',
        { size: { w: 18, h: 18 }, anchor: { x: 9, y: 9 } }
      );

      inspectionIconRef.current = new H.map.Icon(
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
          '<circle cx="12" cy="12" r="10" fill="#0ea5e9" stroke="white" stroke-width="3"/>' +
        '</svg>',
        { size: { w: 24, h: 24 }, anchor: { x: 12, y: 12 } }
      );

      map.addEventListener('tap', (evt) => {
        const isStationMarker =
          weighMarkersRef.current.includes(evt.target) ||
          inspectionMarkersRef.current.includes(evt.target);
        if (bubbleRef.current && !isStationMarker) {
          uiRef.current.removeBubble(bubbleRef.current);
          bubbleRef.current = null;
        }
      });

      mapInstance.current = map;
      platformRef.current = platform;
      uiRef.current = ui;
    }
  }, []);

  // Swaps the base tile layer — route polylines, markers, and the grid
  // overlay are separate map objects/DOM layers untouched by setBaseLayer/
  // addLayer. Satellite's hybrid scheme is two layers (raster imagery base +
  // vector roads/labels overlay), since setBaseLayer only takes one; the topo
  // layer has no separate overlay. If satellite is currently showing, a
  // colorScheme change swaps its overlay in place; if satellite isn't showing,
  // the preference is picked up next time mapLayer switches back to it (this
  // effect re-runs on that change and re-evaluates getSatelliteLayers).
  useEffect(() => {
    if (!mapInstance.current || !defaultLayersRef.current) return;
    const map = mapInstance.current;
    const defaultLayers = defaultLayersRef.current;

    let baseLayer;
    let overlayLayer = null;
    if (mapLayer === 'satellite') {
      ({ base: baseLayer, overlay: overlayLayer } = getSatelliteLayers(defaultLayers, colorScheme));
    } else {
      baseLayer = getTopoLayer(defaultLayers, colorScheme);
    }

    if (map.getBaseLayer() !== baseLayer) {
      map.setBaseLayer(baseLayer);
    }
    if (hybridOverlayLayerRef.current !== overlayLayer) {
      if (hybridOverlayLayerRef.current) map.removeLayer(hybridOverlayLayerRef.current);
      if (overlayLayer) map.addLayer(overlayLayer);
      hybridOverlayLayerRef.current = overlayLayer;
    }
  }, [mapLayer, colorScheme]);

  // The route-normal color is baked into the polyline's style object at draw
  // time (HERE canvas objects can't read CSS vars live), so an already-drawn
  // route needs its style re-applied when the scheme changes underneath it.
  useEffect(() => {
    if (navPolylineRef.current) {
      navPolylineRef.current.setStyle(selectedRouteStyle());
    }
    routeOptions.forEach((opt) => {
      opt.polyline.setStyle(opt.id === selectedRouteId ? selectedRouteStyle() : UNSELECTED_ROUTE_STYLE);
    });
  }, [colorScheme, routeOptions, selectedRouteId]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      const startOutside = startWrapperRef.current && !startWrapperRef.current.contains(e.target);
      if (startOutside && !startInteractingRef.current) {
        setStartSuggestions([]);
      }
      const endOutside = endWrapperRef.current && !endWrapperRef.current.contains(e.target);
      if (endOutside && !endInteractingRef.current) {
        setEndSuggestions([]);
      }
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(e.target)) {
        setOptionsMenuOpen(false);
        setSpeedUnitMenuOpen(false);
      }
      if (routeDropdownRef.current && !routeDropdownRef.current.contains(e.target)) {
        setShowRouteDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data, error } = await supabase
          .from('vehicle_profiles')
          .select('speed_unit')
          .eq('user_id', user.id)
          .single();
        if (error) throw error;
        if (data?.speed_unit) setSpeedUnit(data.speed_unit);
      } catch (err) {
        console.error('Failed to load speed unit preference:', err);
      }
    })();
  }, []);

  const fetchSavedRoutes = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('saved_routes')
        .select('*')
        .eq('user_id', user.id)
        .order('last_used', { ascending: false, nullsFirst: false });
      if (error) throw error;
      setSavedRoutes(data || []);
    } catch (err) {
      console.error('Failed to load saved routes:', err);
    }
  };

  useEffect(() => {
    fetchSavedRoutes();
  }, []);

  // Pre-fills the route search card's start field with the driver's current
  // GPS position on mount, reverse-geocoded to a readable address (falling
  // back to raw coordinates if that fails). Uses a functional setState check
  // rather than the startLocation closure so it never clobbers text the user
  // typed while the (often multi-second) GPS fix/reverse-geocode was pending.
  // A denied/unavailable permission is silently ignored — the field just
  // stays empty for manual entry, same as before this existed.
  useEffect(() => {
    if (!navigator.geolocation) return;
    let cancelled = false;

    const applyStart = (text, position) => {
      if (cancelled) return;
      setStartLocation((current) => {
        if (current) return current;
        startResolvedRef.current = { text, position };
        return text;
      });
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return;
        const { latitude, longitude } = position.coords;
        const geoPosition = { lat: latitude, lng: longitude };
        driverPositionRef.current = geoPosition;
        const fallbackText = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        if (!platformRef.current) {
          applyStart(fallbackText, geoPosition);
          return;
        }
        platformRef.current.getSearchService().reverseGeocode({ at: `${latitude},${longitude}` }, (result) => {
          const label = result.items?.[0]?.address?.label;
          applyStart(label ? label.replace(/,\s*Canada$/i, '') : fallbackText, geoPosition);
        }, () => applyStart(fallbackText, geoPosition));
      },
      () => {}, // permission denied or unavailable — leave the field empty
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );

    return () => { cancelled = true; };
  }, []);

  // Re-checks the driver's country every few minutes while navigating so
  // auto-detect can flip units on a cross-border trip without polling constantly.
  useEffect(() => {
    if (!navigating) {
      if (autoUnitIntervalRef.current) {
        clearInterval(autoUnitIntervalRef.current);
        autoUnitIntervalRef.current = null;
      }
      return;
    }
    const detectUnit = () => {
      const pos = lastPositionRef.current;
      if (!pos || !platformRef.current) return;
      platformRef.current.getSearchService().reverseGeocode({ at: `${pos.lat},${pos.lng}` }, (result) => {
        const countryCode = result.items?.[0]?.address?.countryCode;
        setAutoUnit(countryCode === 'USA' ? 'mph' : 'kmh');
      }, () => {});
    };
    detectUnit();
    autoUnitIntervalRef.current = setInterval(detectUnit, 3 * 60 * 1000);
    return () => {
      if (autoUnitIntervalRef.current) clearInterval(autoUnitIntervalRef.current);
    };
  }, [navigating]);

  // Keeps the screen on for the duration of active turn-by-turn navigation —
  // a phone mounted in the cab would otherwise sleep mid-route. Unsupported
  // browsers (no navigator.wakeLock) are left alone entirely: navigation still
  // works, the screen just won't be forced awake. The OS/browser silently
  // releases the lock whenever the tab is backgrounded (app switch, screen
  // lock) without restoring it automatically, so a visibilitychange listener
  // re-requests it once the tab is foregrounded again if still navigating.
  useEffect(() => {
    if (!navigating || !('wakeLock' in navigator)) return;

    let cancelled = false;

    const requestWakeLock = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          lock.release().catch(() => {});
          return;
        }
        wakeLockRef.current = lock;
        lock.addEventListener('release', () => {
          if (wakeLockRef.current === lock) wakeLockRef.current = null;
        });
      } catch (err) {
        console.error('Wake Lock request failed:', err);
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [navigating]);

  const handleSelectSpeedUnit = async (unit) => {
    setSpeedUnit(unit);
    setOptionsMenuOpen(false);
    setSpeedUnitMenuOpen(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from('vehicle_profiles')
        .update({ speed_unit: unit })
        .eq('user_id', user.id);
      if (error) throw error;
    } catch (err) {
      console.error('Failed to save speed unit preference:', err);
    }
  };

  // Autosuggest (not Geocode) so business names/landmarks like "Canadian Tire
  // Motorsport Park" resolve, not just structured street addresses.
  // Proximity bias for autosuggest ranking (the `at` param — this only
  // re-ranks results, it doesn't exclude anything outside it, so it's safe
  // to combine with the `in: countryCode:CAN` scope below). Prefers a real
  // GPS fix; falls back to the map's current center rather than sending no
  // bias at all, and only falls all the way back to the fixed center-of-
  // Canada point if neither is available yet (e.g. before the map mounts).
  const getSearchBias = () => {
    if (driverPositionRef.current) {
      return `${driverPositionRef.current.lat},${driverPositionRef.current.lng}`;
    }
    const center = mapInstance.current?.getCenter();
    if (center) return `${center.lat},${center.lng}`;
    return '56.1304,-106.3468';
  };

  const resolveLocation = (query) => new Promise((resolve, reject) => {
    platformRef.current.getSearchService().autosuggest({
      q: query,
      in: 'countryCode:CAN',
      at: getSearchBias(),
      limit: 5
    }, (result) => {
      const match = (result.items || []).find((item) => item.position);
      match ? resolve({ lat: match.position.lat, lng: match.position.lng }) : reject(new Error(`Location not found: ${query}`));
    }, () => reject(new Error(`Location not found: ${query}`)));
  });

  const formatSuggestion = (item) => item.title.replace(/,\s*Canada$/i, '');

  const fetchSuggestions = (query, setSuggestions, setLoading, requestIdRef) => {
    const myRequestId = ++requestIdRef.current;
    if (!platformRef.current || query.trim().length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    platformRef.current.getSearchService().autosuggest({
      q: query,
      in: 'countryCode:CAN',
      at: getSearchBias(),
      limit: SUGGESTION_FETCH_LIMIT
    }, (result) => {
      if (requestIdRef.current !== myRequestId) return;
      const matches = (result.items || []).filter((item) => item.position && item.title);
      setSuggestions(matches);
      setLoading(false);
    }, () => {
      if (requestIdRef.current !== myRequestId) return;
      setLoading(false);
    });
  };

  const handleStartChange = (e) => {
    const value = e.target.value;
    setStartLocation(value);
    if (startResolvedRef.current?.text !== value) startResolvedRef.current = null;
    setStartSuggestionsExpanded(false);
    clearTimeout(startSuggestTimeout.current);
    startSuggestTimeout.current = setTimeout(() => {
      fetchSuggestions(value, setStartSuggestions, setStartSuggestLoading, startRequestId);
    }, 300);
  };

  const handleEndChange = (e) => {
    const value = e.target.value;
    setEndLocation(value);
    if (endResolvedRef.current?.text !== value) endResolvedRef.current = null;
    setEndSuggestionsExpanded(false);
    clearTimeout(endSuggestTimeout.current);
    endSuggestTimeout.current = setTimeout(() => {
      fetchSuggestions(value, setEndSuggestions, setEndSuggestLoading, endRequestId);
    }, 300);
  };

  const selectStartSuggestion = (item) => {
    const text = formatSuggestion(item);
    setStartLocation(text);
    startResolvedRef.current = { text, position: { lat: item.position.lat, lng: item.position.lng } };
    setStartSuggestions([]);
    setStartSuggestionsExpanded(false);
  };

  const selectEndSuggestion = (item) => {
    const text = formatSuggestion(item);
    setEndLocation(text);
    endResolvedRef.current = { text, position: { lat: item.position.lat, lng: item.position.lng } };
    setEndSuggestions([]);
    setEndSuggestionsExpanded(false);
  };

  const openWeighStationBubble = (marker, station) => {
    if (bubbleRef.current) {
      uiRef.current.removeBubble(bubbleRef.current);
      bubbleRef.current = null;
    }

    const phone = station.contacts?.[0]?.phone?.[0]?.value || 'Not available';
    const isOpen = station.openingHours?.[0]?.isOpen;
    const status = isOpen === true ? 'Open' : isOpen === false ? 'Closed' : 'Not available';
    const address = station.address?.label || 'Not available';

    const content = `
      <div style="font-family:sans-serif;font-size:13px;max-width:220px;">
        <strong style="display:block;margin-bottom:4px;font-size:14px;">${escapeHtml(station.title || 'Weigh Station')}</strong>
        <div style="margin-bottom:2px;"><strong>Address:</strong> ${escapeHtml(address)}</div>
        <div style="margin-bottom:2px;"><strong>Phone:</strong> ${escapeHtml(phone)}</div>
        <div><strong>Status:</strong> ${escapeHtml(status)}</div>
      </div>
    `;

    const bubble = new H.ui.InfoBubble(marker.getGeometry(), { content });
    uiRef.current.addBubble(bubble);
    bubbleRef.current = bubble;
  };

  const renderWeighStations = (stations) => {
    if (bubbleRef.current) {
      uiRef.current.removeBubble(bubbleRef.current);
      bubbleRef.current = null;
    }
    if (weighMarkersRef.current.length) {
      mapInstance.current.removeObjects(weighMarkersRef.current);
      weighMarkersRef.current = [];
    }

    const markers = stations.map((station) => {
      const marker = new H.map.Marker(
        { lat: station.position.lat, lng: station.position.lng },
        { icon: weighIconRef.current }
      );
      marker.addEventListener('tap', () => openWeighStationBubble(marker, station));
      return marker;
    });

    weighMarkersRef.current = markers;
    if (markers.length) mapInstance.current.addObjects(markers);
  };

  const openInspectionStationBubble = (marker, station) => {
    if (bubbleRef.current) {
      uiRef.current.removeBubble(bubbleRef.current);
      bubbleRef.current = null;
    }

    const content = `
      <div style="font-family:sans-serif;font-size:13px;max-width:220px;">
        <strong style="display:block;margin-bottom:4px;font-size:14px;">${escapeHtml(station.name || 'MTO Inspection Station')}</strong>
        <div style="margin-bottom:2px;"><strong>Highway:</strong> ${escapeHtml(station.highway || 'Not available')}</div>
        <div style="margin-bottom:2px;"><strong>Direction:</strong> ${escapeHtml(station.direction || 'Not available')}</div>
        <div style="margin-bottom:2px;"><strong>Region:</strong> ${escapeHtml(station.region || 'Not available')}</div>
        <div><strong>Phone:</strong> ${escapeHtml(station.phone || 'Not available')}</div>
      </div>
    `;

    const bubble = new H.ui.InfoBubble(marker.getGeometry(), { content });
    uiRef.current.addBubble(bubble);
    bubbleRef.current = bubble;
  };

  const renderInspectionStations = (stations) => {
    console.log(`Found ${stations.length} inspection station(s) near route`);
    currentInspectionStationsRef.current = stations;

    if (inspectionMarkersRef.current.length) {
      mapInstance.current.removeObjects(inspectionMarkersRef.current);
      inspectionMarkersRef.current = [];
    }

    const markers = stations
      .filter((station) => station.latitude != null && station.longitude != null)
      .map((station) => {
        const marker = new H.map.Marker(
          { lat: station.latitude, lng: station.longitude },
          { icon: inspectionIconRef.current }
        );
        marker.addEventListener('tap', () => openInspectionStationBubble(marker, station));
        return marker;
      });

    inspectionMarkersRef.current = markers;
    if (markers.length) mapInstance.current.addObjects(markers);
    setInspectionStationCount(markers.length);
  };

  const findWeighStations = (bounds) => {
    const bbox = `${bounds.getLeft()},${bounds.getBottom()},${bounds.getRight()},${bounds.getTop()}`;
    const search = platformRef.current.getSearchService();

    Promise.all(
      WEIGH_STATION_TERMS.map((term) => new Promise((resolve) => {
        search.discover(
          { q: term, in: `bbox:${bbox}`, limit: 100 },
          (result) => resolve(result.items || []),
          () => resolve([])
        );
      }))
    ).then((resultsByTerm) => {
      const seen = new Set();
      const stations = [];
      resultsByTerm.flat().forEach((item) => {
        if (!item.position || seen.has(item.id)) return;
        if (!bounds.containsPoint({ lat: item.position.lat, lng: item.position.lng })) return;
        seen.add(item.id);
        stations.push(item);
      });
      renderWeighStations(stations);
    });
  };

  const updateStationsForRoute = (bounds) => {
    findWeighStations(bounds);
    getStationsNearRoute(
      bounds.getTop(),
      bounds.getLeft(),
      bounds.getBottom(),
      bounds.getRight()
    ).then((stations) => {
      console.log('Inspection stations from Supabase:', stations);
      renderInspectionStations(stations);
    });
  };

  const selectRoute = (routeId) => {
    if (routeId === selectedRouteId) return;
    const selected = routeOptions.find((opt) => opt.id === routeId);
    if (!selected) return;

    setSelectedRouteId(routeId);

    routeOptions.forEach((opt) => {
      opt.polyline.setStyle(opt.id === routeId ? selectedRouteStyle() : UNSELECTED_ROUTE_STYLE);
    });
    mapInstance.current.removeObjects(routeOptions.map((opt) => opt.polyline));
    const ordered = [
      ...routeOptions.filter((opt) => opt.id !== routeId).map((opt) => opt.polyline),
      selected.polyline
    ];
    mapInstance.current.addObjects(ordered);

    updateStationsForRoute(selected.bounds);
  };

  const calculateSingleRoute = (router, params) => new Promise((resolve, reject) => {
    // Diagnostic for the "LIMIT UNKNOWN" speed-limit bug: the HERE JS SDK
    // doesn't expose the raw HTTP request it issues, so this reconstructs
    // the equivalent v8 REST URL (minus the API key) purely for console
    // inspection, and logs a sample of the first section's spans as
    // actually returned — confirms both that `spans=maxSpeed` really goes
    // out on the wire and what the response spans look like.
    const debugUrl = `https://router.hereapi.com/v8/routes?${new URLSearchParams(params).toString()}`;
    console.log('[routing] request URL:', debugUrl);
    router.calculateRoute(params, (result) => {
      if (result.routes?.length) {
        const spans = result.routes[0].sections?.[0]?.spans;
        console.log('[routing] response spans sample:', spans?.slice(0, 5) ?? '(no spans in response)');
        resolve(result.routes[0]);
      } else reject(new Error('No route found'));
    }, (err) => reject(err));
  });

  // overrideStart/overrideEnd let a saved route load bypass component state
  // entirely (setState is async, so state set moments earlier isn't visible
  // yet to this closure) by supplying { text, position } directly.
  const calculateRoute = async (overrideStart, overrideEnd) => {
    setStartSuggestions([]);
    setEndSuggestions([]);
    const startText = overrideStart?.text ?? startLocation;
    const endText = overrideEnd?.text ?? endLocation;
    if (!startText || !endText) {
      setError('Enter start and end locations');
      return;
    }
    if (overrideStart) setStartLocation(startText);
    if (overrideEnd) setEndLocation(endText);
    setSearching(true);
    setError('');
    setRouteOptions([]);
    setSelectedRouteId(null);
    setProvincesOnRoute([]);
    try {
      const resolve = (location, resolvedRef, override) => {
        if (override) return Promise.resolve(override.position);
        return resolvedRef.current?.text === location ? Promise.resolve(resolvedRef.current.position) : resolveLocation(location);
      };
      const [start, end] = await Promise.all([
        resolve(startText, startResolvedRef, overrideStart),
        resolve(endText, endResolvedRef, overrideEnd)
      ]);
      const router = platformRef.current.getRoutingService(null, 8);
      const baseParams = {
        origin: `${start.lat},${start.lng}`,
        destination: `${end.lat},${end.lng}`,
        transportMode: 'truck',
        return: 'polyline,summary,tolls,actions,instructions',
        spans: 'maxSpeed,length,duration',
        currency: 'CAD',
        'tolls[summaries]': 'total',
        'vehicle[grossWeight]': (profile?.weight || 25000) * 1000,
        'vehicle[height]': (profile?.height || 4) * 100,
        'vehicle[width]': (profile?.width || 2.5) * 100,
        'vehicle[length]': (profile?.length || 15) * 100,
        'vehicle[axleCount]': profile?.axles || 5
      };

      const results = await Promise.all(
        ROUTE_CONFIGS.map((config) => {
          const params = { ...baseParams, routingMode: config.routingMode };
          if (config.avoidTolls) params['avoid[features]'] = 'tollRoad';
          return calculateSingleRoute(router, params)
            .then((route) => ({ config, route }))
            .catch(() => null);
        })
      );

      const validResults = results.filter(Boolean);
      if (!validResults.length) {
        setError('No route found');
        setSearching(false);
        return;
      }

      if (bubbleRef.current) {
        uiRef.current.removeBubble(bubbleRef.current);
        bubbleRef.current = null;
      }
      mapInstance.current.removeObjects(mapInstance.current.getObjects());
      weighMarkersRef.current = [];
      inspectionMarkersRef.current = [];
      setInspectionStationCount(0);

      const options = validResults.map(({ config, route }) => {
        const section = route.sections[0];
        const polyline = new H.map.Polyline(H.geo.LineString.fromFlexiblePolyline(section.polyline));
        const bounds = polyline.getBoundingBox();
        const hasTolls = Boolean(section.tolls && section.tolls.length > 0);
        const km = Math.round(section.summary.length / 1000);
        const hours = Math.floor(section.summary.duration / 3600);
        const minutes = Math.floor((section.summary.duration % 3600) / 60);
        return {
          id: config.id,
          label: config.label,
          km,
          durationText: `${hours}h ${minutes}m`,
          durationSeconds: section.summary.duration,
          hasTolls,
          polyline,
          bounds,
          section
        };
      });

      // Confirms whether Fastest/No Tolls/Shortest are actually distinct
      // routes or coincidentally-equal stats: length/duration alone can't
      // tell the two apart (two genuinely different roads can happen to be
      // the same distance), so this also compares the raw encoded polyline
      // — identical strings mean HERE returned the literal same route for
      // more than one config, not just a same-length alternative.
      console.log('[routing] route option comparison:', options.map((opt) => ({
        id: opt.id,
        routingMode: ROUTE_CONFIGS.find((c) => c.id === opt.id)?.routingMode,
        avoidedTolls: Boolean(ROUTE_CONFIGS.find((c) => c.id === opt.id)?.avoidTolls),
        km: opt.km,
        durationText: opt.durationText,
        hasTolls: opt.hasTolls,
        polylineLength: opt.section.polyline.length
      })));
      const uniquePolylines = new Set(options.map((opt) => opt.section.polyline));
      if (uniquePolylines.size < options.length) {
        console.warn(`[routing] ${options.length - uniquePolylines.size} of ${options.length} route option(s) returned the exact same polyline as another option — HERE genuinely returned identical routes for those configs, not just coincidentally-equal stats.`);
      }

      options.forEach((opt, index) => {
        opt.polyline.setStyle(index === 0 ? selectedRouteStyle() : UNSELECTED_ROUTE_STYLE);
      });
      const orderedPolylines = [...options.slice(1).map((opt) => opt.polyline), options[0].polyline];
      const startMarker = new H.map.Marker({ lat: start.lat, lng: start.lng });
      const endMarker = new H.map.Marker({ lat: end.lat, lng: end.lng });
      mapInstance.current.addObjects([...orderedPolylines, startMarker, endMarker]);

      const combinedBounds = options.reduce((acc, opt) => {
        if (!acc) return opt.bounds;
        return new H.geo.Rect(
          Math.max(acc.getTop(), opt.bounds.getTop()),
          Math.min(acc.getLeft(), opt.bounds.getLeft()),
          Math.min(acc.getBottom(), opt.bounds.getBottom()),
          Math.max(acc.getRight(), opt.bounds.getRight())
        );
      }, null);
      mapInstance.current.getViewModel().setLookAtData({ bounds: combinedBounds });

      routeStartRef.current = { lat: start.lat, lng: start.lng };
      routeEndRef.current = { lat: end.lat, lng: end.lng };
      setRouteOptions(options);
      setSelectedRouteId(options[0].id);
      setProvincesOnRoute(getProvincesForBounds(combinedBounds));
      updateStationsForRoute(options[0].bounds);
      setSearching(false);
    } catch (err) {
      setError(err.message);
      setSearching(false);
    }
  };

  const loadSavedRoute = async (route) => {
    setShowRouteDropdown(false);
    setRouteDropdownExpanded(false);
    setRouteSearchQuery('');

    const startOverride = { text: route.start_location, position: { lat: route.start_lat, lng: route.start_lng } };
    const endOverride = { text: route.end_location, position: { lat: route.end_lat, lng: route.end_lng } };
    startResolvedRef.current = startOverride;
    endResolvedRef.current = endOverride;

    await calculateRoute(startOverride, endOverride);

    const updates = { load_count: (route.load_count || 0) + 1, last_used: new Date().toISOString() };
    setSavedRoutes((prev) => prev.map((r) => (r.id === route.id ? { ...r, ...updates } : r)));
    const { error: updateError } = await supabase.from('saved_routes').update(updates).eq('id', route.id);
    if (updateError) console.error('Failed to update saved route usage:', updateError);
  };

  const handleSaveRoute = async () => {
    const name = saveRouteName.trim();
    if (!name) {
      setSaveRouteError('Enter a name for this route');
      return;
    }
    const selected = routeOptions.find((opt) => opt.id === selectedRouteId);
    if (!selected || !routeStartRef.current || !routeEndRef.current) return;

    setSavingRoute(true);
    setSaveRouteError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You must be signed in to save routes');
      const { error: insertError } = await supabase.from('saved_routes').insert({
        user_id: user.id,
        route_name: name,
        start_location: startLocation,
        end_location: endLocation,
        start_lat: routeStartRef.current.lat,
        start_lng: routeStartRef.current.lng,
        end_lat: routeEndRef.current.lat,
        end_lng: routeEndRef.current.lng,
        distance: selected.km,
        duration: selected.durationSeconds,
        load_count: 0,
        last_used: null
      });
      if (insertError) throw insertError;
      setShowSaveRouteModal(false);
      setSaveRouteName('');
      fetchSavedRoutes();
    } catch (err) {
      setSaveRouteError(err.message);
    } finally {
      setSavingRoute(false);
    }
  };

  // Chase-camera: rotates the map to the driver's heading and tilts it to a
  // driving-height perspective, centered on the current GPS fix. Screen-space
  // forward-biasing (recentering below screen-center) doesn't compose with a
  // rotated/tilted camera the way it did for the old flat north-up view, so
  // this replaces that with HERE's own look-at heading/tilt instead.
  const updateNavCamera = (lat, lng, headingDeg) => {
    mapInstance.current.getViewModel().setLookAtData({
      position: { lat, lng },
      zoom: NAV_ZOOM,
      heading: headingDeg,
      tilt: NAV_TILT
    });
  };

  // Single place that actually paints a driver pose — feeds the exact same
  // heading value to both the marker icon rotation and the map's course-up
  // bearing so they can never drift apart, then records what's now on
  // screen as the animation's next "from" anchor.
  const renderDriverPose = (lat, lng, headingDeg) => {
    const pos = { lat, lng };
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new H.map.Marker(pos, { icon: createDriverIcon(headingDeg) });
      mapInstance.current.addObject(driverMarkerRef.current);
    } else {
      driverMarkerRef.current.setGeometry(pos);
      driverMarkerRef.current.setIcon(createDriverIcon(headingDeg));
    }
    updateNavCamera(lat, lng, headingDeg);
    displayedPoseRef.current = { lat, lng, heading: headingDeg };
  };

  // Runs continuously while navigating, animating the marker/camera from
  // their last on-screen pose to the latest GPS fix over the interval
  // between fixes, instead of snapping on every ~1s watchPosition callback.
  // Heading interpolates along the shortest angular path so a 359°→1° turn
  // doesn't spin the long way round.
  const stepNavAnimation = () => {
    const anim = navAnimRef.current;
    if (anim && !anim.settled) {
      const now = performance.now();
      const t = anim.duration > 0 ? Math.min(1, (now - anim.startTime) / anim.duration) : 1;
      const lat = anim.fromLat + (anim.toLat - anim.fromLat) * t;
      const lng = anim.fromLng + (anim.toLng - anim.fromLng) * t;
      const heading = normalizeDegrees(anim.fromHeading + shortestAngleDelta(anim.fromHeading, anim.toHeading) * t);
      renderDriverPose(lat, lng, heading);
      if (t >= 1) anim.settled = true;
    }
    navRafRef.current = requestAnimationFrame(stepNavAnimation);
  };

  const applyNavRoute = (section) => {
    const points = decodeRoutePoints(section.polyline);
    const cumulative = buildCumulativeDistances(points);
    navRoutePointsRef.current = points;
    navCumulativeRef.current = cumulative;
    navActionsRef.current = buildNavActions(section, cumulative);
    navSpansRef.current = section.spans || [];
    navTotalLengthRef.current = section.summary?.length ?? cumulative[cumulative.length - 1] ?? 0;
    navTotalDurationRef.current = section.summary?.duration ?? 0;
    const tollTotal = section.summary?.tolls?.total;
    navTollRef.current = tollTotal ? { value: tollTotal.value, currency: tollTotal.currency } : null;
    navCumulativeDurationRef.current = buildCumulativeSpanDurations(
      points,
      navSpansRef.current,
      cumulative,
      navTotalDurationRef.current
    );
    lastIndexRef.current = 0;

    // A new/recalculated route invalidates action offsets, so drop all
    // per-point alert bookkeeping and any alert currently on screen.
    alertStateRef.current = new Map();
    clearTimeout(toastTimeoutRef.current);
    setToastAlert(null);
    setBannerAlert(null);

    // Seed trip stats from the route summary right away so the panel shows
    // real numbers before the first GPS fix arrives; handlePositionUpdate
    // overwrites this with progress-adjusted values once GPS is live.
    setTripStats({
      remainingKm: navTotalLengthRef.current / 1000,
      remainingSeconds: navTotalDurationRef.current,
      etaMs: Date.now() + navTotalDurationRef.current * 1000,
      stationsAhead: currentInspectionStationsRef.current?.length || 0,
      tollValue: navTollRef.current?.value ?? null,
      tollCurrency: navTollRef.current?.currency ?? null
    });

    if (navPolylineRef.current) {
      mapInstance.current.removeObject(navPolylineRef.current);
    }
    const polyline = new H.map.Polyline(H.geo.LineString.fromFlexiblePolyline(section.polyline), { style: selectedRouteStyle() });
    mapInstance.current.addObject(polyline);
    navPolylineRef.current = polyline;

    updateStationsForRoute(polyline.getBoundingBox());
  };

  const recalculateFromCurrentPosition = async (lat, lng) => {
    try {
      const destination = routeEndRef.current;
      if (!destination || !platformRef.current) return;
      const router = platformRef.current.getRoutingService(null, 8);
      const rerouteParams = {
        origin: `${lat},${lng}`,
        destination: `${destination.lat},${destination.lng}`,
        transportMode: 'truck',
        routingMode: 'fast',
        return: 'polyline,summary,tolls,actions,instructions',
        spans: 'maxSpeed,length,duration',
        currency: 'CAD',
        'tolls[summaries]': 'total',
        'vehicle[grossWeight]': (profile?.weight || 25000) * 1000,
        'vehicle[height]': (profile?.height || 4) * 100,
        'vehicle[width]': (profile?.width || 2.5) * 100,
        'vehicle[length]': (profile?.length || 15) * 100,
        'vehicle[axleCount]': profile?.axles || 5
      };
      // Explicit, separate-from-the-generic-request-log confirmation that
      // the reroute carries the same dimensional/weight constraints as the
      // original route — dropping these on a reroute could send an oversize
      // load onto a restricted road or under a low bridge.
      console.log('[reroute] transportMode:', rerouteParams.transportMode, 'vehicle params:', {
        grossWeight: rerouteParams['vehicle[grossWeight]'],
        height: rerouteParams['vehicle[height]'],
        width: rerouteParams['vehicle[width]'],
        length: rerouteParams['vehicle[length]'],
        axleCount: rerouteParams['vehicle[axleCount]']
      });
      const route = await calculateSingleRoute(router, rerouteParams);
      applyNavRoute(route.sections[0]);
      offRouteStreakRef.current = 0;
      clearTimeout(rerouteNoticeTimeoutRef.current);
      setRerouteNotice({ type: 'success', text: 'New route active' });
      rerouteNoticeTimeoutRef.current = setTimeout(() => {
        setRerouteNotice((current) => (current?.type === 'success' ? null : current));
      }, REROUTE_SUCCESS_NOTICE_MS);
    } catch (err) {
      console.error('Recalculation failed:', err);
      clearTimeout(rerouteNoticeTimeoutRef.current);
      setRerouteNotice({ type: 'failed', text: "Rerouting failed — couldn't reach the routing service. Retrying…" });
    } finally {
      setRecalculating(false);
    }
  };

  const handlePositionError = (err) => {
    console.error('Geolocation error:', err);
    setError(`Location error: ${err.message}`);
  };

  const handlePositionUpdate = (position) => {
    const { latitude, longitude, speed } = position.coords;
    const currentPos = { lat: latitude, lng: longitude };
    const prev = lastPositionRef.current;
    const prevTimestamp = lastFixTimestampRef.current;
    lastPositionRef.current = currentPos;
    lastFixTimestampRef.current = position.timestamp;
    driverPositionRef.current = currentPos;

    const points = navRoutePointsRef.current;
    const cumulative = navCumulativeRef.current;

    let index = lastIndexRef.current;
    let distance = 0;
    if (points && points.length) {
      ({ index, distance } = nearestPointIndex(points, latitude, longitude, lastIndexRef.current, 80));
      lastIndexRef.current = index;
    }
    const onRoute = Boolean(points && points.length) && distance <= OFF_ROUTE_METERS;

    const speedMps = typeof speed === 'number' && !Number.isNaN(speed) ? Math.max(0, speed) : null;
    // coords.speed isn't reported by every browser/device — fall back to
    // distance/time between fixes so the low-speed heading gate below still
    // has something to check against.
    const estimatedSpeedMps = speedMps != null
      ? speedMps
      : (prev && prevTimestamp
        ? haversineMeters(prev, currentPos) / Math.max(0.001, (position.timestamp - prevTimestamp) / 1000)
        : null);

    // Raw GeolocationPosition.coords.heading is intentionally never used
    // here — it's often null, and even when present is frequently noisy or
    // outright wrong at low/moderate truck speed. See deriveTargetHeading.
    const rawHeading = deriveTargetHeading(onRoute, points, cumulative, index, prev, currentPos);
    const belowHeadingSpeed = estimatedSpeedMps != null && estimatedSpeedMps < MIN_HEADING_SPEED_MPS;
    if (rawHeading != null && (!belowHeadingSpeed || smoothedHeadingRef.current == null)) {
      if (onRoute || smoothedHeadingRef.current == null) {
        // Route-derived heading only changes when the matched index moves
        // onto a genuinely different-angled segment, so it's applied
        // directly — smoothing it would just add lag to real turns.
        smoothedHeadingRef.current = rawHeading;
      } else {
        // The off-route fallback (bearing between consecutive GPS fixes) is
        // noisier, so it's eased in via a rolling blend rather than applied
        // directly, per-fix jitter gets damped while real direction changes
        // still come through within a couple of fixes.
        smoothedHeadingRef.current = normalizeDegrees(
          smoothedHeadingRef.current + shortestAngleDelta(smoothedHeadingRef.current, rawHeading) * 0.4
        );
      }
    }
    const targetHeading = smoothedHeadingRef.current ?? 0;

    const isFirstFix = displayedPoseRef.current == null;
    const fromPose = isFirstFix ? { lat: latitude, lng: longitude, heading: targetHeading } : displayedPoseRef.current;
    const rawDuration = prevTimestamp ? position.timestamp - prevTimestamp : NAV_ANIM_DEFAULT_MS;
    const duration = isFirstFix ? 0 : Math.min(NAV_ANIM_MAX_MS, Math.max(NAV_ANIM_MIN_MS, rawDuration || NAV_ANIM_DEFAULT_MS));
    navAnimRef.current = {
      fromLat: fromPose.lat,
      fromLng: fromPose.lng,
      fromHeading: fromPose.heading,
      toLat: latitude,
      toLng: longitude,
      toHeading: targetHeading,
      startTime: performance.now(),
      duration,
      settled: false
    };
    if (isFirstFix) {
      // Nothing rendered yet to animate from — paint the first fix immediately.
      renderDriverPose(latitude, longitude, targetHeading);
    }

    if (!points || !points.length) return;

    // Hysteresis: a single fix past REROUTE_TRIGGER_METERS only starts the
    // streak — it takes REROUTE_CONFIRM_FIXES in a row (a few seconds of
    // GPS fixes) before a reroute is actually confirmed, so one noisy fix
    // or a wide lane doesn't fire it. Any fix back within range resets it.
    if (distance > REROUTE_TRIGGER_METERS) {
      offRouteStreakRef.current += 1;
    } else {
      offRouteStreakRef.current = 0;
    }

    if (offRouteStreakRef.current >= REROUTE_CONFIRM_FIXES) {
      const now = Date.now();
      const cooldownElapsed = now - lastRerouteAttemptRef.current >= REROUTE_COOLDOWN_MS;
      // recalculatingRef guards against overlapping in-flight requests;
      // cooldownElapsed rate-limits attempts (including retries after a
      // failure) to at most one every REROUTE_COOLDOWN_MS, rather than
      // firing again on literally the next ~1s GPS fix while still off-route.
      if (!recalculatingRef.current && cooldownElapsed) {
        recalculatingRef.current = true;
        lastRerouteAttemptRef.current = now;
        setRecalculating(true);
        recalculateFromCurrentPosition(latitude, longitude).finally(() => {
          recalculatingRef.current = false;
        });
      }
      return;
    }

    const travelled = cumulative[index];
    const upcoming = navActionsRef.current.filter((a) => a.distanceMeters >= travelled - 20);
    const next = upcoming[0] || null;
    const after = upcoming[1] || null;
    setCurrentInstruction(next ? { text: next.text, distanceMeters: Math.max(0, next.distanceMeters - travelled) } : null);
    setNextInstruction(after ? { text: after.text } : null);

    setCurrentSpeedMps(speedMps);
    setCurrentSpeedLimit(speedLimitAtIndex(navSpansRef.current, index));

    const totalLength = navTotalLengthRef.current;
    const totalDuration = navTotalDurationRef.current;
    const traveledDuration = navCumulativeDurationRef.current[index] ?? 0;
    setTripStats({
      remainingKm: Math.max(0, totalLength - travelled) / 1000,
      remainingSeconds: Math.max(0, totalDuration - traveledDuration),
      etaMs: Date.now() + Math.max(0, totalDuration - traveledDuration) * 1000,
      stationsAhead: countStationsAhead(points, currentInspectionStationsRef.current, index),
      tollValue: navTollRef.current?.value ?? null,
      tollCurrency: navTollRef.current?.currency ?? null
    });

    updateProximityAlerts(currentPos, points, index);
  };

  // Builds the list of upcoming MTO inspection stations, then drives the
  // two-stage toast/banner alert pipeline: a 2km toast that fires once per
  // station, and a persistent 500m banner with a live countdown that clears
  // 100m past the station. Turn/exit maneuvers aren't alerted here — they're
  // already continuously visible in the top instruction banner's NEXT/THEN
  // text, so a second banner for them would just repeat the same turn.
  const updateProximityAlerts = (currentPos, points, index) => {
    const candidates = (currentInspectionStationsRef.current || [])
      .filter((station) => station.latitude != null && station.longitude != null)
      .filter((station) => {
        const { index: stationIndex } = nearestPointIndex(points, station.latitude, station.longitude, 0, points.length - 1);
        return stationIndex >= index - 3;
      })
      .map((station) => ({
        id: `station-${station.id ?? `${station.latitude},${station.longitude}`}`,
        name: station.name || STATION_ALERT_STYLE.defaultName,
        distanceMeters: haversineMeters(currentPos, { lat: station.latitude, lng: station.longitude })
      }));

    const bannerCandidate = candidates
      .filter((p) => p.distanceMeters <= ALERT_BANNER_METERS && p.distanceMeters > -ALERT_PASSED_METERS)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)[0] || null;

    setBannerAlert(bannerCandidate);

    const toastCandidate = candidates
      .filter((p) => p.distanceMeters <= ALERT_TOAST_METERS && p.distanceMeters > ALERT_BANNER_METERS)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)[0] || null;

    if (toastCandidate) {
      const state = alertStateRef.current.get(toastCandidate.id);
      if (!state?.toastShown) {
        alertStateRef.current.set(toastCandidate.id, { toastShown: true });
        clearTimeout(toastTimeoutRef.current);
        setToastAlert(toastCandidate);
        toastTimeoutRef.current = setTimeout(() => {
          setToastAlert((current) => (current?.id === toastCandidate.id ? null : current));
        }, ALERT_TOAST_DURATION_MS);
      }
    }
  };

  const dismissToastAlert = () => {
    clearTimeout(toastTimeoutRef.current);
    setToastAlert(null);
  };

  const startNavigation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser.');
      return;
    }
    const selected = routeOptions.find((opt) => opt.id === selectedRouteId);
    if (!selected) return;

    setError('');
    setRecalculating(false);
    clearTimeout(rerouteNoticeTimeoutRef.current);
    setRerouteNotice(null);
    setCurrentInstruction(null);
    setNextInstruction(null);
    setToastAlert(null);
    setBannerAlert(null);
    setCurrentSpeedMps(null);
    setCurrentSpeedLimit(null);
    setTripStats(null);
    setOptionsMenuOpen(false);
    setSpeedUnitMenuOpen(false);
    lastPositionRef.current = null;
    lastIndexRef.current = 0;
    lastFixTimestampRef.current = null;
    smoothedHeadingRef.current = null;
    displayedPoseRef.current = null;
    navAnimRef.current = null;
    recalculatingRef.current = false;
    offRouteStreakRef.current = 0;
    lastRerouteAttemptRef.current = 0;

    mapInstance.current.removeObjects(routeOptions.map((opt) => opt.polyline));
    applyNavRoute(selected.section);
    setNavigating(true);
    onNavigatingChange?.(true);

    watchIdRef.current = navigator.geolocation.watchPosition(handlePositionUpdate, handlePositionError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000
    });
    navRafRef.current = requestAnimationFrame(stepNavAnimation);
  };

  const stopNavigation = () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (navRafRef.current != null) {
      cancelAnimationFrame(navRafRef.current);
      navRafRef.current = null;
    }
    navAnimRef.current = null;
    displayedPoseRef.current = null;
    if (driverMarkerRef.current) {
      mapInstance.current.removeObject(driverMarkerRef.current);
      driverMarkerRef.current = null;
    }
    if (navPolylineRef.current) {
      mapInstance.current.removeObject(navPolylineRef.current);
      navPolylineRef.current = null;
    }

    clearTimeout(toastTimeoutRef.current);
    alertStateRef.current = new Map();

    // Back to a flat, north-up overview — the chase-camera heading/tilt only
    // apply during active turn-by-turn navigation.
    mapInstance.current.getViewModel().setLookAtData({ heading: 0, tilt: 0 });

    setNavigating(false);
    onNavigatingChange?.(false);
    setRecalculating(false);
    clearTimeout(rerouteNoticeTimeoutRef.current);
    setRerouteNotice(null);
    setCurrentInstruction(null);
    setNextInstruction(null);
    setToastAlert(null);
    setBannerAlert(null);
    setCurrentSpeedMps(null);
    setCurrentSpeedLimit(null);
    setTripStats(null);

    const selected = routeOptions.find((opt) => opt.id === selectedRouteId);
    if (selected) {
      routeOptions.forEach((opt) => {
        opt.polyline.setStyle(opt.id === selectedRouteId ? selectedRouteStyle() : UNSELECTED_ROUTE_STYLE);
      });
      mapInstance.current.addObjects(routeOptions.map((opt) => opt.polyline));
      updateStationsForRoute(selected.bounds);
      mapInstance.current.getViewModel().setLookAtData({ bounds: selected.bounds });
    }
  };

  // Top section shows the 3 most-loaded routes; "See more" reveals the rest.
  // A search query overrides both and filters by name across all routes.
  const startDropdownOpen = startSuggestLoading || startSuggestions.length > 0;
  const endDropdownOpen = endSuggestLoading || endSuggestions.length > 0;

  const routeCardMaxHeight = useAvailableViewportHeight(CARD_MARGIN);
  const routeOptionsListHeight = useOptionsListHeight(routeCardRef, routeCardHeaderRef, routeCardFooterRef, routeCardMaxHeight, routeOptions.length, ROUTE_OPTION_ROW_HEIGHT);
  const permitPanelAvailableHeight = useAvailableViewportHeight(PERMIT_PANEL_MARGIN);
  const permitPanelMaxHeight = permitPanelAvailableHeight == null ? PERMIT_PANEL_MAX_HEIGHT : Math.min(PERMIT_PANEL_MAX_HEIGHT, permitPanelAvailableHeight);

  const trimmedRouteSearch = routeSearchQuery.trim().toLowerCase();
  const displayedSavedRoutes = trimmedRouteSearch
    ? savedRoutes.filter((r) => r.route_name.toLowerCase().includes(trimmedRouteSearch))
    : routeDropdownExpanded
      ? savedRoutes
      : [...savedRoutes].sort((a, b) => (b.load_count || 0) - (a.load_count || 0)).slice(0, 3);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <style>{`
        @media (max-width: 480px) {
          .mt-route-card {
            /* Corner-anchored at the same 16px margin as the hamburger
               drawer (MenuDrawer.jsx), not a large fixed top offset — this
               card and the hamburger button occupy the same row across the
               top of the screen, so width is capped to leave the button's
               56px + 16px margin + a 16px gap clear on the right rather than
               reaching under it (16 possible px of card margin already
               spoken for on the left, hence the 104px reservation: 56 + 16
               + 16 + 16). max-height mirrors the drawer's own
               calc(100vh - 32px) (16px margin top and bottom) now that top
               starts at 16px instead of 84px. */
            left: 16px !important;
            top: 16px !important;
            width: min(320px, calc(100vw - 104px)) !important;
            /* min() of a safe-area-aware CSS fallback and --card-max-height
               (this component's own VisualViewport measurement, set as an
               inline custom property — see the style object above) so the
               card is bounded by whichever is actually tighter: relevant
               before the JS measurement lands on first paint, and on any
               browser without VisualViewport (--card-max-height then stays
               unset, so var()'s 100vh fallback makes the calc() the only
               real constraint). The card itself no longer scrolls as a
               whole (overflow: hidden) — its header and footer are fixed
               size and only the route-options list in between scrolls, so
               the Save/Start buttons below it can never be the thing that
               gets clipped. */
            max-height: min(calc(100vh - 32px - env(safe-area-inset-bottom, 0px)), var(--card-max-height, 100vh)) !important;
            overflow: hidden !important;
          }
          .mt-route-card.mt-has-permits {
            /* Leaves room below for the bottom-anchored permit strip
               (230px reserved height + gaps) so the two never overlap. */
            max-height: min(max(160px, calc(100vh - 354px - env(safe-area-inset-bottom, 0px))), var(--card-max-height, 100vh)) !important;
          }
          .mt-permit-panel {
            left: 12px !important;
            right: 12px !important;
          }
          .mt-trip-stats {
            flex-wrap: wrap;
          }
          .mt-trip-stats > div {
            flex: 1 1 50% !important;
            box-sizing: border-box;
          }
          .mt-trip-stats > div:nth-child(3) {
            border-left: none !important;
            border-top: 1px solid var(--color-grid-line);
          }
          .mt-trip-stats > div:nth-child(4) {
            border-top: 1px solid var(--color-grid-line);
          }
        }
      `}</style>
      {navigating && (
        <>
          {/* Instruction banner, recalculating pill, and station alert all
              stack in normal document flow (not independent absolutely-
              positioned guesses at each other's height) so a long wrapped
              instruction can never get covered by the elements below it. */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 2500,
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                ...PANEL_STYLE,
                borderTop: 'none',
                borderLeft: 'none',
                borderRight: 'none',
                borderBottom: '1px solid var(--color-border)',
                padding: 'calc(14px + env(safe-area-inset-top)) 16px 16px 20px'
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {currentInstruction ? (
                  <>
                    <div style={{ ...LABEL_STYLE, display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                      <span style={{ color: 'var(--color-route-normal)' }}>NEXT</span>
                      <span>·</span>
                      <span style={{ ...MONO_STYLE, fontSize: '12px', fontWeight: 700, textTransform: 'none', letterSpacing: 'normal', color: 'var(--color-text-primary)' }}>
                        {formatDistance(currentInstruction.distanceMeters)}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '21px', fontWeight: 600, letterSpacing: '-0.01em', marginTop: '4px', overflowWrap: 'break-word' }}>
                      {currentInstruction.text}
                    </div>
                    {nextInstruction && (
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                        <span style={LABEL_STYLE}>THEN</span>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--color-text-muted)' }}>{nextInstruction.text}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '16px' }}>Follow the highlighted route</div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
                <div ref={optionsMenuRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => setOptionsMenuOpen((open) => !open)}
                    aria-label="Options menu"
                    style={{
                      width: '44px',
                      height: '44px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 0,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-panel)',
                      color: 'var(--color-text-primary)',
                      fontSize: '18px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.25)'
                    }}
                  >
                    ⋮
                  </button>

                  {optionsMenuOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '48px',
                        right: 0,
                        width: '210px',
                        background: 'var(--color-panel)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 0,
                        boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
                        overflow: 'hidden'
                      }}
                    >
                      <button
                        onClick={() => { setShowProfileModal(true); setOptionsMenuOpen(false); }}
                        style={MENU_ITEM_STYLE}
                      >
                        View Profile
                      </button>
                      <button
                        onClick={() => { setShowMtoContactModal(true); setOptionsMenuOpen(false); }}
                        style={MENU_ITEM_STYLE}
                      >
                        MTO Contact Info
                      </button>
                      <button
                        onClick={() => setSpeedUnitMenuOpen((open) => !open)}
                        style={{ ...MENU_ITEM_STYLE, borderBottom: speedUnitMenuOpen ? '1px solid var(--color-border)' : 'none' }}
                      >
                        Speed Units {speedUnitMenuOpen ? '▲' : '▼'}
                      </button>
                      {speedUnitMenuOpen && SPEED_UNIT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => handleSelectSpeedUnit(opt.value)}
                          style={{
                            ...MENU_ITEM_STYLE,
                            paddingLeft: '26px',
                            fontSize: '12px',
                            background: speedUnit === opt.value ? 'color-mix(in srgb, var(--color-route-normal) 15%, var(--color-panel))' : 'var(--color-panel)',
                            fontWeight: speedUnit === opt.value ? 700 : 400
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    ...PANEL_STYLE,
                    borderLeft: '3px solid var(--color-route-normal)',
                    padding: '8px 14px',
                    textAlign: 'center',
                    minWidth: '96px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.25)'
                  }}
                >
                  <div style={{ ...MONO_STYLE, fontSize: '26px', fontWeight: 700, lineHeight: 1.1, color: currentSpeedMps != null ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                    {formatSpeedValue(currentSpeedMps, effectiveSpeedUnit)}
                  </div>
                  <div style={{ ...LABEL_STYLE, marginBottom: '6px' }}>
                    {unitLabel(effectiveSpeedUnit)}
                  </div>
                  <div style={{ ...LABEL_STYLE, borderTop: '1px solid var(--color-grid-line)', paddingTop: '6px' }}>
                    LIMIT{' '}
                    {currentSpeedLimit === 'unlimited' ? (
                      <span style={{ ...MONO_STYLE, textTransform: 'none', color: 'var(--color-text-primary)', fontWeight: 600 }}>
                        no limit
                      </span>
                    ) : currentSpeedLimit != null ? (
                      <span style={{ ...MONO_STYLE, textTransform: 'none', color: 'var(--color-text-primary)', fontWeight: 600 }}>
                        {formatSpeedValue(currentSpeedLimit, effectiveSpeedUnit)} {unitLabel(effectiveSpeedUnit)}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>unknown</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {recalculating ? (
              <div
                style={{
                  alignSelf: 'center',
                  marginTop: '8px',
                  background: '#fbbf24',
                  color: '#78350f',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-soft)',
                  fontFamily: 'var(--font-display)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontSize: '13px',
                  fontWeight: 700
                }}
              >
                Rerouting…
              </div>
            ) : rerouteNotice && (
              <div
                style={{
                  alignSelf: 'center',
                  marginTop: '8px',
                  background: rerouteNotice.type === 'failed' ? '#dc2626' : '#16a34a',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-soft)',
                  fontFamily: 'var(--font-display)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontSize: '13px',
                  fontWeight: 700
                }}
              >
                {rerouteNotice.text}
              </div>
            )}

            {bannerAlert ? (
              <div
                style={{
                  alignSelf: 'flex-start',
                  marginTop: '8px',
                  marginLeft: '16px',
                  maxWidth: '280px',
                  background: STATION_ALERT_STYLE.background,
                  color: STATION_ALERT_STYLE.color,
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-soft)',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  boxShadow: '0 4px 14px rgba(0,0,0,0.4)'
                }}
              >
                ⚠️ {bannerAlert.name} — <span style={MONO_STYLE}>{Math.max(0, Math.round(bannerAlert.distanceMeters))}m</span> ahead
              </div>
            ) : toastAlert && (
              <div
                style={{
                  alignSelf: 'flex-start',
                  marginTop: '8px',
                  marginLeft: '16px',
                  maxWidth: '280px',
                  background: 'var(--color-panel)',
                  color: 'var(--color-text-primary)',
                  padding: '12px 44px 12px 14px',
                  borderRadius: 'var(--radius-soft)',
                  border: '1px solid var(--color-border)',
                  borderLeft: `4px solid ${STATION_ALERT_STYLE.background}`,
                  boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
                  position: 'relative'
                }}
              >
                <button
                  onClick={dismissToastAlert}
                  aria-label="Dismiss alert"
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: '44px',
                    height: '44px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-text-muted)',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    lineHeight: 1
                  }}
                >
                  ✕
                </button>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 700 }}>
                  Incoming: {toastAlert.name}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={stopNavigation}
            style={{
              position: 'absolute',
              bottom: 'calc(96px + env(safe-area-inset-bottom))',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 2500,
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
              padding: '14px 32px',
              background: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: 0,
              fontFamily: 'var(--font-display)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 700,
              fontSize: '14px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
              cursor: 'pointer'
            }}
          >
            Stop Navigation
          </button>

          {tripStats && (
            <div
              className="mt-trip-stats"
              style={{
                position: 'absolute',
                left: '16px',
                right: '16px',
                bottom: 'calc(16px + env(safe-area-inset-bottom))',
                zIndex: 2500,
                display: 'flex',
                ...PANEL_STYLE,
                borderRadius: 'var(--radius-soft)',
                borderLeft: '4px solid var(--color-route-normal)',
                boxShadow: '0 2px 14px rgba(0,0,0,0.3)'
              }}
            >
              {[
                { label: 'DISTANCE', value: tripStats.remainingKm.toFixed(0), unit: 'KM' },
                {
                  label: 'ETA',
                  value: new Date(tripStats.etaMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
                  unit: null
                },
                { label: 'MTO AHEAD', value: String(tripStats.stationsAhead ?? 0), unit: null },
                {
                  label: 'TOLL',
                  value: tripStats.tollValue != null ? tripStats.tollValue.toFixed(2) : '—',
                  unit: tripStats.tollValue != null ? tripStats.tollCurrency : null
                }
              ].map((col, i) => (
                <div
                  key={col.label}
                  style={{
                    flex: 1,
                    padding: '10px 6px',
                    textAlign: 'center',
                    borderLeft: i > 0 ? '1px solid var(--color-grid-line)' : 'none'
                  }}
                >
                  <div style={{ ...MONO_STYLE, fontSize: '17px', fontWeight: 700 }}>
                    {col.value}
                    {col.unit && <span style={{ ...LABEL_STYLE, marginLeft: '3px', fontSize: '10px' }}>{col.unit}</span>}
                  </div>
                  <div style={{ ...LABEL_STYLE, marginTop: '4px' }}>{col.label}</div>
                </div>
              ))}
            </div>
          )}

          {showProfileModal && (
            <div
              onClick={() => setShowProfileModal(false)}
              style={{ position: 'absolute', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <div onClick={(e) => e.stopPropagation()} style={{ ...PANEL_STYLE, padding: '20px', width: '260px' }}>
                <h3 style={{ marginBottom: '12px', ...LABEL_STYLE, fontSize: '12px', color: 'var(--color-text-primary)' }}>Vehicle Profile</h3>
                <div style={{ ...MONO_STYLE, fontSize: '13px', lineHeight: '1.8' }}>
                  <div>Height: {profile?.height || 'Not set'} m</div>
                  <div>Width: {profile?.width || 'Not set'} m</div>
                  <div>Length: {profile?.length || 'Not set'} m</div>
                  <div>Weight: {profile?.weight || 'Not set'} kg</div>
                  <div>Axles: {profile?.axles || 'Not set'}</div>
                  <div>Load type: {profile?.load_type || 'Not set'}</div>
                </div>
                <button
                  onClick={() => setShowProfileModal(false)}
                  style={{ marginTop: '16px', width: '100%', minHeight: '44px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', background: '#e85d04', color: 'white', border: 'none', borderRadius: 0, cursor: 'pointer', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {showMtoContactModal && (
            <div
              onClick={() => setShowMtoContactModal(false)}
              style={{ position: 'absolute', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <div onClick={(e) => e.stopPropagation()} style={{ ...PANEL_STYLE, padding: '20px', width: '260px' }}>
                <h3 style={{ marginBottom: '12px', ...LABEL_STYLE, fontSize: '12px', color: 'var(--color-text-primary)' }}>MTO Contact Info</h3>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '13px', lineHeight: '1.8' }}>
                  <div><strong>Phone:</strong> <a href={`tel:${PROVINCE_PERMITS.Ontario.phone}`} style={{ ...MONO_STYLE, color: 'var(--color-text-primary)' }}>{PROVINCE_PERMITS.Ontario.phone}</a></div>
                  <div><strong>Permits:</strong> {PROVINCE_PERMITS.Ontario.permitRequired}</div>
                  <div><strong>Escort:</strong> {PROVINCE_PERMITS.Ontario.escort}</div>
                </div>
                <a
                  href={PROVINCE_PERMITS.Ontario.portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '44px', boxSizing: 'border-box', textAlign: 'center', marginTop: '12px', padding: '8px', background: '#e85d04', color: 'white', borderRadius: 0, textDecoration: 'none', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}
                >
                  Open Permit Portal
                </a>
                <button
                  onClick={() => setShowMtoContactModal(false)}
                  style={{ marginTop: '10px', width: '100%', minHeight: '44px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 0, cursor: 'pointer', fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {!navigating && (
      <div
        ref={routeCardRef}
        className={`mt-route-card${provincesOnRoute.length > 0 ? ' mt-has-permits' : ''}`}
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          zIndex: 2000,
          ...PANEL_STYLE,
          borderRadius: 'var(--radius-soft)',
          padding: '16px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
          width: '280px',
          // Flex column so the header and footer (route search fields /
          // Save+Start buttons) take their natural size while the route-
          // options list in between is the one flexible, scrollable region —
          // same "fixed chrome, scrollable content, nothing ever half-
          // rendered" shape as the autosuggest dropdown fix. The mobile
          // media query below reads --card-max-height (this component's own
          // VisualViewport-aware measurement) to bound the whole card to
          // what's actually visible, combined via CSS min() with a
          // safe-area-aware calc() fallback for browsers where the JS
          // measurement hasn't landed yet.
          display: 'flex',
          flexDirection: 'column',
          '--card-max-height': routeCardMaxHeight != null ? `${routeCardMaxHeight}px` : undefined
        }}
      >
        <div ref={routeCardHeaderRef} style={{ flex: '0 0 auto' }}>
        <div ref={routeDropdownRef} style={{ position: 'relative', marginBottom: '10px' }}>
          <button
            onClick={() => setShowRouteDropdown((open) => !open)}
            style={{
              width: '100%',
              minHeight: '44px',
              boxSizing: 'border-box',
              padding: '8px 10px',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-soft)',
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: 'var(--color-text-primary)'
            }}
          >
            <span>Select Previous Route</span>
            <span>{showRouteDropdown ? '▲' : '▼'}</span>
          </button>

          {showRouteDropdown && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 2100,
                background: 'var(--color-panel)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-soft)',
                boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                marginTop: '4px',
                maxHeight: '340px',
                overflowY: 'auto',
                padding: '8px'
              }}
            >
              <input
                type="text"
                placeholder="Search saved routes..."
                value={routeSearchQuery}
                onChange={(e) => setRouteSearchQuery(e.target.value)}
                style={{ width: '100%', minHeight: '44px', padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-soft)', boxSizing: 'border-box', marginBottom: '8px', fontSize: '12px', background: 'var(--color-panel)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
              />

              {!trimmedRouteSearch && (
                <div style={{ ...LABEL_STYLE, marginBottom: '4px' }}>
                  {routeDropdownExpanded ? 'All Saved Routes' : 'Most Used'}
                </div>
              )}

              {savedRoutes.length === 0 ? (
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '12px', color: 'var(--color-text-muted)', padding: '10px', textAlign: 'center' }}>No saved routes yet</div>
              ) : displayedSavedRoutes.length === 0 ? (
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '12px', color: 'var(--color-text-muted)', padding: '10px', textAlign: 'center' }}>No routes match "{routeSearchQuery}"</div>
              ) : (
                displayedSavedRoutes.map((route) => (
                  <button
                    key={route.id}
                    onClick={() => loadSavedRoute(route)}
                    style={{
                      display: 'block',
                      width: '100%',
                      minHeight: '44px',
                      boxSizing: 'border-box',
                      textAlign: 'left',
                      padding: '8px',
                      marginBottom: '4px',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-soft)',
                      background: 'var(--color-panel)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-display)'
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text-primary)' }}>{route.route_name}</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                      {route.start_location} → {route.end_location}
                    </div>
                    <div style={{ ...MONO_STYLE, fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{route.distance != null ? `${route.distance} km` : ''}</span>
                      <span>{route.last_used ? `Last used ${new Date(route.last_used).toLocaleDateString()}` : 'Never used'}</span>
                    </div>
                  </button>
                ))
              )}

              {!trimmedRouteSearch && !routeDropdownExpanded && savedRoutes.length > 3 && (
                <button
                  onClick={() => setRouteDropdownExpanded(true)}
                  style={{ width: '100%', minHeight: '44px', boxSizing: 'border-box', padding: '6px', background: 'transparent', border: 'none', color: '#e85d04', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}
                >
                  See more ({savedRoutes.length - 3} more)
                </button>
              )}
            </div>
          )}
        </div>

        <div ref={startWrapperRef} style={{ position: 'relative', marginBottom: '8px' }}>
          <input
            type="text"
            placeholder="Start location"
            value={startLocation}
            onChange={handleStartChange}
            style={{ width: '100%', minHeight: '44px', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-soft)', boxSizing: 'border-box', background: 'var(--color-panel)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)', fontSize: '14px' }}
          />
          <SuggestionDropdown
            wrapperRef={startWrapperRef}
            isOpen={startDropdownOpen}
            loading={startSuggestLoading}
            results={startSuggestions}
            expanded={startSuggestionsExpanded}
            onExpand={() => setStartSuggestionsExpanded(true)}
            onSelect={selectStartSuggestion}
            formatItem={formatSuggestion}
            onPointerEnter={() => { startInteractingRef.current = true; }}
            onPointerLeave={() => { startInteractingRef.current = false; }}
          />
        </div>
        <div ref={endWrapperRef} style={{ position: 'relative', marginBottom: '8px' }}>
          <input
            type="text"
            placeholder="End location"
            value={endLocation}
            onChange={handleEndChange}
            style={{ width: '100%', minHeight: '44px', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-soft)', boxSizing: 'border-box', background: 'var(--color-panel)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)', fontSize: '14px' }}
          />
          <SuggestionDropdown
            wrapperRef={endWrapperRef}
            isOpen={endDropdownOpen}
            loading={endSuggestLoading}
            results={endSuggestions}
            expanded={endSuggestionsExpanded}
            onExpand={() => setEndSuggestionsExpanded(true)}
            onSelect={selectEndSuggestion}
            formatItem={formatSuggestion}
            onPointerEnter={() => { endInteractingRef.current = true; }}
            onPointerLeave={() => { endInteractingRef.current = false; }}
          />
        </div>
        <button
          onClick={() => calculateRoute()}
          disabled={searching}
          style={{
            width: '100%',
            minHeight: '44px',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '10px',
            background: searching ? '#aaa' : '#e85d04',
            color: 'white',
            border: 'none',
            borderRadius: 0,
            cursor: searching ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-display)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 700
          }}
        >
          {searching ? 'Calculating…' : 'Find Truck Route'}
        </button>
        </div>
        {routeOptions.length > 0 && (
          <div
            style={{
              flex: '0 0 auto',
              height: routeOptionsListHeight != null ? `${routeOptionsListHeight}px` : `${routeOptions.length * ROUTE_OPTION_ROW_HEIGHT}px`,
              minHeight: 0,
              overflowY: 'auto',
              marginTop: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            {routeOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => selectRoute(opt.id)}
                style={{
                  textAlign: 'left',
                  height: `${ROUTE_OPTION_ROW_HEIGHT}px`,
                  flex: '0 0 auto',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 0,
                  border: '1px solid var(--color-border)',
                  borderLeft: opt.id === selectedRouteId ? '3px solid var(--color-route-normal)' : '1px solid var(--color-border)',
                  background: 'var(--color-panel)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-display)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.label}</span>
                  <span style={{ fontSize: '15px', flexShrink: 0 }}>{opt.hasTolls ? '🏷️' : '✅'}</span>
                </div>
                <div style={{ ...MONO_STYLE, fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {opt.km} km · {opt.durationText}
                </div>
              </button>
            ))}
          </div>
        )}
        <div
          ref={routeCardFooterRef}
          style={{
            flex: '0 0 auto',
            // Visually separates the pinned action area from the scrollable
            // options list above it, and clears the home-indicator/gesture
            // area on notched phones — this is the last content in the
            // card, so it's the one place that inset actually matters here.
            borderTop: routeOptions.length > 0 ? '1px solid var(--color-border)' : 'none',
            marginTop: routeOptions.length > 0 ? '10px' : 0,
            paddingTop: routeOptions.length > 0 ? '10px' : 0,
            paddingBottom: 'env(safe-area-inset-bottom, 0px)'
          }}
        >
        {routeOptions.length > 0 && (
          <button
            onClick={startNavigation}
            style={{
              width: '100%',
              minHeight: '52px',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '14px',
              background: 'var(--color-route-normal)',
              color: 'white',
              border: 'none',
              borderRadius: 0,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 700,
              fontSize: '15px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.25)'
            }}
          >
            Start Navigation
          </button>
        )}
        {routeOptions.length > 0 && (
          <button
            onClick={() => { setSaveRouteName(''); setSaveRouteError(''); setShowSaveRouteModal(true); }}
            style={{
              width: '100%',
              minHeight: '44px',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: '8px',
              padding: '8px',
              background: 'transparent',
              color: 'var(--color-text-muted)',
              border: 'none',
              borderRadius: 0,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
              fontSize: '12px'
            }}
          >
            Save This Route
          </button>
        )}
        {routeOptions.length > 0 && inspectionStationCount > 0 && (
          <div
            style={{
              marginTop: '8px',
              padding: '8px',
              background: '#fef3c7',
              border: '1px solid #f59e0b',
              borderRadius: 'var(--radius-soft)',
              color: '#92400e',
              fontFamily: 'var(--font-display)',
              fontSize: '13px',
              fontWeight: 700
            }}
          >
            ⚠️ {inspectionStationCount} MTO inspection station{inspectionStationCount === 1 ? '' : 's'} on this route — stay alert for flashing signs
          </div>
        )}
        {error && (
          <div style={{ marginTop: '8px', fontFamily: 'var(--font-display)', color: '#c0392b' }}>{error}</div>
        )}
        </div>
      </div>
      )}
      {showSaveRouteModal && (
        <div
          onClick={() => setShowSaveRouteModal(false)}
          style={{ position: 'absolute', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ ...PANEL_STYLE, padding: '20px', width: '280px' }}>
            <h3 style={{ marginBottom: '12px', ...LABEL_STYLE, fontSize: '12px', color: 'var(--color-text-primary)' }}>Save This Route</h3>
            <input
              type="text"
              placeholder="Route name"
              value={saveRouteName}
              onChange={(e) => setSaveRouteName(e.target.value)}
              autoFocus
              style={{ width: '100%', minHeight: '44px', padding: '8px', border: '1px solid var(--color-border)', borderRadius: 0, boxSizing: 'border-box', marginBottom: '10px', background: 'var(--color-panel)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
            />
            {saveRouteError && (
              <div style={{ color: '#c0392b', fontFamily: 'var(--font-display)', fontSize: '12px', marginBottom: '8px' }}>{saveRouteError}</div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowSaveRouteModal(false)}
                style={{ flex: 1, minHeight: '44px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 0, cursor: 'pointer', fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRoute}
                disabled={savingRoute}
                style={{
                  flex: 1,
                  minHeight: '44px',
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '8px',
                  background: savingRoute ? '#aaa' : 'var(--color-route-normal)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 0,
                  cursor: savingRoute ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-display)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontWeight: 700
                }}
              >
                {savingRoute ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
      {!navigating && provincesOnRoute.length > 0 && (
        <div
          className="mt-permit-panel"
          style={{
            position: 'absolute',
            // env(safe-area-inset-bottom) clears the home-indicator/gesture
            // area on notched phones; permitPanelMaxHeight (VisualViewport-
            // aware, see useAvailableViewportHeight) additionally shrinks
            // the panel — and each card below, individually — when Safari's
            // collapsible bottom bar is actually showing and eating into
            // the visible height, rather than assuming the full static
            // 230px is always available.
            bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
            left: '20px',
            right: '20px',
            // Below the route search card (2000) so the card's inputs and
            // "Find Truck Route" button stay tappable if the two ever touch.
            zIndex: 1900,
            display: 'flex',
            gap: '12px',
            maxHeight: `${permitPanelMaxHeight}px`,
            overflowX: 'auto',
            overflowY: 'auto',
            paddingBottom: '4px'
          }}
        >
          {provincesOnRoute.map((key) => {
            const permit = PROVINCE_PERMITS[key];
            return (
              <div
                key={key}
                style={{
                  flex: '0 0 240px',
                  background: permit.color,
                  color: 'white',
                  borderRadius: 0,
                  padding: '14px',
                  fontFamily: 'var(--font-display)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  boxSizing: 'border-box',
                  maxHeight: `${permitPanelMaxHeight}px`,
                  overflowY: 'auto'
                }}
              >
                <div style={{ ...LABEL_STYLE, color: 'rgba(255,255,255,0.75)', marginBottom: '4px' }}>Province</div>
                <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>
                  {permit.name}
                </div>
                <div style={{ fontSize: '12px', marginBottom: '6px' }}>
                  <strong>Permit:</strong> {permit.permitRequired} permit required
                </div>
                <div style={{ fontSize: '12px', marginBottom: '6px' }}>
                  <strong>Escort:</strong> {permit.escort}
                </div>
                <div style={{ fontSize: '12px', marginBottom: '6px' }}>
                  <strong>Seasonal:</strong> {permit.seasonal}
                </div>
                <div style={{ fontSize: '12px', marginBottom: '10px' }}>
                  <strong>Phone:</strong>{' '}
                  <a href={`tel:${permit.phone}`} style={{ ...MONO_STYLE, color: 'white' }}>{permit.phone}</a>
                </div>
                <a
                  href={permit.portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '44px',
                    boxSizing: 'border-box',
                    padding: '8px',
                    background: 'rgba(255,255,255,0.2)',
                    borderRadius: 0,
                    color: 'white',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontSize: '12px',
                    textDecoration: 'none'
                  }}
                >
                  Learn more
                </a>
              </div>
            );
          })}
        </div>
      )}
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      {gridOverlay === 'on' && <div className="mt-grid-overlay" />}
    </div>
  );
};

export default MapView;
