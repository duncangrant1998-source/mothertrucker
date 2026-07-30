import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Map from './components/Map';
import VehicleProfile from './components/VehicleProfile';
import MenuDrawer from './components/MenuDrawer';
import MapLayerToggle from './components/MapLayerToggle';
import GridOverlayToggle from './components/GridOverlayToggle';
import Auth from './Auth';
import ResetPassword from './ResetPassword';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [navigating, setNavigating] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [mapLayer, setMapLayer] = useState(() => (
    localStorage.getItem('mapLayer') === 'satellite' ? 'satellite' : 'map'
  ));
  const [gridOverlay, setGridOverlay] = useState(() => (
    localStorage.getItem('gridOverlay') === 'on' ? 'on' : 'off'
  ));

  const handleMapLayerChange = (value) => {
    setMapLayer(value);
    localStorage.setItem('mapLayer', value);
  };

  const handleGridOverlayChange = (value) => {
    setGridOverlay(value);
    localStorage.setItem('gridOverlay', value);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setLoading(false);
    });

    // A recovery link click authenticates the user via a special session, but
    // they still need to actually set a new password before entering the app.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
    });

    return () => subscription?.unsubscribe();
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      {passwordRecovery ? (
        <ResetPassword onDone={() => setPasswordRecovery(false)} />
      ) : !user ? (
        <Auth onAuthChange={setUser} />
      ) : (
        <>
          <Map profile={profile} mapLayer={mapLayer} gridOverlay={gridOverlay} onNavigatingChange={setNavigating} />
          {!navigating && (
            <MenuDrawer>
              <VehicleProfile onProfileUpdate={setProfile} />
              <MapLayerToggle value={mapLayer} onChange={handleMapLayerChange} />
              <GridOverlayToggle value={gridOverlay} onChange={handleGridOverlayChange} />
            </MenuDrawer>
          )}
        </>
      )}
    </div>
  );
}

export default App;