import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Tailwind utility classes never actually take effect in this project (no
// @tailwindcss/postcss or @tailwindcss/vite plugin is wired up, so
// `@import "tailwindcss"` never expands) — plain inline styles here instead,
// matching Map.jsx/VehicleProfile.jsx/Auth.jsx. A tiny scoped <style> block
// covers the couple of hover states inline styles can't express.

const LABEL_STYLE = {
  fontFamily: 'var(--font-display)',
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--color-text-muted)'
}

export default function MenuDrawer({ children }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data?.user?.email ?? '')
    })
  }, [])

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    const { error } = await supabase.auth.signOut()
    if (error) {
      setSigningOut(false)
      alert('Could not sign out: ' + error.message)
    }
    // On success, the auth listener in App.jsx sends you back to the login screen.
  }

  return (
    <>
      <style>{`
        .mt-hamburger:hover { background: var(--color-bg); }
        .mt-close-btn:hover { background: var(--color-bg); color: var(--color-text-primary); }
        .mt-signout-btn:hover:not(:disabled) { background: var(--color-bg); }
        @media (max-width: 480px) {
          .mt-drawer {
            left: 12px !important;
            right: 12px !important;
            top: 12px !important;
            width: auto !important;
            max-width: none !important;
          }
        }
      `}</style>

      {/* Hamburger button — always visible, top right */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="mt-hamburger"
        style={{
          position: 'fixed',
          top: '16px',
          right: '16px',
          zIndex: 4000,
          width: '56px',
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--radius-soft)',
          background: 'var(--color-panel)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
          cursor: 'pointer'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ display: 'block', height: '3px', width: '28px', background: 'var(--color-text-primary)' }} />
          <span style={{ display: 'block', height: '3px', width: '28px', background: 'var(--color-text-primary)' }} />
          <span style={{ display: 'block', height: '3px', width: '28px', background: 'var(--color-text-primary)' }} />
        </div>
      </button>

      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 4001, background: 'rgba(0,0,0,0.3)' }}
        />
      )}

      {/* Drawer */}
      <aside
        className="mt-drawer"
        style={{
          position: 'fixed',
          top: '16px',
          right: '16px',
          zIndex: 4002,
          display: 'flex',
          height: 'auto',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          width: '340px',
          maxWidth: '85vw',
          flexDirection: 'column',
          background: 'var(--color-panel)',
          borderRadius: 'var(--radius-soft)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.25)',
          fontFamily: 'var(--font-display)',
          transition: 'transform 200ms ease-out',
          // translateX(100%) alone only clears the drawer's own width — the
          // 16px `right` inset (plus the box-shadow's blur bleed) would still
          // leave a sliver on screen, so push it an extra 40px past that.
          transform: open ? 'translateX(0)' : 'translateX(calc(100% + 40px))'
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', padding: '16px 20px' }}>
          <h2 style={LABEL_STYLE}>Menu</h2>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="mt-close-btn"
            style={{
              width: '44px',
              height: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 0,
              border: 'none',
              background: 'transparent',
              fontSize: '24px',
              lineHeight: 1,
              color: 'var(--color-text-muted)',
              cursor: 'pointer'
            }}
          >
            &times;
          </button>
        </header>

        <div style={{ padding: '16px 20px', color: 'var(--color-text-primary)' }}>
          {/* Vehicle Profile drops in here */}
          {children}
        </div>

        <footer style={{ borderTop: '1px solid var(--color-border)', padding: '16px 20px' }}>
          {email && (
            <p style={{ marginBottom: '12px', fontSize: '11px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={email}>
              Signed in as <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>{email}</span>
            </p>
          )}
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="mt-signout-btn"
            style={{
              width: '100%',
              minHeight: '44px',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 0,
              border: '1px solid var(--color-border)',
              padding: '10px 16px',
              fontFamily: 'var(--font-display)',
              fontSize: '13px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--color-text-primary)',
              background: 'var(--color-panel)',
              cursor: signingOut ? 'not-allowed' : 'pointer',
              opacity: signingOut ? 0.6 : 1
            }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </footer>
      </aside>
    </>
  )
}
