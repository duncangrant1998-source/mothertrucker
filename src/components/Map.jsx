import { useEffect, useRef, useState } from 'react';

const Map = ({ profile }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const platformRef = useRef(null);
  const [startLocation, setStartLocation] = useState('');
  const [endLocation, setEndLocation] = useState('');
  const [searching, setSearching] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [error, setError] = useState('');

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
      H.ui.UI.createDefault(map, defaultLayers);
      mapInstance.current = map;
      platformRef.current = platform;
    }
  }, []);

  const geocode = (query) => new Promise((resolve, reject) => {
    platformRef.current.getSearchService().geocode({ q: query, in: 'countryCode:CAN' }, (result) => {
      result.items?.length > 0
        ? resolve({ lat: result.items[0].position.lat, lng: result.items[0].position.lng })
        : reject(new Error(`Location not found: ${query}`));
    }, reject);
  });

  const calculateRoute = async () => {
    if (!startLocation || !endLocation) {
      setError('Enter start and end locations');
      return;
    }
    setSearching(true);
    setError('');
    setRouteInfo(null);
    try {
      const [start, end] = await Promise.all([geocode(startLocation), geocode(endLocation)]);
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
          mapInstance.current.removeObjects(mapInstance.current.getObjects());
          const section = result.routes[0].sections[0];
          const polyline = new H.map.Polyline(
            H.geo.LineString.fromFlexiblePolyline(section.polyline),
            { style: { strokeColor: '#e85d04', lineWidth: 5 } }
          );
          const startMarker = new H.map.Marker({ lat: start.lat, lng: start.lng });
          const endMarker = new H.map.Marker({ lat: end.lat, lng: end.lng });
          mapInstance.current.addObjects([polyline, startMarker, endMarker]);
          mapInstance.current.getViewModel().setLookAtData({ bounds: polyline.getBoundingBox() });

          const km = (section.summary.length / 1000).toFixed(0);
          const hours = Math.floor(section.summary.duration / 3600);
          const minutes = Math.floor((section.summary.duration % 3600) / 60);
          setRouteInfo(`${km} km · ${hours}h ${minutes}m`);
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
          zIndex: 1000,
          background: 'white',
          padding: '16px',
          borderRadius: '10px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
          width: '280px'
        }}
      >
        <input
          type="text"
          placeholder="Start location"
          value={startLocation}
          onChange={(e) => setStartLocation(e.target.value)}
          style={{ width: '100%', padding: '8px', marginBottom: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
        />
        <input
          type="text"
          placeholder="End location"
          value={endLocation}
          onChange={(e) => setEndLocation(e.target.value)}
          style={{ width: '100%', padding: '8px', marginBottom: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
        />
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
        {error && (
          <div style={{ marginTop: '8px', color: '#c0392b' }}>{error}</div>
        )}
      </div>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default Map;
