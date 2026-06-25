import { useState } from 'react';

const RouteSearch = ({ onSearch, profile }) => {
  const [startLocation, setStartLocation] = useState('');
  const [endLocation, setEndLocation] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!startLocation || !endLocation) {
      alert('Please enter both start and end locations');
      return;
    }

    if (!profile) {
      alert('Please save your vehicle profile first');
      return;
    }

    setLoading(true);
    onSearch({ start: startLocation, end: endLocation });
    setLoading(false);
  };

  return (
    <div style={{
      position: 'absolute',
      top: '20px',
      left: '20px',
      zIndex: 1000,
      background: 'white',
      padding: '20px',
      borderRadius: '10px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
      width: '260px'
    }}>
      <h2 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: 'bold' }}>
        Route Search
      </h2>

      <div style={{ marginBottom: '10px' }}>
        <label style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>
          Start Location
        </label>
        <input
          type="text"
          placeholder="City or address"
          value={startLocation}
          onChange={(e) => setStartLocation(e.target.value)}
          style={{
            width: '100%',
            padding: '6px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '14px',
            boxSizing: 'border-box'
          }}
        />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>
          End Location
        </label>
        <input
          type="text"
          placeholder="City or address"
          value={endLocation}
          onChange={(e) => setEndLocation(e.target.value)}
          style={{
            width: '100%',
            padding: '6px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '14px',
            boxSizing: 'border-box'
          }}
        />
      </div>

      <button
        onClick={handleSearch}
        disabled={loading || !profile}
        style={{
          width: '100%',
          padding: '10px',
          background: profile ? '#e85d04' : '#ccc',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          fontSize: '14px',
          fontWeight: 'bold',
          cursor: profile ? 'pointer' : 'not-allowed'
        }}
      >
        {loading ? 'Searching...' : 'Find Route'}
      </button>

      {!profile && (
        <p style={{
          marginTop: '10px',
          fontSize: '12px',
          color: '#e85d04',
          textAlign: 'center'
        }}>
          Save your vehicle profile first
        </p>
      )}
    </div>
  );
};

export default RouteSearch;