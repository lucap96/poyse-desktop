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
const { app, BrowserWindow, session, desktopCapturer, shell, ipcMain, screen, Notification, Tray, Menu, nativeImage } = require('electron')
const path = require('path')

app.setName('Poyse AI')

let mainWin = null
let overlayWin = null
let tray = null
// Set true only when the user really wants to quit (tray → Quit); otherwise
// closing the window just hides it so Poyse keeps watching for meetings.
app.isQuitting = false

// --- Granola-style meeting auto-detect ---------------------------------------
// Poll open window titles for an in-progress call (Zoom/Meet/Teams). When one
// starts, surface Poyse on the live-meeting page so the operator can start the
// copilot without hunting for the app. Uses desktopCapturer window names, which
// need the Screen Recording permission we already require for system audio.
let meetingActive = false
let watchTimer = null
const MEETING_WINDOW_PATTERNS = [
  /zoom meeting/i,                 // Zoom's in-call window (the idle app window is just "Zoom")
  /google meet|meet\s*[–-]\s/i,    // Google Meet call tab
  /teams meeting|microsoft teams.*\bmeeting\b/i, // Teams call (best-effort)
]

async function detectMeeting() {
  let sources
  try {
    sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
  } catch {
    return // no Screen Recording permission yet, or transient failure
  }
  const inMeeting = sources.some((s) => MEETING_WINDOW_PATTERNS.some((re) => re.test(s.name || '')))
  if (inMeeting && !meetingActive) {
    meetingActive = true
    onMeetingStarted()
  } else if (!inMeeting && meetingActive) {
    meetingActive = false
  }
}

function onMeetingStarted() {
  if (!mainWin || mainWin.isDestroyed()) createWindow()
  mainWin.show()
  mainWin.focus()
  mainWin.loadURL(`${APP_URL}/meeting`)
  try {
    const n = new Notification({ title: 'Poyse AI', body: 'Meeting detected — open your copilot.' })
    n.on('click', () => { mainWin?.show(); mainWin?.focus() })
    n.show()
  } catch { /* notifications optional */ }
}

function startMeetingWatch() {
  if (watchTimer) return
  void detectMeeting()
  watchTimer = setInterval(() => void detectMeeting(), 7000)
}

// --- Tray / menubar + start-at-login -----------------------------------------
function showMainWindow() {
  if (!mainWin || mainWin.isDestroyed()) createWindow()
  mainWin.show()
  mainWin.focus()
}
function isOpenAtLogin() {
  try { return app.getLoginItemSettings().openAtLogin } catch { return false }
}
function setOpenAtLogin(v) {
  try { app.setLoginItemSettings({ openAtLogin: v, openAsHidden: true }) } catch { /* ignore */ }
  refreshTrayMenu()
}
function refreshTrayMenu() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Poyse AI', click: showMainWindow },
    { type: 'checkbox', label: 'Start at login', checked: isOpenAtLogin(), click: (item) => setOpenAtLogin(item.checked) },
    { type: 'separator' },
    { label: 'Quit Poyse AI', click: () => { app.isQuitting = true; app.quit() } },
  ]))
}
function createTray() {
  if (tray) return
  let img = nativeImage.createFromPath(path.join(__dirname, 'tray.png'))
  if (process.platform === 'darwin' && !img.isEmpty()) img = img.resize({ width: 18, height: 18 })
  tray = new Tray(img)
  tray.setToolTip('Poyse AI')
  tray.on('click', showMainWindow)
  refreshTrayMenu()
}

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
  // Closing the window hides it (keep running in the tray + meeting watcher);
  // only a real Quit (tray → Quit) actually closes it.
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide() }
  })
  win.on('closed', () => { if (mainWin === win) mainWin = null })
  win.loadURL(`${APP_URL}/signin`)
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
  const launchedAtLogin = (() => { try { return app.getLoginItemSettings().wasOpenedAtLogin } catch { return false } })()
  createTray()
  // Start-at-login ON by default (Granola-style always-on background watcher).
  // First run only; the user can turn it off from the tray. `hasEnabledLogin`
  // guards so we don't re-enable it after they've explicitly disabled it.
  try {
    if (!isOpenAtLogin() && !app.getLoginItemSettings().wasOpenedAtLogin) {
      const flag = require('node:path').join(app.getPath('userData'), '.login-init')
      const fs = require('node:fs')
      if (!fs.existsSync(flag)) { setOpenAtLogin(true); fs.writeFileSync(flag, '1') }
    }
  } catch { /* ignore */ }
  createWindow()
  // If macOS auto-started us at login, stay in the background (tray only).
  if (launchedAtLogin && mainWin) mainWin.hide()
  startMeetingWatch()
  app.on('activate', () => { showMainWindow() })
})

// Keep running in the tray when the window is closed/hidden. Real exit is via
// the tray's Quit (which sets app.isQuitting and calls app.quit()).
app.on('window-all-closed', () => {
  // no-op: the tray keeps Poyse alive to watch for meetings
})
