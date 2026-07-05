import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Map from './components/Map';
import VehicleProfile from './components/VehicleProfile';
import Auth from './Auth';
import ResetPassword from './ResetPassword';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [navigating, setNavigating] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

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
          <Map profile={profile} onNavigatingChange={setNavigating} />
          {!navigating && <VehicleProfile onProfileUpdate={setProfile} />}
        </>
      )}
    </div>
  );
}

export default App;