import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Map from './components/Map';
import VehicleProfile from './components/VehicleProfile';
import MenuDrawer from './components/MenuDrawer';
import MapLayerToggle from './components/MapLayerToggle';
import GridOverlayToggle from './components/GridOverlayToggle';
import ColorSchemeToggle from './components/ColorSchemeToggle';
import Auth from './Auth';
import ResetPassword from './ResetPassword';

const getSystemPrefersDark = () => (
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
);

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
  // null = no manual override yet, keep following the system/OS scheme
  // (including its own automatic day/night switch) exactly as before.
  const [manualColorScheme, setManualColorScheme] = useState(() => {
    const stored = localStorage.getItem('colorScheme');
    return stored === 'light' || stored === 'dark' ? stored : null;
  });
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark);

  const handleMapLayerChange = (value) => {
    setMapLayer(value);
    localStorage.setItem('mapLayer', value);
  };

  const handleGridOverlayChange = (value) => {
    setGridOverlay(value);
    localStorage.setItem('gridOverlay', value);
  };

  const handleColorSchemeChange = (value) => {
    setManualColorScheme(value);
    localStorage.setItem('colorScheme', value);
  };

  // Tracks the OS preference live so the toggle's active segment stays
  // accurate even while no manual override has been made.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => setSystemPrefersDark(e.matches);
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  // No manual override -> no data-theme attribute -> the existing
  // prefers-color-scheme CSS keeps driving the theme untouched.
  useEffect(() => {
    if (manualColorScheme) {
      document.documentElement.setAttribute('data-theme', manualColorScheme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [manualColorScheme]);

  const effectiveColorScheme = manualColorScheme ?? (systemPrefersDark ? 'dark' : 'light');

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
          <Map profile={profile} mapLayer={mapLayer} gridOverlay={gridOverlay} colorScheme={effectiveColorScheme} onNavigatingChange={setNavigating} />
          {!navigating && (
            <MenuDrawer>
              <VehicleProfile onProfileUpdate={setProfile} />
              <MapLayerToggle value={mapLayer} onChange={handleMapLayerChange} />
              <GridOverlayToggle value={gridOverlay} onChange={handleGridOverlayChange} />
              <ColorSchemeToggle value={effectiveColorScheme} onChange={handleColorSchemeChange} />
            </MenuDrawer>
          )}
        </>
      )}
    </div>
  );
}

export default App;