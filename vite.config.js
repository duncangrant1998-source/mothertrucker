import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Vercel supplies SENTRY_AUTH_TOKEN as a Secret; a dev machine normally
// doesn't have it. Without a token the plugin can't upload, so it's switched
// off entirely rather than left to fail the build locally.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN

// https://vite.dev/config/
export default defineConfig({
  build: {
    // 'hidden' emits the .map files the plugin uploads but leaves the
    // //# sourceMappingURL comment out of the bundles, so nothing points a
    // browser at them. Sentry doesn't need that comment — the plugin stamps
    // matching debug ids into both the bundle and the map and pairs them up
    // server-side.
    sourcemap: 'hidden',
  },
  plugins: [
    react(),
    sentryVitePlugin({
      org: 'duncan-grant',
      project: 'mothertrucker-web',
      authToken: sentryAuthToken,
      disable: !sentryAuthToken,
      sourcemaps: {
        // Belt and braces with 'hidden': the maps are removed from dist/ once
        // they're uploaded, so they're never deployed at all.
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
      // Without this the plugin logs the failure and the build still exits 0,
      // so an expired token would produce a green Vercel deploy whose stack
      // traces stay minified forever — the one failure mode that defeats the
      // point of uploading at all. Deliberately does NOT rethrow: a Sentry
      // outage shouldn't block shipping a fix to drivers. Rethrow `err` here
      // instead if you'd rather a failed upload hard-fail the deploy.
      errorHandler: (err) => {
        console.error('')
        console.error('==========================================================')
        console.error('  SENTRY SOURCE MAP UPLOAD FAILED')
        console.error('  Stack traces for this release will stay MINIFIED.')
        console.error('  Check SENTRY_AUTH_TOKEN in the Vercel project settings.')
        console.error('==========================================================')
        console.error(err.message)
        console.error('')
      },
    }),
  ],
})
