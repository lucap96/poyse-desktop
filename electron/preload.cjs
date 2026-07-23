// Exposes a tiny, safe bridge so the web app can tell it's running inside the
// Poyse AI desktop shell (and therefore may offer Granola-style system-audio
// capture). See src/lib/platform.ts (isDesktop) and SystemAudioSource.
const { contextBridge, ipcRenderer } = require('electron')

// Buffer OAuth tokens that arrive (via the poyse:// deep link) before the app's
// auth listener has registered, and replay them on registration — avoids a race
// where the deep link lands before React mounts.
let bufferedTokens = null
const authCallbacks = []
ipcRenderer.on('poyse:auth-tokens', (_e, tokens) => {
  if (authCallbacks.length) {
    for (const cb of authCallbacks) cb(tokens)
  } else {
    bufferedTokens = tokens // no listener yet → replay on registration
  }
})

contextBridge.exposeInMainWorld('poyse', {
  desktop: true,
  platform: process.platform,
  // Granola-style in-call overlay controls (see electron/main.cjs).
  openOverlay: (meetingId) => ipcRenderer.invoke('overlay:open', meetingId),
  closeOverlay: () => ipcRenderer.send('overlay:close'),
  expand: () => ipcRenderer.send('app:expand'),
  // Open a URL in the user's real browser — used for OAuth (calendar/connectors)
  // so the flow isn't trapped in an app window with no way back.
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  // Register a callback for OAuth tokens handed back from the browser via the
  // poyse:// deep link. Replays any token buffered before registration.
  onAuthTokens: (cb) => {
    authCallbacks.push(cb)
    // Deliver-once: clear after replay so a React remount (e.g. StrictMode
    // double-mount) doesn't re-fire stale tokens into setSession.
    if (bufferedTokens) {
      const t = bufferedTokens
      bufferedTokens = null
      cb(t)
    }
  },
})
