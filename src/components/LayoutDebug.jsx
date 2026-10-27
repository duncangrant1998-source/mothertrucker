import { useState, useEffect } from 'react';

// TEMPORARY — on-screen layout readout for the "black strip at the bottom of
// the installed iPhone app" bug, which could not be reproduced off-device.
// Delete this file and its render in App.jsx once the strip is fixed.
//
// Probes sit offscreen in the DOM so each CSS viewport unit and the safe-area
// insets can be measured as the browser actually resolves them, next to the
// window/screen numbers and the real heights of #root and the map canvas.
const PROBE_STYLE = { position: 'fixed', left: 0, top: 0, width: 1, visibility: 'hidden', pointerEvents: 'none' };

export default function LayoutDebug() {
  const [text, setText] = useState('');

  useEffect(() => {
    const measure = () => {
      const probe = (css) => {
        const el = document.createElement('div');
        Object.assign(el.style, PROBE_STYLE);
        el.style.cssText += css;
        document.body.appendChild(el);
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const out = { h: Math.round(rect.height), pt: cs.paddingTop, pb: cs.paddingBottom };
        el.remove();
        return out;
      };
      const vv = window.visualViewport;
      const root = document.getElementById('root');
      const canvas = document.querySelector('canvas');
      const lines = [
        `inner ${window.innerWidth}x${window.innerHeight}  screen ${screen.width}x${screen.height}`,
        `docEl client ${document.documentElement.clientHeight}  vv ${vv ? Math.round(vv.height) : '-'}`,
        `vh ${probe('height:100vh').h}  svh ${probe('height:100svh').h}  lvh ${probe('height:100lvh').h}  dvh ${probe('height:100dvh').h}`,
        `safe top ${probe('padding-top:env(safe-area-inset-top)').pt}  bottom ${probe('padding-bottom:env(safe-area-inset-bottom)').pb}`,
        `#root ${root ? Math.round(root.getBoundingClientRect().height) : '-'}  canvas ${canvas ? canvas.clientHeight : '-'}`,
        `standalone ${String(window.navigator.standalone)}`
      ];
      setText(lines.join('\n'));
    };
    measure();
    const timer = setInterval(measure, 1500);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <pre
      style={{
        position: 'fixed',
        left: 8,
        bottom: 8,
        zIndex: 9999,
        margin: 0,
        padding: '6px 8px',
        pointerEvents: 'none',
        whiteSpace: 'pre',
        fontFamily: 'ui-monospace, monospace',
        fontSize: '10px',
        lineHeight: 1.3,
        color: '#7CFC00',
        background: 'rgba(0,0,0,0.8)',
        borderRadius: 6
      }}
    >
      {text}
    </pre>
  );
}
