import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fetchOntarioInspectionStations } from '../lib/inspectionStations';

const LABEL_STYLE = {
  fontFamily: 'var(--font-display)',
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--color-text-muted)',
  display: 'block',
  marginBottom: '4px'
};

const INPUT_STYLE = {
  width: '100%',
  padding: '7px 8px',
  border: '1px solid var(--color-border)',
  borderRadius: 0,
  boxSizing: 'border-box',
  background: 'var(--color-panel)',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: '14px'
};

const VehicleProfile = ({ onProfileUpdate }) => {
  const [profile, setProfile] = useState({
    height: '',
    width: '',
    length: '',
    weight: '',
    axles: '2',
    load_type: 'oversize'
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [syncingStations, setSyncingStations] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('vehicle_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();
      if (data) setProfile(data);
    } catch (err) {
      console.log('No profile found yet');
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfile(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    setLoading(true);
    setMessage('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setMessage('Please log in first');
        setLoading(false);
        return;
      }
      const { error } = await supabase
        .from('vehicle_profiles')
        .upsert({ user_id: user.id, ...profile });
      if (error) throw error;
      setMessage('Profile saved!');
      onProfileUpdate(profile);
      syncInspectionStationsIfEmpty();
      // Brief pause so the confirmation is actually readable before the
      // section tucks itself away.
      setTimeout(() => setExpanded(false), 800);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const syncInspectionStationsIfEmpty = async () => {
    try {
      const { count, error } = await supabase
        .from('inspection_stations')
        .select('*', { count: 'exact', head: true });
      if (error) throw error;
      if (count === 0) {
        setSyncingStations(true);
        await fetchOntarioInspectionStations();
        setSyncingStations(false);
      }
    } catch (err) {
      console.error('Failed to sync inspection stations:', err);
      setSyncingStations(false);
    }
  };

  return (
    <div style={{ fontFamily: 'var(--font-display)' }}>
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        aria-expanded={expanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          marginBottom: '12px',
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontFamily: 'var(--font-display)'
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)' }}>
          Vehicle Profile
        </span>
        <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      <div style={{ display: 'grid', gridTemplateRows: expanded ? '1fr' : '0fr', transition: 'grid-template-rows 200ms ease-out' }}>
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          {[
            { label: 'Height (m)', name: 'height' },
            { label: 'Width (m)', name: 'width' },
            { label: 'Length (m)', name: 'length' },
            { label: 'Weight (kg)', name: 'weight' },
          ].map(field => (
            <div key={field.name} style={{ marginBottom: '10px' }}>
              <label style={LABEL_STYLE}>
                {field.label}
              </label>
              <input
                type="number"
                name={field.name}
                value={profile[field.name]}
                onChange={handleChange}
                style={INPUT_STYLE}
              />
            </div>
          ))}

          <div style={{ marginBottom: '10px' }}>
            <label style={LABEL_STYLE}>
              Axles
            </label>
            <select
              name="axles"
              value={profile.axles}
              onChange={handleChange}
              style={{ ...INPUT_STYLE, fontFamily: 'var(--font-display)', cursor: 'pointer' }}
            >
              {['2','3','4','5','6','7','8'].map(n => (
                <option key={n} value={n}>{n} axles</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={LABEL_STYLE}>
              Load Type
            </label>
            <select
              name="load_type"
              value={profile.load_type}
              onChange={handleChange}
              style={{ ...INPUT_STYLE, fontFamily: 'var(--font-display)', cursor: 'pointer' }}
            >
              <option value="oversize">Oversize</option>
              <option value="overweight">Overweight</option>
              <option value="both">Both</option>
              <option value="standard">Standard Commercial</option>
            </select>
          </div>

          <button
            onClick={handleSave}
            disabled={loading}
            style={{
              width: '100%',
              padding: '10px',
              background: '#e85d04',
              color: 'white',
              border: 'none',
              borderRadius: 0,
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Saving…' : 'Save Profile'}
          </button>

          {message && (
            <p style={{
              marginTop: '10px',
              fontSize: '12px',
              color: message.includes('Error') ? '#dc2626' : 'var(--color-route-normal)',
              textAlign: 'center'
            }}>
              {message}
            </p>
          )}

          {syncingStations && (
            <p style={{
              marginTop: '8px',
              fontSize: '11px',
              color: 'var(--color-text-muted)',
              textAlign: 'center'
            }}>
              Loading stations...
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default VehicleProfile;
