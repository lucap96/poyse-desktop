// Exposes a tiny, safe bridge so the web app can tell it's running inside the
// Poyse AI desktop shell (and therefore may offer Granola-style system-audio
// capture). See src/lib/platform.ts (isDesktop) and SystemAudioSource.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('poyse', {
  desktop: true,
  platform: process.platform,
  // Granola-style in-call overlay controls (see electron/main.cjs).
  openOverlay: (meetingId) => ipcRenderer.invoke('overlay:open', meetingId),
  closeOverlay: () => ipcRenderer.send('overlay:close'),
  expand: () => ipcRenderer.send('app:expand'),
})
