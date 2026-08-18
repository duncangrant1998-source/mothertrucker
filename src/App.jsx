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
  // null = no manual override yet, defaults to dark (see effectiveColorScheme)
  // rather than following the system/OS scheme.
  const [manualColorScheme, setManualColorScheme] = useState(() => {
    const stored = localStorage.getItem('colorScheme');
    return stored === 'light' || stored === 'dark' ? stored : null;
  });

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

  // The signed-out screen (Auth) always renders in dark mode, regardless of
  // system preference or a saved manual override — there's no logged-in user
  // yet to have a preference for.
  const showingAuthScreen = !loading && !passwordRecovery && !user;

  // Dark is the default for both the signed-out screen and the main app
  // until the user explicitly picks Light from the drawer's toggle.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', showingAuthScreen ? 'dark' : (manualColorScheme ?? 'dark'));
  }, [manualColorScheme, showingAuthScreen]);

  const effectiveColorScheme = manualColorScheme ?? 'dark';

  // Keeps the browser/OS chrome (status bar tint, task switcher card) matching
  // the app's actual displayed scheme — including a manual drawer override,
  // which index.html's static <meta name="theme-color"> can't react to on
  // its own since it has no way to know about anything but the OS preference.
  useEffect(() => {
    const meta = document.getElementById('theme-color-meta');
    const scheme = showingAuthScreen ? 'dark' : effectiveColorScheme;
    if (meta) meta.setAttribute('content', scheme === 'dark' ? '#1F2327' : '#e85d04');
  }, [effectiveColorScheme, showingAuthScreen]);

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

  // Loads the driver's saved truck dimensions as soon as they're signed in,
  // so routing (and rerouting) uses their real vehicle profile from the
  // start of the session instead of silently falling back to Map.jsx's
  // generic defaults until they happen to reopen the profile drawer and hit
  // Save. Mirrors VehicleProfile.jsx's own load query; leaves `profile` at
  // its null default (same fallback-to-defaults behavior as before) if the
  // driver hasn't saved a profile yet.
  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('vehicle_profiles')
          .select('*')
          .eq('user_id', user.id)
          .single();
        if (!cancelled && !error && data) setProfile(data);
      } catch (err) {
        console.error('Failed to load vehicle profile:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

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