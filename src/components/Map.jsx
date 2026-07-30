import { useEffect, useRef, useState } from 'react';
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
// prefers-color-scheme query the CSS tokens respond to.
const ROUTE_NORMAL_COLOR = { day: '#2E9E52', night: '#5FCB7A' };
const isNightMode = () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
const selectedRouteStyle = () => ({ strokeColor: ROUTE_NORMAL_COLOR[isNightMode() ? 'night' : 'day'], lineWidth: 5 });
const UNSELECTED_ROUTE_STYLE = { strokeColor: 'rgba(148,163,184,0.6)', lineWidth: 4 };

const NAV_ZOOM = 16;
const OFF_ROUTE_METERS = 100;
const FORWARD_BIAS_RATIO = 0.68;

// Distance thresholds for the two-stage proximity alert system (stations,
// highway exits, and turn maneuvers all share the same pipeline).
const ALERT_TOAST_METERS = 2000;
const ALERT_BANNER_METERS = 500;
const ALERT_PASSED_METERS = 100;
const ALERT_TOAST_DURATION_MS = 15000;

const ALERT_STYLES = {
  station: { background: '#dc2626', color: 'white', defaultName: 'MTO Inspection Station' },
  exit: { background: '#f59e0b', color: '#111827', defaultName: 'Highway Exit' },
  turn: { background: '#2563eb', color: 'white', defaultName: 'Turn' }
};

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

const SPEED_UNIT_OPTIONS = [
  { value: 'auto', label: 'Auto-detect (default)' },
  { value: 'kmh', label: 'Kilometers per hour' },
  { value: 'mph', label: 'Miles per hour' }
];

const MENU_ITEM_STYLE = {
  display: 'block',
  width: '100%',
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
const speedLimitAtIndex = (spans, index) => {
  for (let s = spans.length - 1; s >= 0; s--) {
    if (spans[s].offset <= index) return spans[s].speedLimit?.maxSpeed ?? null;
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

// Only 'exit' (highway off-ramp) and turn/uTurn maneuvers are alert-worthy;
// depart/arrive/continue/ramp/roundabout actions are excluded to avoid noise.
const ACTION_ALERT_KIND = { exit: 'exit', turn: 'turn', uTurn: 'turn' };

const buildNavActions = (section, cumulative) => (section.actions || []).map((action) => ({
  text: describeAction(action),
  distanceMeters: cumulative[action.offset] ?? cumulative[cumulative.length - 1],
  alertKind: ACTION_ALERT_KIND[action.action] || null
}));

const createDriverIcon = (headingDeg) => new H.map.Icon(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    `<g transform="rotate(${headingDeg} 16 16)">` +
      '<path d="M16 3 L26 27 L16 21 L6 27 Z" fill="#2563eb" stroke="white" stroke-width="2" stroke-linejoin="round"/>' +
    '</g>' +
  '</svg>',
  { size: { w: 32, h: 32 }, anchor: { x: 16, y: 16 } }
);

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

const MapView = ({ profile, mapLayer, gridOverlay, onNavigatingChange }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const platformRef = useRef(null);
  const defaultLayersRef = useRef(null);
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
  const recalculatingRef = useRef(false);
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
  const optionsMenuRef = useRef(null);
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
  const [startLocation, setStartLocation] = useState('');
  const [endLocation, setEndLocation] = useState('');
  const [startSuggestions, setStartSuggestions] = useState([]);
  const [endSuggestions, setEndSuggestions] = useState([]);
  const [startSuggestLoading, setStartSuggestLoading] = useState(false);
  const [endSuggestLoading, setEndSuggestLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [routeOptions, setRouteOptions] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [error, setError] = useState('');
  const [inspectionStationCount, setInspectionStationCount] = useState(0);
  const [navigating, setNavigating] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
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
  const [currentSpeedLimitMps, setCurrentSpeedLimitMps] = useState(null);
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
        mapLayer === 'satellite' ? defaultLayers.raster.satellite.map : defaultLayers.vector.normal.logistics,
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

  // Swaps only the base tile layer — route polylines, markers, and the grid
  // overlay are separate map objects/DOM layers untouched by setBaseLayer.
  useEffect(() => {
    if (!mapInstance.current || !defaultLayersRef.current) return;
    const layer = mapLayer === 'satellite'
      ? defaultLayersRef.current.raster.satellite.map
      : defaultLayersRef.current.vector.normal.logistics;
    if (mapInstance.current.getBaseLayer() !== layer) {
      mapInstance.current.setBaseLayer(layer);
    }
  }, [mapLayer]);

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
  const resolveLocation = (query) => new Promise((resolve, reject) => {
    platformRef.current.getSearchService().autosuggest({
      q: query,
      in: 'countryCode:CAN',
      at: '56.1304,-106.3468',
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
      at: '56.1304,-106.3468',
      limit: 5
    }, (result) => {
      if (requestIdRef.current !== myRequestId) return;
      const matches = (result.items || []).filter((item) => item.position && item.title).slice(0, 3);
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
    clearTimeout(startSuggestTimeout.current);
    startSuggestTimeout.current = setTimeout(() => {
      fetchSuggestions(value, setStartSuggestions, setStartSuggestLoading, startRequestId);
    }, 300);
  };

  const handleEndChange = (e) => {
    const value = e.target.value;
    setEndLocation(value);
    if (endResolvedRef.current?.text !== value) endResolvedRef.current = null;
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
  };

  const selectEndSuggestion = (item) => {
    const text = formatSuggestion(item);
    setEndLocation(text);
    endResolvedRef.current = { text, position: { lat: item.position.lat, lng: item.position.lng } };
    setEndSuggestions([]);
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
    router.calculateRoute(params, (result) => {
      if (result.routes?.length) resolve(result.routes[0]);
      else reject(new Error('No route found'));
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
        spans: 'speedLimit,length,duration',
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

  // Shifts the map center so the driver renders below screen-center (more of
  // the road ahead is visible) rather than dead-center, independent of heading.
  const followDriver = (lat, lng) => {
    const height = mapRef.current.clientHeight;
    const desiredY = height * FORWARD_BIAS_RATIO;
    const driverScreen = mapInstance.current.geoToScreen({ lat, lng });
    const targetScreen = { x: driverScreen.x, y: height / 2 + driverScreen.y - desiredY };
    const targetGeo = mapInstance.current.screenToGeo(targetScreen.x, targetScreen.y);
    mapInstance.current.setCenter({ lat: targetGeo.lat, lng: targetGeo.lng });
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
      const route = await calculateSingleRoute(router, {
        origin: `${lat},${lng}`,
        destination: `${destination.lat},${destination.lng}`,
        transportMode: 'truck',
        routingMode: 'fast',
        return: 'polyline,summary,tolls,actions,instructions',
        spans: 'speedLimit,length,duration',
        currency: 'CAD',
        'tolls[summaries]': 'total',
        'vehicle[grossWeight]': (profile?.weight || 25000) * 1000,
        'vehicle[height]': (profile?.height || 4) * 100,
        'vehicle[width]': (profile?.width || 2.5) * 100,
        'vehicle[length]': (profile?.length || 15) * 100,
        'vehicle[axleCount]': profile?.axles || 5
      });
      applyNavRoute(route.sections[0]);
    } catch (err) {
      console.error('Recalculation failed:', err);
    } finally {
      setRecalculating(false);
    }
  };

  const handlePositionError = (err) => {
    console.error('Geolocation error:', err);
    setError(`Location error: ${err.message}`);
  };

  const handlePositionUpdate = (position) => {
    const { latitude, longitude, heading } = position.coords;
    const currentPos = { lat: latitude, lng: longitude };
    const prev = lastPositionRef.current;
    const effectiveHeading = (typeof heading === 'number' && !Number.isNaN(heading))
      ? heading
      : (prev ? bearingDegrees(prev, currentPos) : 0);
    lastPositionRef.current = currentPos;

    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new H.map.Marker(currentPos, { icon: createDriverIcon(effectiveHeading) });
      mapInstance.current.addObject(driverMarkerRef.current);
      mapInstance.current.setZoom(NAV_ZOOM);
    } else {
      driverMarkerRef.current.setGeometry(currentPos);
      driverMarkerRef.current.setIcon(createDriverIcon(effectiveHeading));
    }

    followDriver(latitude, longitude);

    const points = navRoutePointsRef.current;
    const cumulative = navCumulativeRef.current;
    if (!points || !points.length) return;

    const { index, distance } = nearestPointIndex(points, latitude, longitude, lastIndexRef.current, 80);
    lastIndexRef.current = index;

    if (distance > OFF_ROUTE_METERS) {
      if (!recalculatingRef.current) {
        recalculatingRef.current = true;
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

    const speedMps = typeof position.coords.speed === 'number' && !Number.isNaN(position.coords.speed)
      ? Math.max(0, position.coords.speed)
      : null;
    setCurrentSpeedMps(speedMps);
    setCurrentSpeedLimitMps(speedLimitAtIndex(navSpansRef.current, index));

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

    updateProximityAlerts(currentPos, points, index, travelled);
  };

  // Builds the combined list of upcoming alert-worthy points (MTO stations,
  // highway exits, turn maneuvers), then drives the two-stage toast/banner
  // alert pipeline: a 2km toast that fires once per point, and a persistent
  // 500m banner with a live countdown that clears 100m past the point.
  const updateProximityAlerts = (currentPos, points, index, travelled) => {
    const candidates = [];

    (currentInspectionStationsRef.current || []).forEach((station) => {
      if (station.latitude == null || station.longitude == null) return;
      const { index: stationIndex } = nearestPointIndex(points, station.latitude, station.longitude, 0, points.length - 1);
      if (stationIndex < index - 3) return;
      candidates.push({
        id: `station-${station.id ?? `${station.latitude},${station.longitude}`}`,
        kind: 'station',
        name: station.name || ALERT_STYLES.station.defaultName,
        distanceMeters: haversineMeters(currentPos, { lat: station.latitude, lng: station.longitude })
      });
    });

    navActionsRef.current.forEach((action, i) => {
      if (!action.alertKind) return;
      const distanceMeters = action.distanceMeters - travelled;
      if (distanceMeters < -ALERT_TOAST_METERS) return;
      candidates.push({
        id: `action-${i}`,
        kind: action.alertKind,
        name: action.text,
        distanceMeters
      });
    });

    const bannerCandidate = candidates
      .filter((p) => p.distanceMeters <= ALERT_BANNER_METERS && p.distanceMeters > -ALERT_PASSED_METERS)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)[0] || null;

    setBannerAlert(bannerCandidate ? {
      id: bannerCandidate.id,
      kind: bannerCandidate.kind,
      name: bannerCandidate.name,
      distanceMeters: bannerCandidate.distanceMeters
    } : null);

    const toastCandidate = candidates
      .filter((p) => p.distanceMeters <= ALERT_TOAST_METERS && p.distanceMeters > ALERT_BANNER_METERS)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)[0] || null;

    if (toastCandidate) {
      const state = alertStateRef.current.get(toastCandidate.id);
      if (!state?.toastShown) {
        alertStateRef.current.set(toastCandidate.id, { toastShown: true });
        clearTimeout(toastTimeoutRef.current);
        setToastAlert({ id: toastCandidate.id, kind: toastCandidate.kind, name: toastCandidate.name });
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
    setCurrentInstruction(null);
    setNextInstruction(null);
    setToastAlert(null);
    setBannerAlert(null);
    setCurrentSpeedMps(null);
    setCurrentSpeedLimitMps(null);
    setTripStats(null);
    setOptionsMenuOpen(false);
    setSpeedUnitMenuOpen(false);
    lastPositionRef.current = null;
    lastIndexRef.current = 0;
    recalculatingRef.current = false;

    mapInstance.current.removeObjects(routeOptions.map((opt) => opt.polyline));
    applyNavRoute(selected.section);
    setNavigating(true);
    onNavigatingChange?.(true);

    watchIdRef.current = navigator.geolocation.watchPosition(handlePositionUpdate, handlePositionError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000
    });
  };

  const stopNavigation = () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
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

    setNavigating(false);
    onNavigatingChange?.(false);
    setRecalculating(false);
    setCurrentInstruction(null);
    setNextInstruction(null);
    setToastAlert(null);
    setBannerAlert(null);
    setCurrentSpeedMps(null);
    setCurrentSpeedLimitMps(null);
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
  const trimmedRouteSearch = routeSearchQuery.trim().toLowerCase();
  const displayedSavedRoutes = trimmedRouteSearch
    ? savedRoutes.filter((r) => r.route_name.toLowerCase().includes(trimmedRouteSearch))
    : routeDropdownExpanded
      ? savedRoutes
      : [...savedRoutes].sort((a, b) => (b.load_count || 0) - (a.load_count || 0)).slice(0, 3);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {navigating && (
        <>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 2500,
              ...PANEL_STYLE,
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              borderBottom: '1px solid var(--color-border)',
              padding: '14px 20px 16px'
            }}
          >
            {currentInstruction ? (
              <>
                <div style={{ ...LABEL_STYLE, display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                  <span style={{ color: 'var(--color-route-normal)' }}>NEXT</span>
                  <span>·</span>
                  <span style={{ ...MONO_STYLE, fontSize: '12px', fontWeight: 700, textTransform: 'none', letterSpacing: 'normal', color: 'var(--color-text-primary)' }}>
                    {formatDistance(currentInstruction.distanceMeters)}
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '21px', fontWeight: 600, letterSpacing: '-0.01em', marginTop: '4px' }}>
                  {currentInstruction.text}
                </div>
                {nextInstruction && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '8px' }}>
                    <span style={LABEL_STYLE}>THEN</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--color-text-muted)' }}>{nextInstruction.text}</span>
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '16px' }}>Follow the highlighted route</div>
            )}
          </div>

          {recalculating && (
            <div
              style={{
                position: 'absolute',
                top: '124px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 2500,
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
              Recalculating…
            </div>
          )}

          {bannerAlert ? (
            <div
              style={{
                position: 'absolute',
                top: '124px',
                left: '16px',
                zIndex: 2600,
                maxWidth: '280px',
                background: ALERT_STYLES[bannerAlert.kind].background,
                color: ALERT_STYLES[bannerAlert.kind].color,
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
                position: 'absolute',
                top: '124px',
                left: '16px',
                zIndex: 2600,
                maxWidth: '280px',
                background: 'var(--color-panel)',
                color: 'var(--color-text-primary)',
                padding: '12px 36px 12px 14px',
                borderRadius: 'var(--radius-soft)',
                border: '1px solid var(--color-border)',
                borderLeft: `4px solid ${ALERT_STYLES[toastAlert.kind].background}`,
                boxShadow: '0 4px 14px rgba(0,0,0,0.3)'
              }}
            >
              <button
                onClick={dismissToastAlert}
                aria-label="Dismiss alert"
                style={{
                  position: 'absolute',
                  top: '6px',
                  right: '8px',
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

          <button
            onClick={stopNavigation}
            style={{
              position: 'absolute',
              bottom: '96px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 2500,
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

          <div ref={optionsMenuRef} style={{ position: 'absolute', top: '16px', right: '16px', zIndex: 2700 }}>
            <button
              onClick={() => setOptionsMenuOpen((open) => !open)}
              aria-label="Options menu"
              style={{
                width: '32px',
                height: '32px',
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
                  top: '40px',
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
              position: 'absolute',
              top: '56px',
              right: '16px',
              zIndex: 2600,
              ...PANEL_STYLE,
              borderLeft: '3px solid var(--color-route-normal)',
              padding: '10px 16px',
              textAlign: 'center',
              minWidth: '110px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.25)'
            }}
          >
            <div style={{ ...MONO_STYLE, fontSize: '26px', fontWeight: 700, lineHeight: 1.1 }}>
              {formatSpeedValue(currentSpeedMps, effectiveSpeedUnit)}
            </div>
            <div style={{ ...LABEL_STYLE, marginBottom: '6px' }}>
              {unitLabel(effectiveSpeedUnit)}
            </div>
            <div style={LABEL_STYLE}>
              LIMIT{' '}
              <span style={{ ...MONO_STYLE, textTransform: 'none', color: 'var(--color-text-primary)', fontWeight: 600 }}>
                {formatSpeedValue(currentSpeedLimitMps, effectiveSpeedUnit)} {unitLabel(effectiveSpeedUnit)}
              </span>
            </div>
          </div>

          {tripStats && (
            <div
              style={{
                position: 'absolute',
                left: '16px',
                right: '16px',
                bottom: '16px',
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
                  style={{ marginTop: '16px', width: '100%', padding: '8px', background: '#e85d04', color: 'white', border: 'none', borderRadius: 0, cursor: 'pointer', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}
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
                  style={{ display: 'block', textAlign: 'center', marginTop: '12px', padding: '8px', background: '#e85d04', color: 'white', borderRadius: 0, textDecoration: 'none', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}
                >
                  Open Permit Portal
                </a>
                <button
                  onClick={() => setShowMtoContactModal(false)}
                  style={{ marginTop: '10px', width: '100%', padding: '8px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 0, cursor: 'pointer', fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
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
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          zIndex: 2000,
          ...PANEL_STYLE,
          borderRadius: 'var(--radius-soft)',
          padding: '16px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
          width: '280px'
        }}
      >
        <div ref={routeDropdownRef} style={{ position: 'relative', marginBottom: '10px' }}>
          <button
            onClick={() => setShowRouteDropdown((open) => !open)}
            style={{
              width: '100%',
              padding: '8px 10px',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 0,
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
                borderRadius: 0,
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
                style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 0, boxSizing: 'border-box', marginBottom: '8px', fontSize: '12px', background: 'var(--color-panel)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
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
                      textAlign: 'left',
                      padding: '8px',
                      marginBottom: '4px',
                      border: '1px solid var(--color-border)',
                      borderRadius: 0,
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
                  style={{ width: '100%', padding: '6px', background: 'transparent', border: 'none', color: '#e85d04', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}
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
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 0, boxSizing: 'border-box', background: 'var(--color-panel)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)', fontSize: '14px' }}
          />
          {(startSuggestLoading || startSuggestions.length > 0) && (
            <div
              onMouseEnter={() => { startInteractingRef.current = true; }}
              onMouseLeave={() => { startInteractingRef.current = false; }}
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 9999,
                background: 'var(--color-panel)',
                border: '1px solid var(--color-border)',
                borderRadius: 0,
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                marginTop: '2px'
              }}
            >
              {startSuggestLoading ? (
                <div style={{ padding: '8px', fontFamily: 'var(--font-display)', fontSize: '12px', color: 'var(--color-text-muted)' }}>Searching…</div>
              ) : (
                startSuggestions.map((item) => (
                  <div
                    key={item.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectStartSuggestion(item);
                    }}
                    style={{ padding: '8px', fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid var(--color-border)' }}
                  >
                    {formatSuggestion(item)}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <div ref={endWrapperRef} style={{ position: 'relative', marginBottom: '8px' }}>
          <input
            type="text"
            placeholder="End location"
            value={endLocation}
            onChange={handleEndChange}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 0, boxSizing: 'border-box', background: 'var(--color-panel)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)', fontSize: '14px' }}
          />
          {(endSuggestLoading || endSuggestions.length > 0) && (
            <div
              onMouseEnter={() => { endInteractingRef.current = true; }}
              onMouseLeave={() => { endInteractingRef.current = false; }}
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 9999,
                background: 'var(--color-panel)',
                border: '1px solid var(--color-border)',
                borderRadius: 0,
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                marginTop: '2px'
              }}
            >
              {endSuggestLoading ? (
                <div style={{ padding: '8px', fontFamily: 'var(--font-display)', fontSize: '12px', color: 'var(--color-text-muted)' }}>Searching…</div>
              ) : (
                endSuggestions.map((item) => (
                  <div
                    key={item.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectEndSuggestion(item);
                    }}
                    style={{ padding: '8px', fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid var(--color-border)' }}
                  >
                    {formatSuggestion(item)}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => calculateRoute()}
          disabled={searching}
          style={{
            width: '100%',
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
        {routeOptions.length > 0 && (
          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {routeOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => selectRoute(opt.id)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 0,
                  border: '1px solid var(--color-border)',
                  borderLeft: opt.id === selectedRouteId ? '3px solid var(--color-route-normal)' : '1px solid var(--color-border)',
                  background: 'var(--color-panel)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-display)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-text-primary)' }}>{opt.label}</span>
                  <span style={{ fontSize: '15px' }}>{opt.hasTolls ? '🏷️' : '✅'}</span>
                </div>
                <div style={{ ...MONO_STYLE, fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  {opt.km} km · {opt.durationText}
                </div>
              </button>
            ))}
          </div>
        )}
        {routeOptions.length > 0 && (
          <button
            onClick={() => { setSaveRouteName(''); setSaveRouteError(''); setShowSaveRouteModal(true); }}
            style={{
              width: '100%',
              marginTop: '10px',
              padding: '10px',
              background: 'var(--color-panel)',
              color: '#e85d04',
              border: '1px solid #e85d04',
              borderRadius: 0,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 700
            }}
          >
            Save This Route
          </button>
        )}
        {routeOptions.length > 0 && (
          <button
            onClick={startNavigation}
            style={{
              width: '100%',
              marginTop: '10px',
              padding: '10px',
              background: 'var(--color-route-normal)',
              color: 'white',
              border: 'none',
              borderRadius: 0,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 700
            }}
          >
            Start Navigation
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
              style={{ width: '100%', padding: '8px', border: '1px solid var(--color-border)', borderRadius: 0, boxSizing: 'border-box', marginBottom: '10px', background: 'var(--color-panel)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
            />
            {saveRouteError && (
              <div style={{ color: '#c0392b', fontFamily: 'var(--font-display)', fontSize: '12px', marginBottom: '8px' }}>{saveRouteError}</div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowSaveRouteModal(false)}
                style={{ flex: 1, padding: '8px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 0, cursor: 'pointer', fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRoute}
                disabled={savingRoute}
                style={{
                  flex: 1,
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
          style={{
            position: 'absolute',
            bottom: '20px',
            left: '20px',
            right: '20px',
            zIndex: 2000,
            display: 'flex',
            gap: '12px',
            overflowX: 'auto',
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
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
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
                    display: 'block',
                    textAlign: 'center',
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
