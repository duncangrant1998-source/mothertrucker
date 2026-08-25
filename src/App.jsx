import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { setSentryUser } from './lib/sentry';
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
    // Tagging every Sentry event with the Supabase user id is what makes a
    // field report traceable to the tester who hit it. Set here rather than in
    // Auth.jsx so it also covers a restored session on app open, and clears on
    // sign-out. Id only — no email, no vehicle profile.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setSentryUser(session?.user?.id ?? null);
      setLoading(false);
    });

    // A recovery link click authenticates the user via a special session, but
    // they still need to actually set a new password before entering the app.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
      setSentryUser(session?.user?.id ?? null);
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
          .maybeSingle();
        // Rethrow rather than swallowing via `!error &&`: a real load failure
        // used to leave `profile` null with nothing logged anywhere, so the
        // app silently routed on Map.jsx's generic defaults instead of the
        // driver's actual truck. Now it at least reaches the console, and
        // therefore Sentry's breadcrumbs.
        if (error) throw error;
        if (!cancelled && data) setProfile(data);
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