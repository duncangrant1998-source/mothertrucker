import { PASSWORD_RULES } from '../lib/passwordRules';

// Shown live while the driver types on the signup form, so they learn the
// rules up front rather than only after Supabase rejects the signup with its
// own raw error text.
const PasswordRequirements = ({ password = '' }) => (
  <ul style={{
    listStyle: 'none',
    margin: '0 0 10px',
    padding: '8px 10px',
    background: '#F7F7F7',
    borderRadius: '4px'
  }}>
    {PASSWORD_RULES.map(({ label, test }) => {
      const met = test(password);
      return (
        <li
          key={label}
          aria-label={`${label}: ${met ? 'met' : 'not met'}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            lineHeight: 1.6,
            color: met ? '#15803d' : '#666'
          }}
        >
          <span aria-hidden="true" style={{ width: '10px', fontWeight: 'bold' }}>
            {met ? '✓' : '○'}
          </span>
          <span>{label}</span>
        </li>
      );
    })}
  </ul>
);

export default PasswordRequirements;
