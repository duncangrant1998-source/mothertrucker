import { useState } from 'react';
import { supabase } from './lib/supabase';

const Auth = ({ onAuthChange }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState('');

  const handleAuth = async () => {
    setLoading(true);
    setMessage('');
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage('Check your email to confirm signup!');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMessage('Logged in!');
        onAuthChange();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
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
      <h2 style={{ marginBottom: '20px', textAlign: 'center' }}>Mother Trucker</h2>
      
      <input
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
          boxSizing: 'border-box'
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
          marginBottom: '15px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          fontSize: '14px',
          boxSizing: 'border-box'
        }}
      />
      
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
  );
};

export default Auth;