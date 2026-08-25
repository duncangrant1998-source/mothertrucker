import * as Sentry from '@sentry/react';

// Field error monitoring. The bugs that matter here only reproduce on a real
// phone, with real GPS, behind the login wall — so the devices have to report
// their own stack traces. Two constraints shape everything below:
//
//   1. Nothing about the driver leaves the device except their Supabase user
//      id (set from App.jsx). No email, no truck dimensions. The app logs
//      both of those liberally for its own debugging, so breadcrumbs are
//      scrubbed on the way out rather than trusted to be clean.
//   2. Errors in a navigation loop don't happen once — a bad frame can throw
//      on every GPS tick — so repeats are capped before they can spend a
//      month of the free tier's event quota on a single drive.

// Per page load. dedupeIntegration (on by default) already drops *consecutive*
// identical events; these caps also cover an error that alternates with
// another one, which dedupe lets through.
const MAX_EVENTS_PER_ISSUE = 5;
const MAX_EVENTS_PER_SESSION = 40;

const eventsPerIssue = new Map();
let sessionEventCount = 0;

// Redacts the things this app is known to put in log lines and request URLs.
// Exported so its behaviour can be tested directly — it is the only thing
// standing between the app's own diagnostic logging and a privacy leak.
// Kept deliberately narrow so the diagnostic logs the app already emits
// ([routing], [reroute], [route-options]) stay readable in Sentry.
export function scrub(text) {
  if (typeof text !== 'string') return text;
  return text
    // HERE routing query params carry the truck's dimensions:
    // `vehicle[height]=400`, raw or percent-encoded.
    .replace(/(vehicle(?:\[|%5B)[^\]&=]*(?:\]|%5D)=)[^&\s'"]*/gi, '$1[redacted]')
    // Credentials that ride along in HERE and Supabase URLs.
    .replace(/\b((?:apikey|api_key|access_token|refresh_token)=)[^&\s'"]*/gi, '$1[redacted]')
    // Email addresses, wherever they surface.
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g, '[redacted-email]')
    // Map.jsx's reroute diagnostic logs the same dimensions as a plain object
    // rather than a URL, so the query-param pattern above misses it. Gated on
    // the log's own label so unrelated `length:` values survive.
    .replace(
      /(vehicle params[^\n]*)/gi,
      (line) => line.replace(/((?:grossWeight|height|width|length|axleCount)["']?\s*:\s*)[\d.]+/gi, '$1[redacted]')
    );
}

function beforeBreadcrumb(breadcrumb) {
  if (typeof breadcrumb.message === 'string') {
    breadcrumb.message = scrub(breadcrumb.message);
  }
  if (breadcrumb.data) {
    // fetch/xhr breadcrumbs put the full request URL here.
    if (typeof breadcrumb.data.url === 'string') {
      breadcrumb.data.url = scrub(breadcrumb.data.url);
    }
    // console breadcrumbs keep the raw args alongside the joined message.
    if (Array.isArray(breadcrumb.data.arguments)) {
      breadcrumb.data.arguments = breadcrumb.data.arguments.map((arg) =>
        typeof arg === 'string' ? scrub(arg) : arg
      );
    }
  }
  return breadcrumb;
}

// Groups roughly the way Sentry itself would, so the cap lines up with what
// shows as one issue. Frames are ordered outermost-first, so the last one is
// where the throw actually happened.
function issueKey(event) {
  const ex = event.exception?.values?.[0];
  if (!ex) return `message:${event.message ?? 'unknown'}`;
  const frame = ex.stacktrace?.frames?.at(-1);
  return `${ex.type}:${ex.value}:${frame?.filename ?? '?'}:${frame?.lineno ?? '?'}`;
}

function beforeSend(event) {
  if (sessionEventCount >= MAX_EVENTS_PER_SESSION) return null;

  const key = issueKey(event);
  const count = (eventsPerIssue.get(key) ?? 0) + 1;
  eventsPerIssue.set(key, count);
  if (count > MAX_EVENTS_PER_ISSUE) return null;

  sessionEventCount += 1;

  // Marks the last one that gets through, so a capped issue is obvious in
  // Sentry rather than looking like it only happened five times.
  if (count === MAX_EVENTS_PER_ISSUE) {
    event.tags = { ...event.tags, repeat_capped: 'true' };
  }

  // Same redaction as breadcrumbs, applied to the event's own fields — an
  // error thrown with a URL in its message would otherwise slip past.
  if (typeof event.message === 'string') event.message = scrub(event.message);
  if (event.request?.url) event.request.url = scrub(event.request.url);
  event.exception?.values?.forEach((value) => {
    if (typeof value.value === 'string') value.value = scrub(value.value);
  });

  return event;
}

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;

  // No DSN configured — stay inert rather than throwing during startup.
  if (!dsn) {
    console.warn('[sentry] VITE_SENTRY_DSN is not set — error monitoring is disabled');
    return;
  }

  Sentry.init({
    dsn,
    // Keeps local testing noise out of the same stream as real device errors
    // from testers. Vite sets PROD for `vite build`, not for `vite dev`.
    environment: import.meta.env.PROD ? 'production' : 'development',

    // No IP addresses, cookies, or request bodies. The only user data sent is
    // the id set by Sentry.setUser() in App.jsx.
    sendDefaultPii: false,

    // Deliberately no replayIntegration: session replay would record the
    // login form and the vehicle profile drawer.
    integrations: [Sentry.browserTracingIntegration()],

    // Every distinct error is kept — beforeSend caps repeats instead, so a
    // one-off bug is never randomly thrown away the way blind sampling would.
    sampleRate: 1.0,

    // Traces bill against a separate, smaller quota and aren't the point of
    // this. A thin sample in production, nothing at all from local runs.
    // Set to 0 to turn performance monitoring off entirely.
    tracesSampleRate: import.meta.env.PROD ? 0.05 : 0,

    ignoreErrors: [
      // Browser layout quirk, never an actual app bug.
      'ResizeObserver loop completed with undelivered notifications',
      'ResizeObserver loop limit exceeded',
    ],

    beforeBreadcrumb,
    beforeSend,
  });
}

// Called on every auth state change. Scoped to the id alone on purpose:
// enough to tell which tester hit which error, nothing more.
export function setSentryUser(userId) {
  Sentry.setUser(userId ? { id: userId } : null);
}
