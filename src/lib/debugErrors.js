// TEMPORARY — on-screen error strip for the in-vehicle investigation.
//
// Testing happens on an iPhone driven from a Windows machine, so there is no
// Safari Web Inspector and no console. A thrown exception therefore produces
// no visible signal at all: the symptom reaching the developer is "the route
// won't generate" or "nothing happens", which is indistinguishable from a
// logic bug and sends the investigation to entirely the wrong place. A
// map.getObjects() call that threw above the line publishing mapInstance cost
// a full test cycle for exactly this reason — the map kept rendering tiles
// while every feature behind it was dead, and nothing said so.
//
// Deliberately not a React component. If React fails to render, or an error
// boundary swallows the component tree, a React-based reporter goes down with
// it — which is precisely when the message is most needed. This writes
// straight to the DOM and is installed before createRoot.
//
// Query param only, never persisted: enable with ?debug=1, and closing the tab
// clears it. Remove this file, its import in main.jsx, and the overlay in
// Map.jsx together once the camera and rendering questions are settled.

const MAX_ENTRIES = 6;

const enabled = () => {
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
};

// First stack frame only — the full trace is unreadable at phone width, and
// the file:line of the throw is the part that identifies it.
const firstFrame = (stack) => {
  if (typeof stack !== 'string') return '';
  const line = stack.split('\n').find((l) => /\.(js|jsx|mjs)/.test(l));
  if (!line) return '';
  return line.trim().replace(/^at\s+/, '').replace(/.*\/assets\//, '').slice(0, 72);
};

const describe = (err) => {
  if (err instanceof Error) {
    const where = firstFrame(err.stack);
    return where ? `${err.name}: ${err.message}\n  ${where}` : `${err.name}: ${err.message}`;
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err).slice(0, 200);
  } catch {
    return String(err);
  }
};

export const installDebugErrorStrip = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!enabled()) return;

  const entries = [];
  let box = null;

  const ensureBox = () => {
    if (box) return box;
    box = document.createElement('div');
    box.setAttribute('data-debug-errors', '');
    Object.assign(box.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      zIndex: '2147483647',
      maxHeight: '45vh',
      overflowY: 'auto',
      // pointerEvents stays on so the strip can be scrolled and dismissed; it
      // only exists once something has actually gone wrong.
      background: 'rgba(120,10,10,0.95)',
      color: '#fff',
      font: '700 12px/1.35 "JetBrains Mono", ui-monospace, monospace',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      padding: '6px 8px calc(6px + env(safe-area-inset-top))',
      paddingTop: 'calc(6px + env(safe-area-inset-top))',
      borderBottom: '2px solid #fff'
    });
    box.addEventListener('click', () => {
      entries.length = 0;
      box.remove();
      box = null;
    });
    document.body.appendChild(box);
    return box;
  };

  const push = (label, err) => {
    const stamp = new Date().toTimeString().slice(0, 8);
    entries.push(`${stamp} ${label} ${describe(err)}`);
    while (entries.length > MAX_ENTRIES) entries.shift();
    const el = ensureBox();
    el.textContent = `${entries.length} ERROR(S) — tap to dismiss\n${entries.join('\n')}`;
  };

  window.addEventListener('error', (e) => {
    push('ERR', e.error ?? e.message ?? 'unknown error');
  });

  window.addEventListener('unhandledrejection', (e) => {
    push('REJ', e.reason ?? 'unhandled rejection');
  });

  // console.error is where this app already reports the failures it survives
  // — a thrown animation frame, a camera call that did not apply, a rejected
  // reroute. Those never reach window.onerror because they are caught.
  const original = console.error;
  console.error = (...args) => {
    try {
      const first = args.find((a) => a instanceof Error);
      push('LOG', first ?? args.map((a) => (typeof a === 'string' ? a : describe(a))).join(' '));
    } catch {
      // Never let the reporter break the thing it is reporting on.
    }
    original.apply(console, args);
  };
};
