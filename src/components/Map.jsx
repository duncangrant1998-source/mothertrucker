import { useEffect, useRef, useState } from 'react';
import { getStationsNearRoute } from '../lib/inspectionStations';

const WEIGH_STATION_TERMS = ['weigh station', 'inspection station'];

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

const Map = ({ profile }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const platformRef = useRef(null);
  const uiRef = useRef(null);
  const bubbleRef = useRef(null);
  const weighIconRef = useRef(null);
  const weighMarkersRef = useRef([]);
  const inspectionIconRef = useRef(null);
  const inspectionMarkersRef = useRef([]);
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
  const [routeInfo, setRouteInfo] = useState(null);
  const [error, setError] = useState('');
  const [inspectionStationCount, setInspectionStationCount] = useState(0);

  useEffect(() => {
    if (!mapInstance.current && mapRef.current) {
      const platform = new H.service.Platform({
        apikey: import.meta.env.VITE_HERE_API_KEY
      });
      const defaultLayers = platform.createDefaultLayers();
      const map = new H.Map(mapRef.current, defaultLayers.vector.normal.truck, {
        zoom: 5,
        center: { lat: 56.1304, lng: -106.3468 }
      });
      new H.mapevents.Behavior(new H.mapevents.MapEvents(map));
      const ui = H.ui.UI.createDefault(map, defaultLayers);

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
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const calculateRoute = async () => {
    setStartSuggestions([]);
    setEndSuggestions([]);
    if (!startLocation || !endLocation) {
      setError('Enter start and end locations');
      return;
    }
    setSearching(true);
    setError('');
    setRouteInfo(null);
    try {
      const resolve = (location, resolvedRef) =>
        resolvedRef.current?.text === location ? Promise.resolve(resolvedRef.current.position) : resolveLocation(location);
      const [start, end] = await Promise.all([
        resolve(startLocation, startResolvedRef),
        resolve(endLocation, endResolvedRef)
      ]);
      const router = platformRef.current.getRoutingService(null, 8);
      router.calculateRoute({
        origin: `${start.lat},${start.lng}`,
        destination: `${end.lat},${end.lng}`,
        transportMode: 'truck',
        return: 'polyline,summary',
        'vehicle[grossWeight]': (profile?.weight || 25000) * 1000,
        'vehicle[height]': (profile?.height || 4) * 100,
        'vehicle[width]': (profile?.width || 2.5) * 100,
        'vehicle[length]': (profile?.length || 15) * 100,
        'vehicle[axleCount]': profile?.axles || 5
      }, (result) => {
        if (result.routes?.length) {
          if (bubbleRef.current) {
            uiRef.current.removeBubble(bubbleRef.current);
            bubbleRef.current = null;
          }
          mapInstance.current.removeObjects(mapInstance.current.getObjects());
          weighMarkersRef.current = [];
          inspectionMarkersRef.current = [];
          setInspectionStationCount(0);

          const section = result.routes[0].sections[0];
          const polyline = new H.map.Polyline(
            H.geo.LineString.fromFlexiblePolyline(section.polyline),
            { style: { strokeColor: '#e85d04', lineWidth: 5 } }
          );
          const startMarker = new H.map.Marker({ lat: start.lat, lng: start.lng });
          const endMarker = new H.map.Marker({ lat: end.lat, lng: end.lng });
          mapInstance.current.addObjects([polyline, startMarker, endMarker]);

          const bounds = polyline.getBoundingBox();
          mapInstance.current.getViewModel().setLookAtData({ bounds });

          const km = (section.summary.length / 1000).toFixed(0);
          const hours = Math.floor(section.summary.duration / 3600);
          const minutes = Math.floor((section.summary.duration % 3600) / 60);
          setRouteInfo(`${km} km · ${hours}h ${minutes}m`);

          findWeighStations(bounds);
          getStationsNearRoute(start.lat, start.lng, end.lat, end.lng).then((stations) => {
            console.log('Inspection stations from Supabase:', stations);
            renderInspectionStations(stations);
          });
        } else {
          setError('No route found');
        }
        setSearching(false);
      }, () => {
        setError('Routing failed. The truck profile may be incompatible with available roads.');
        setSearching(false);
      });
    } catch (err) {
      setError(err.message);
      setSearching(false);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          zIndex: 2000,
          background: 'white',
          padding: '16px',
          borderRadius: '10px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
          width: '280px'
        }}
      >
        <div ref={startWrapperRef} style={{ position: 'relative', marginBottom: '8px' }}>
          <input
            type="text"
            placeholder="Start location"
            value={startLocation}
            onChange={handleStartChange}
            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
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
                background: 'white',
                border: '1px solid #ccc',
                borderRadius: '4px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                marginTop: '2px'
              }}
            >
              {startSuggestLoading ? (
                <div style={{ padding: '8px', fontSize: '12px', color: '#888' }}>Searching…</div>
              ) : (
                startSuggestions.map((item) => (
                  <div
                    key={item.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectStartSuggestion(item);
                    }}
                    style={{ padding: '8px', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid #eee' }}
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
            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }}
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
                background: 'white',
                border: '1px solid #ccc',
                borderRadius: '4px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                marginTop: '2px'
              }}
            >
              {endSuggestLoading ? (
                <div style={{ padding: '8px', fontSize: '12px', color: '#888' }}>Searching…</div>
              ) : (
                endSuggestions.map((item) => (
                  <div
                    key={item.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectEndSuggestion(item);
                    }}
                    style={{ padding: '8px', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid #eee' }}
                  >
                    {formatSuggestion(item)}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <button
          onClick={calculateRoute}
          disabled={searching}
          style={{
            width: '100%',
            padding: '10px',
            background: searching ? '#aaa' : '#e85d04',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: searching ? 'not-allowed' : 'pointer',
            fontWeight: 'bold'
          }}
        >
          {searching ? 'Calculating...' : 'Find Truck Route'}
        </button>
        {routeInfo && (
          <div style={{ marginTop: '8px', color: '#2c662d', fontWeight: 'bold' }}>{routeInfo}</div>
        )}
        {routeInfo && inspectionStationCount > 0 && (
          <div
            style={{
              marginTop: '8px',
              padding: '8px',
              background: '#fef3c7',
              border: '1px solid #f59e0b',
              borderRadius: '4px',
              color: '#92400e',
              fontSize: '13px',
              fontWeight: 'bold'
            }}
          >
            ⚠️ {inspectionStationCount} MTO inspection station{inspectionStationCount === 1 ? '' : 's'} on this route — stay alert for flashing signs
          </div>
        )}
        {error && (
          <div style={{ marginTop: '8px', color: '#c0392b' }}>{error}</div>
        )}
      </div>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default Map;
