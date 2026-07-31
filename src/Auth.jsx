import { useState } from 'react';
import { supabase } from './lib/supabase';
import highwayDusk from './assets/highway-dusk.svg';

const Auth = ({ onAuthChange }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');

  const handleAuth = async () => {
    setLoading(true);
    setMessage('');
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage('Check your email to confirm signup!');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMessage('Logged in!');
        onAuthChange(data.user);
      }
    } catch (err) {
      setMessage(`Error: ${err?.message || 'Something went wrong'}`);
    } finally {
      setLoading(false);
    }
  };

  const openForgotPassword = () => {
    setResetEmail(email);
    setResetError('');
    setShowForgotPassword(true);
  };

  const handleSendResetLink = async () => {
    if (!resetEmail) {
      setResetError('Enter your email address');
      return;
    }
    setResetLoading(true);
    setResetError('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: window.location.origin
      });
      if (error) throw error;
      setShowForgotPassword(false);
      setMessage('Password reset email sent — check your inbox');
    } catch (err) {
      setResetError(err?.message === 'Failed to fetch'
        ? 'Network error — check your connection and try again'
        : (err?.message || 'Something went wrong'));
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <>
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 0,
      backgroundImage: `url("${highwayDusk}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat'
    }} />
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 1,
      background: 'rgba(0,0,0,0.5)'
    }} />
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
      <h2 style={{ marginBottom: '20px', textAlign: 'center', color: '#1B1F23' }}>Mother Trucker</h2>

      <input
        id="login-email"
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
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

      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{
          width: '100%',
          padding: '10px',
          marginBottom: '6px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          fontSize: '14px',
          boxSizing: 'border-box',
          color: '#1B1F23',
          background: '#FFFFFF'
        }}
      />

      {!isSignUp && (
        <div style={{ textAlign: 'right', marginBottom: '10px' }}>
          <button
            onClick={openForgotPassword}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: '#e85d04',
              fontSize: '12px',
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            Forgot Password?
          </button>
        </div>
      )}

      <button
        onClick={handleAuth}
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
          cursor: loading ? 'not-allowed' : 'pointer',
          marginBottom: '10px'
        }}
      >
        {loading ? 'Loading...' : isSignUp ? 'Sign Up' : 'Log In'}
      </button>
      
      <button
        onClick={() => setIsSignUp(!isSignUp)}
        style={{
          width: '100%',
          padding: '10px',
          background: '#f5f5f5',
          color: '#333',
          border: '1px solid #ccc',
          borderRadius: '4px',
          fontSize: '14px',
          cursor: 'pointer'
        }}
      >
        {isSignUp ? 'Have an account? Log In' : 'Need an account? Sign Up'}
      </button>
      
      {message && (
        <p style={{
          marginTop: '15px',
          fontSize: '12px',
          color: message.includes('Error') ? 'red' : 'green',
          textAlign: 'center'
        }}>
          {message}
        </p>
      )}
    </div>

    {showForgotPassword && (
      <div
        onClick={() => setShowForgotPassword(false)}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 2100,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'white',
            padding: '24px',
            borderRadius: '10px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            width: '300px'
          }}
        >
          <h3 style={{ marginBottom: '8px', fontSize: '16px', color: '#1B1F23' }}>Reset Password</h3>
          <p style={{ marginBottom: '14px', fontSize: '12px', color: '#666' }}>
            Enter your email and we'll send you a link to reset your password.
          </p>
          <input
            id="reset-email"
            type="email"
            placeholder="Email"
            value={resetEmail}
            onChange={(e) => setResetEmail(e.target.value)}
            autoFocus
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
          {resetError && (
            <p style={{ marginBottom: '10px', fontSize: '12px', color: 'red' }}>{resetError}</p>
          )}
          <button
            onClick={handleSendResetLink}
            disabled={resetLoading}
            style={{
              width: '100%',
              padding: '10px',
              background: '#e85d04',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '14px',
              fontWeight: 'bold',
              cursor: resetLoading ? 'not-allowed' : 'pointer',
              marginBottom: '8px'
            }}
          >
            {resetLoading ? 'Sending...' : 'Send Reset Link'}
          </button>
          <button
            onClick={() => setShowForgotPassword(false)}
            style={{
              width: '100%',
              padding: '10px',
              background: '#f5f5f5',
              color: '#333',
              border: '1px solid #ccc',
              borderRadius: '4px',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    )}
    </>
  );
};

export default Auth;