import { useState } from 'react';
import { supabase } from './lib/supabase';
import PasswordRequirements from './components/PasswordRequirements';
import { PASSWORD_MIN_LENGTH } from './lib/passwordRules';

const ResetPassword = ({ onDone }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleUpdatePassword = async () => {
    // Was hardcoded to 6, which went stale the moment the project's minimum
    // moved to 12 — it accepted a password that Supabase then rejected. Reads
    // the shared constant so the two can't drift again. The character-class
    // rules stay advisory (see passwordRules.js) and are shown in the list
    // below rather than gating here.
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'white',
      padding: '30px',
      borderRadius: '10px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      width: '320px',
      zIndex: 2000
    }}>
      <h2 style={{ marginBottom: '8px', textAlign: 'center', color: '#1B1F23' }}>Set New Password</h2>
      <p style={{ marginBottom: '16px', fontSize: '12px', color: '#666', textAlign: 'center' }}>
        Choose a new password for your account.
      </p>

      <input
        type="password"
        placeholder="New password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{
          width: '100%',
          padding: '10px',
          marginBottom: '10px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          fontSize: '14px',
          boxSizing: 'border-box',
          color: '#1B1F23',
          background: '#FFFFFF'
        }}
      />

      <PasswordRequirements password={password} />

      <input
        type="password"
        placeholder="Confirm new password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        style={{
          width: '100%',
          padding: '10px',
          marginBottom: '15px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          fontSize: '14px',
          boxSizing: 'border-box',
          color: '#1B1F23',
          background: '#FFFFFF'
        }}
      />

      <button
        onClick={handleUpdatePassword}
        disabled={loading}
        style={{
          width: '100%',
          padding: '10px',
          background: '#e85d04',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontSize: '14px',
          fontWeight: 'bold',
          cursor: loading ? 'not-allowed' : 'pointer'
        }}
      >
        {loading ? 'Updating...' : 'Update Password'}
      </button>

      {error && (
        <p style={{ marginTop: '15px', fontSize: '12px', color: 'red', textAlign: 'center' }}>
          {error}
        </p>
      )}
    </div>
  );
};

export default ResetPassword;
