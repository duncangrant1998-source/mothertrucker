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

// Sits next to MapLayerToggle in the drawer, styled identically.
export default function GridOverlayToggle({ value, onChange }) {
  return (
    <div style={{ marginTop: '16px' }}>
      <label style={{ ...LABEL_STYLE, display: 'block', marginBottom: '8px' }}>
        Grid Overlay
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
          onClick={() => onChange('off')}
          style={{ ...segmentStyle(value === 'off'), borderRight: '1px solid var(--color-border)' }}
        >
          Off
        </button>
        <button
          type="button"
          onClick={() => onChange('on')}
          style={segmentStyle(value === 'on')}
        >
          On
        </button>
      </div>
    </div>
  );
}
