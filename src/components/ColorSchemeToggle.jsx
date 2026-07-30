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

// Sits with MapLayerToggle/GridOverlayToggle as a display-settings group.
// `value` is the *effective* scheme (manual override, or the live system
// preference when no override has been made yet) so the active segment is
// always accurate even before the user has picked one explicitly.
export default function ColorSchemeToggle({ value, onChange }) {
  return (
    <div style={{ marginTop: '16px' }}>
      <label style={{ ...LABEL_STYLE, display: 'block', marginBottom: '8px' }}>
        Color Scheme
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
          onClick={() => onChange('light')}
          style={{ ...segmentStyle(value === 'light'), borderRight: '1px solid var(--color-border)' }}
        >
          Light
        </button>
        <button
          type="button"
          onClick={() => onChange('dark')}
          style={segmentStyle(value === 'dark')}
        >
          Dark
        </button>
      </div>
    </div>
  );
}
