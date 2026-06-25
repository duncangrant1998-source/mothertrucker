import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import Map from './components/Map';
import VehicleProfile from './components/VehicleProfile';
import RouteSearch from './components/RouteSearch';
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

  const handleRouteSearch = ({ start, end }) => {
    console.log('Searching route from', start, 'to', end, 'with profile:', profile);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      {!user ? (
        <Auth onAuthChange={() => setUser(true)} />
      ) : (
        <>
          <Map profile={profile} />
          <RouteSearch onSearch={handleRouteSearch} profile={profile} />
          <VehicleProfile onProfileUpdate={setProfile} />
        </>
      )}
    </div>
  );
}

export default App;