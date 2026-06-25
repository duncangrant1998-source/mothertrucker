import { useEffect, useRef } from 'react';

const Map = () => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);

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

      window.addEventListener('resize', () => map.getViewPort().resize());
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.dispose();
        mapInstance.current = null;
      }
    };
  }, []);

  return <div ref={mapRef} style={{ width: '100vw', height: '100vh' }} />;
};

export default Map;
