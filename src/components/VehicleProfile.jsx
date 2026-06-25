import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

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
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'absolute',
      top: '20px',
      right: '20px',
      zIndex: 1000,
      background: 'white',
      padding: '20px',
      borderRadius: '10px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
      width: '260px'
    }}>
      <h2 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: 'bold' }}>
        Vehicle Profile
      </h2>

      {[
        { label: 'Height (m)', name: 'height' },
        { label: 'Width (m)', name: 'width' },
        { label: 'Length (m)', name: 'length' },
        { label: 'Weight (kg)', name: 'weight' },
      ].map(field => (
        <div key={field.name} style={{ marginBottom: '10px' }}>
          <label style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>
            {field.label}
          </label>
          <input
            type="number"
            name={field.name}
            value={profile[field.name]}
            onChange={handleChange}
            style={{
              width: '100%',
              padding: '6px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          />
        </div>
      ))}

      <div style={{ marginBottom: '10px' }}>
        <label style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>
          Axles
        </label>
        <select
          name="axles"
          value={profile.axles}
          onChange={handleChange}
          style={{
            width: '100%',
            padding: '6px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '14px'
          }}
        >
          {['2','3','4','5','6','7','8'].map(n => (
            <option key={n} value={n}>{n} axles</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>
          Load Type
        </label>
        <select
          name="load_type"
          value={profile.load_type}
          onChange={handleChange}
          style={{
            width: '100%',padding: '6px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '14px'
          }}
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
          borderRadius: '6px',
          fontSize: '14px',
          fontWeight: 'bold',
          cursor: loading ? 'not-allowed' : 'pointer'
        }}
      >
        {loading ? 'Saving...' : 'Save Profile'}
      </button>

      {message && (
        <p style={{
          marginTop: '10px',
          fontSize: '12px',
          color: message.includes('Error') ? 'red' : 'green',
          textAlign: 'center'
        }}>
          {message}
        </p>
      )}
    </div>
  );
};

export default VehicleProfile;