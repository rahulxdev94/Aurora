# Aurora Desktop

An animated desktop for Windows, built as a Seelen UI widget with a matching glass shell theme. A luminous atom anchors the interface. A small pointer companion, distant atoms, electron exchanges and reactive lighting make it feel alive while app and folder controls stay still enough to use.

This repository contains the desktop implementation only. It does not replace Windows, include a phone application or connect to an AI model.

## What works

- Atom and Dyson scenes, pointer field effects, electron exchanges and motion controls.
- A vertical folder library, read-only indexed file browser, search and explicit opening in File Explorer. The C: shortcut opens Explorer without scanning the whole drive.
- Clock, month calendar, local tasks and Focus Orbit timer. Focus makes the atoms vibrate; it does not switch Windows Do not disturb on.
- Windows notification history from Seelen, with a bounded scrolling list, fixed controls and a clear edge above the footer. Notification text is rendered as text, never executable HTML.
- System status chips and access to Seelen's existing network, audio, Bluetooth, tray, power and settings panels.
- Native CPU/GPU usage when the host reports it. Missing readings remain unavailable. The portable version selects the first GPU reporting valid usage.
- A matching shell theme with steady dock hit areas, restrained magnification and press feedback. App membership and order remain Seelen's responsibility.
- Optional seven-day Open-Meteo forecast and an optional read-only Outlook cache adapter.

## Requirements and build

Target: Windows 10/11, Seelen UI **2.8.10**, its supported WebView2 runtime, and Node.js **22 or newer**. The complete layout targets logical viewports of at least **1024 × 720**. Only one desktop instance is configured; multiple monitors and newer host versions need separate testing.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run check:source
npm run build
```

The lockfile pins the dependencies. Build outputs go to `dist/` and temporary compiler input to `.build/`. Building does not install, activate or change the Windows desktop. Rebuilding with the same configuration and dependencies produces the same resource files. Local folder paths are compiled for the machine doing the build, so build again on the target PC.

Copy `config.example.json` to `config.local.json` if you need custom settings. The local file is ignored by Git. Desktop, Documents, Pictures, Music, Videos and Downloads default to `%USERPROFILE%` subfolders. For OneDrive or redirected folders, set the corresponding `roots` entries explicitly, for example `"Desktop": "%USERPROFILE%\\OneDrive\\Desktop"`. Aurora does not create, move or rename category folders. Default categories are Work, Personal, Finance, Projects, Media, Documents, Apps and Archives.

The clock defaults to the public Sydney preset. Configure `timezone` and `clockLabel` together. Weather is **off by default**. To enable it, set `weather.enabled` to `true` and enter the city, latitude and longitude you want. Forecast requests go directly to Open-Meteo without credentials. No location detection or background location permission is used. Do not put secrets in configuration.

## Install and run

Keep normal Seelen settings accessible while trying a custom desktop. The following commands activate resources; they are not validation-only commands. Use the `slu.exe` supplied by Seelen UI, from the repository root:

```powershell
slu.exe resource load theme .\dist\themes\aurora-glass
slu.exe resource load theme .\dist\themes\aurora-motion
slu.exe resource load widget .\dist\aurora-home
```

In Seelen's theme settings, keep the default theme first, Aurora Glass next and Aurora Motion last. For the intended dock dimensions use item size **44**, padding **6**, margin **10** and item spacing **6**. Keep your own pinned apps. The repository does not ship a personal taskbar configuration. The desktop reserves space for the bottom dock; other dock positions require layout work.

Manual loading is session-oriented. For a persistent local installation, close Seelen normally, copy the built `aurora-home` directory into `%APPDATA%\com.seelen.seelen-ui\widgets\aurora-home`, and copy the two theme directories into `%APPDATA%\com.seelen.seelen-ui\themes\`. Check those destinations first and retain any existing resource you intend to replace. Start Seelen, enable Aurora Home and select the themes in the order above. Seelen's own startup setting controls whether it runs at sign-in. No install script or startup task is run by this project.

Native actions use Seelen's normal permission handling. Approve only the actions you intend to use. Quick controls retains access to Seelen settings. **Hide Aurora** only hides the window. Use Seelen's widget controls to show it again.

## Remove or return to the previous desktop

Disable Aurora Home in Seelen settings and deselect Aurora Motion and Aurora Glass. Your applications and files stay in place. For manually loaded resources, unload the same paths used above:

```powershell
slu.exe resource unload widget .\dist\aurora-home
slu.exe resource unload theme .\dist\themes\aurora-motion
slu.exe resource unload theme .\dist\themes\aurora-glass
```

For a persistent installation, close Seelen normally before removing only the resource directories you copied. Keep any independently installed Aurora Glass theme. Local tasks and preferences live in the widget's browser storage; unloading is not a data-erasure command. Restore any dock dimension or toolbar changes separately if you made them manually.

## Connections and limits

Clicking the atom opens `https://chatgpt.com/` by default. The optional local draft editor does not send a prompt or start voice. Copy the draft yourself before opening ChatGPT. A local configuration can change the launch URL, but no personal chat URL is distributed here.

The Outlook adapter is off by default. Enabling `calendar.enabled` reads a schema-version-1 `outlook-calendar.json` file in the widget's Seelen data directory. An authorised external process must maintain that cache. This project contains no account credentials, calendar data, synchronisation job, event writer, booking reminders or phone notifications. Its parser and freshness handling are in `src/outlook/outlook-calendar.mjs`.

Notification access depends on Windows and Seelen. An empty native feed cannot prove permission was granted, so the interface says access is unverified. The history view shows at most 200 notifications and offers the native notification panel for additional controls. No dismissal or clear-all operation is implemented here.

The file browser uses Seelen's index, so it may miss unindexed files or empty folders. File Explorer remains the complete fallback. CPU/GPU temperatures and assistant-playback metering need additional components and are not connected in this repository. The clock, local tasks and visual effects work without those components. The project does not restyle every native Windows dialogue or animate external application windows.

Motion respects the interface's full/reduced/off settings. GPU acceleration is requested from the host, but no frame-rate guarantee is made. Browser visibility is not a complete native window-occlusion signal, so a covering application may not pause every effect. Keep Windows and Seelen recovery controls available.

## Source map and validation

`src/fragments/` contains the original code-rendered scene, calendar and interaction surfaces. `src/native-bridge.mjs` adapts them to Seelen; the separate modules handle notifications, indexed files, system controls, lighting, window motion, weather and the optional calendar cache. `scripts/build.mjs` assembles and bundles the widget. `themes/aurora-glass/` contains the required upstream theme source; `themes/aurora-motion/` contains the custom overlay.

`npm test` uses synthetic, local fixtures for notification parsing and bounds, native command contracts, file shortcuts, animation lifecycle and configuration. It makes no native UI calls or account reads. These tests do not replace visual testing in Seelen, particularly at different display scaling and monitor sizes. `SOURCE-MANIFEST.txt` lists the publication source files. Generated resources, private configuration, caches, logs and dependencies are excluded from Git.

Licensed under **AGPL-3.0-only**. Upstream licences and credits are retained in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), `licenses/` and the base theme directory. Seelen, Windows and OpenAI names identify compatibility and do not imply endorsement.
