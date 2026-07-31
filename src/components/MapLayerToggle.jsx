const LABEL_STYLE = {
  fontFamily: 'var(--font-display)',
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--color-text-muted)'
};

const segmentStyle = (active) => ({
  flex: 1,
  minHeight: '44px',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '10px',
  border: 'none',
  background: active ? '#e85d04' : 'var(--color-panel)',
  color: active ? 'white' : 'var(--color-text-primary)',
  fontFamily: 'var(--font-display)',
  fontSize: '12px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  cursor: 'pointer'
});

// Sits below Vehicle Profile in the drawer, separated the same way the
// drawer's own footer is (border-top + top margin) rather than nesting
// inside VehicleProfile, since this is an app-level display preference.
export default function MapLayerToggle({ value, onChange }) {
  return (
    <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--color-border)' }}>
      <label style={{ ...LABEL_STYLE, display: 'block', marginBottom: '8px' }}>
        Map Display
      </label>
      <div
        style={{
          display: 'flex',
          borderRadius: 'var(--radius-soft)',
          overflow: 'hidden',
          border: '1px solid var(--color-border)'
        }}
      >
        <button
          type="button"
          onClick={() => onChange('map')}
          style={{ ...segmentStyle(value === 'map'), borderRight: '1px solid var(--color-border)' }}
        >
          Map
        </button>
        <button
          type="button"
          onClick={() => onChange('satellite')}
          style={segmentStyle(value === 'satellite')}
        >
          Satellite
        </button>
      </div>
    </div>
  );
}
