import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Map from './components/Map';
import VehicleProfile from './components/VehicleProfile';
import Auth from './Auth';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => subscription?.unsubscribe();
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <Map profile={profile} />
      {user ? (
        <VehicleProfile onProfileUpdate={setProfile} />
      ) : (
        <Auth onAuthChange={() => {}} />
      )}
    </div>
  );
}

export default App;