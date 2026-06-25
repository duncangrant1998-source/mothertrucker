import { useEffect, useRef, useState } from 'react';

const Map = ({ profile }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const routerRef = useRef(null);
  const [startLocation, setStartLocation] = useState('');
  const [endLocation, setEndLocation] = useState('');
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!mapInstance.current && mapRef.current) {
      const platform = new H.service.Platform({
        apikey: import.meta.env.VITE_HERE_API_KEY
      });

      const defaultLayers = platform.createDefaultLayers();

      const map = new H.Map(
        mapRef.current,
        defaultLayers.vector.normal.truck,
        {
          zoom: 5,
          center: { lat: 56.1304, lng: -106.3468 }
        }
      );

      new H.mapevents.Behavior(new H.mapevents.MapEvents(map));
      H.ui.UI.createDefault(map, defaultLayers);

      mapInstance.current = map;
      routerRef.current = platform.getRoutingService();

      window.addEventListener('resize', () => map.getViewPort().resize());
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.dispose();
        mapInstance.current = null;
      }
    };
  }, []);

  const geocodeAddress = async (address) => {
    const platform = new H.service.Platform({
      apikey: import.meta.env.VITE_HERE_API_KEY
    });
    const geocoder = platform.getGeocoder();

    return new Promise((resolve, reject) => {
      geocoder.geocode({ query: address }, (result) => {
        if (result.items && result.items.length > 0) {
          const item = result.items[0];
          resolve({
            lat: item.position.lat,
            lng: item.position.lng
          });
        } else {
          reject(new Error('Location not found'));
        }
      }, reject);
    });
  };

  const calculateRoute = async () => {
    if (!startLocation || !endLocation) {
      alert('Please enter both start and end locations');
      return;
    }

    setSearching(true);

    try {
      const start = await geocodeAddress(startLocation);
      const end = await geocodeAddress(endLocation);

      if (!routerRef.current) {
        alert('Router not ready');
        setSearching(false);
        return;
      }

      const routeParams = {
        origin: `${start.lat},${start.lng}`,
        destination: `${end.lat},${end.lng}`,
        return: 'polyline,summary',
        truck: true,
        truckType: 'truck',
        limitedWeight: profile?.weight || 25000,
        height: profile?.height || 4,
        width: profile?.width || 2.5,
        length: profile?.length || 15
      };

      routerRef.current.calculateRoute(routeParams, (result) => {
        if (result.routes && result.routes.length > 0) {
          mapInstance.current.removeObjects(mapInstance.current.getObjects());

          const route = result.routes[0];
          const lineString = H.util.polylineToPoints(route.shape);
          const polyline = new H.geo.LineString(lineString);
          const line = new H.map.Polyline(polyline, {
            style: { strokeColor: '#e85d04', lineWidth: 3 }
          });
          mapInstance.current.addObject(line);

          const bbox = route.boundingBox;
          mapInstance.current.getViewModel().setLookAtData({
            bounds: bbox
          });
        } else {
          alert('No route found');
        }
        setSearching(false);
      }, (error) => {
        console.error('Routing error:', error);
        alert('Error calculating route: ' + error.message);
        setSearching(false);
      });
    } catch (err) {
      alert('Error: ' + err.message);
      setSearching(false);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        background: 'white',
        padding: '16px',
        borderRadius: '10px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
        width: '280px',
        zIndex: 500
      }}>
        <h3 style={