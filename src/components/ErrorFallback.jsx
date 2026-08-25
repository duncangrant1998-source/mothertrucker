// Shown by Sentry's ErrorBoundary when a render throws. The event id is on
// screen deliberately: a tester on the road can read it out or screenshot it,
// which pins the report to an exact error in Sentry instead of a description
// of what the screen looked like.
const ErrorFallback = ({ error, resetError, eventId }) => (
  <div style={{
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    padding: '24px',
    background: '#1F2327',
    color: '#F5F5F5',
    textAlign: 'center'
  }}>
    <h2 style={{ margin: 0, fontSize: '20px' }}>Something went wrong</h2>
    <p style={{ margin: 0, fontSize: '14px', color: '#B0B6BC', maxWidth: '320px' }}>
      The app hit an error and stopped. It has been reported automatically.
    </p>
    {eventId && (
      <code style={{ fontSize: '12px', color: '#8A9199', wordBreak: 'break-all' }}>
        {eventId}
      </code>
    )}
    <button
      onClick={resetError}
      style={{
        padding: '12px 24px',
        background: '#e85d04',
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        fontSize: '15px',
        fontWeight: 'bold',
        cursor: 'pointer'
      }}
    >
      Try Again
    </button>
    <button
      onClick={() => window.location.reload()}
      style={{
        padding: '10px 20px',
        background: 'transparent',
        color: '#B0B6BC',
        border: '1px solid #3A4148',
        borderRadius: '4px',
        fontSize: '14px',
        cursor: 'pointer'
      }}
    >
      Reload App
    </button>
    {import.meta.env.DEV && error?.message && (
      <pre style={{
        fontSize: '11px',
        color: '#E06C75',
        maxWidth: '90vw',
        overflowX: 'auto',
        textAlign: 'left'
      }}>
        {error.message}
      </pre>
    )}
  </div>
);

export default ErrorFallback;
