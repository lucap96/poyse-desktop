# Poyse AI — Desktop app

Downloads for the Poyse AI desktop app. Grab the latest build from the
[**Releases**](https://github.com/lucap96/poyse-desktop/releases/latest) page:

- **macOS** (Apple Silicon): `Poyse-AI-mac-arm64.dmg` — open, drag to Applications. Unsigned beta: first launch → right-click the app → **Open**.
- **Windows** (x64): `Poyse-AI-win-x64.zip` — unzip, run `Poyse AI.exe`. Unsigned beta: SmartScreen → **More info → Run anyway**.

The app is a thin Electron shell around the Poyse web app; it adds bot-free
system-audio capture, the meeting embedded in-app, and a floating focus-mode
overlay. Product source lives in a separate private repository.

## Releasing

Builds are produced by GitHub Actions (.github/workflows/release.yml) on
GitHub's own runners — Actions -> release -> Run workflow, or push a v* tag.
No local upload of the binaries required.
