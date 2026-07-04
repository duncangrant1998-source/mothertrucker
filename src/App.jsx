import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { fetchOntarioInspectionStations } from './lib/inspectionStations';
import Map from './components/Map';
import VehicleProfile from './components/VehicleProfile';
import Auth from './Auth';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

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

  const handleSyncStations = async () => {
    setSyncing(true);
    setSyncMessage('');
    const count = await fetchOntarioInspectionStations();
    setSyncMessage(`Saved ${count} station${count === 1 ? '' : 's'} to Supabase`);
    setSyncing(false);
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      {!user ? (
        <Auth onAuthChange={() => setUser(true)} />
      ) : (
        <>
          <Map profile={profile} />
          <VehicleProfile onProfileUpdate={setProfile} />
          <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 1000, width: '260px' }}>
            <button
              onClick={handleSyncStations}
              disabled={syncing}
              style={{
                width: '100%',
                padding: '8px',
                background: syncing ? '#aaa' : '#374151',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 'bold',
                cursor: syncing ? 'not-allowed' : 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
              }}
            >
              {syncing ? 'Syncing...' : 'Sync MTO Stations'}
            </button>
            {syncMessage && (
              <div
                style={{
                  marginTop: '6px',
                  padding: '6px 8px',
                  background: 'white',
                  borderRadius: '6px',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                  fontSize: '12px',
                  color: '#2c662d',
                  fontWeight: 'bold'
                }}
              >
                {syncMessage}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default App;