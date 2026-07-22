// Poyse AI desktop shell (Granola-style). A thin Electron wrapper around the
// existing Poyse AI web app whose ONLY job is to grant the renderer something a
// browser can't have: the machine's LOOPBACK (system) audio — everything you
// hear, i.e. the far side of any Teams/Zoom/Meet call — so we can transcribe it
// locally with no bot and nothing visible to the other participants.
//
// The magic is setDisplayMediaRequestHandler({ audio: 'loopback' }) (Electron
// 30+). When the web app calls getDisplayMedia (see SystemAudioSource), we hand
// it loopback audio directly — no picker, no screen actually used. On macOS this
// relies on Screen Recording permission (ScreenCaptureKit under the hood).
const { app, BrowserWindow, session, desktopCapturer, shell, ipcMain, screen } = require('electron')
const path = require('path')

let mainWin = null
let overlayWin = null

// Persistent partition for the embedded meeting <webview> (Meet/Zoom/Teams).
// Isolated from the Poyse app session so cookies/logins don't mix, but persistent
// so a Google/Zoom login inside it survives across launches.
const MEETING_PARTITION = 'persist:poyse-meeting'

// Which deployment to load. Defaults to the production app so the desktop shell
// "just works"; point at the Vite dev server for local development.
const APP_URL = process.env.POYSE_URL || 'https://poyse.ai'

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Poyse AI',
    backgroundColor: '#14181d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow <webview> so the live meeting (Meet/Zoom/Teams) can be embedded
      // in-app — an iframe can't (providers send X-Frame-Options), a webview can.
      webviewTag: true,
    },
  })

  // Grant the embedded meeting webview camera/mic so the call actually works.
  const meetingSession = session.fromPartition(MEETING_PARTITION)
  meetingSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))
  meetingSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  // Fulfil getDisplayMedia() with LOOPBACK audio (+ a screen source, required by
  // the API but never used — SystemAudioSource drops the video track).
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
        .catch(() => callback({}))
    },
    { useSystemPicker: false },
  )

  // Auto-approve media permission prompts for our own app (mic + display).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'display-capture')
  })

  mainWin = win
  win.on('closed', () => { if (mainWin === win) mainWin = null })
  win.loadURL(APP_URL)
}

// Granola-style in-call overlay: a small, frameless, always-on-top companion
// window showing ONLY the current suggestion, so it floats over the meeting.
function openOverlay(meetingId) {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.focus()
    return
  }
  const W = 380
  const H = 560
  const area = screen.getPrimaryDisplay().workArea
  overlayWin = new BrowserWindow({
    width: W,
    height: H,
    x: area.x + area.width - W - 24,
    y: area.y + 24,
    frame: false,
    resizable: true,
    minWidth: 300,
    minHeight: 320,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: '#14181d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  // Float above other apps, including a full-screen meeting window.
  overlayWin.setAlwaysOnTop(true, 'screen-saver')
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWin.on('closed', () => { overlayWin = null })
  overlayWin.loadURL(`${APP_URL}/overlay/${meetingId}`)
}

ipcMain.handle('overlay:open', (_e, meetingId) => { openOverlay(String(meetingId)) })
ipcMain.on('overlay:close', () => { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.close() })
ipcMain.on('app:expand', () => {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.close()
  if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus() }
})

// Popups from the embedded meeting (SSO, "open in app" prompts) → open in the
// user's real browser rather than a bare, chromeless Electron window.
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
