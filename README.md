# Aurora Desktop

An animated desktop for Windows, built as a Seelen UI widget with a matching glass shell theme. A luminous atom anchors the interface. A small pointer companion, distant atoms, electron exchanges and reactive lighting make it feel alive while app and folder controls stay still enough to use.

This repository contains the desktop implementation only. It does not replace Windows, include a phone application or connect to an AI model.

## What works

- Atom and Dyson scenes, pointer field effects, electron exchanges and motion controls.
- Optional atom response to Windows playback through Seelen's built-in audio feed, with no additional helper process.
- A vertical folder library and a built-in file workspace with tabs, internal folder navigation, metadata, filters, search, previews, copy/move/rename, folder creation and recoverable Aurora Trash. Direct file access uses the optional local service described below; the original index browser remains available in source.
- Transparent WebGL2 lighting, high-DPI canvases and scalable vector details. The shader requests a high-performance adapter and reports its actual renderer; the request alone does not establish NVIDIA use.
- Clock, month calendar, local tasks and Focus Orbit timer. Focus makes the atoms vibrate; it does not switch Windows Do not disturb on.
- Windows notification history from Seelen, with a bounded scrolling list, fixed controls and a clear edge above the footer. Notification text is rendered as text, never executable HTML.
- System status chips and access to Seelen's existing network, audio, Bluetooth, tray, power and settings panels.
- Native CPU/GPU usage when the host reports it. Missing readings remain unavailable. The portable version selects the first GPU reporting valid usage.
- A matching shell theme with steady dock hit areas, restrained magnification and press feedback. App membership and order remain Seelen's responsibility.
- Optional Open-Meteo current conditions and seven-day forecast, plus an optional read-only Outlook cache adapter. Current conditions have their own timestamp and never borrow the day’s most severe forecast animation.

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

The clock defaults to the public Sydney preset. Configure `timezone` and `clockLabel` together. Weather is **off by default**. To enable it, set `weather.enabled` to `true` and enter the city, latitude and longitude you want. Forecast requests go directly to Open-Meteo without credentials. No location detection or background location permission is used. Current conditions older than 45 minutes, invalid responses and stale cached readings display an unavailable animation instead of pretending to be current. A manual refresh shares the existing 15-minute polling loop; failures retry after 60 seconds. The forecast detail keeps today’s daily outlook separate from Now. Do not put secrets in configuration.

## Install and run

Keep normal Seelen settings accessible while trying a custom desktop. The following commands activate resources; they are not validation-only commands. Use the `slu.exe` supplied by Seelen UI, from the repository root:

```powershell
slu.exe resource load theme .\dist\themes\aurora-glass
slu.exe resource load theme .\dist\themes\aurora-motion
slu.exe resource load widget .\dist\aurora-home
slu.exe resource load widget .\dist\aurora-search
```

In Seelen's theme settings, keep the default theme first, Aurora Glass next and Aurora Motion last. For the intended dock dimensions use item size **44**, padding **6**, margin **10** and item spacing **6**. Keep your own pinned apps. The repository does not ship a personal taskbar configuration. The desktop reserves space for the bottom dock; other dock positions require layout work.

Manual loading is session-oriented. For a persistent local installation, close Seelen normally, copy the built `aurora-home` directory into `%APPDATA%\com.seelen.seelen-ui\widgets\aurora-home`, and copy the two theme directories into `%APPDATA%\com.seelen.seelen-ui\themes\`. Check those destinations first and retain any existing resource you intend to replace. Start Seelen, enable Aurora Home and select the themes in the order above. Seelen's own startup setting controls whether it runs at sign-in. No install script or startup task is run by this project.

Native actions use Seelen's normal permission handling. Approve only the actions you intend to use. Quick controls retains access to Seelen settings. **Hide Aurora** only hides the window. Use Seelen's widget controls to show it again.

Aurora Search opens with **Ctrl+Alt+Space** from other applications, or with the search button, **Ctrl+K** or **/** inside Aurora. Arrow keys select results, Enter opens them, Ctrl+Enter reveals files in Explorer, and Escape closes the panel. The shortcut belongs to the Search widget and can be changed in Seelen's shortcuts settings. For persistence, also copy `dist/aurora-search` into Seelen's `widgets/aurora-search` directory. Search is a separate floating window; its first app or file launch may show Seelen's normal permission prompt.

Search combines installed Start Menu apps, known folders, Seelen's indexed files, Aurora commands and Windows settings. Filters and `apps:`, `files:`, `folders:`, `>` and `web:` prefixes narrow the results. File coverage is the filtered user-folder index (up to five levels deep) plus Recent, and excludes some files and empty folders. An explicit Windows Search result uses Windows' own index for additional locations. Web searches open only when selected. Typing stays local; queries and filename history are not saved. Refresh requests updated host indexes. The native startup diagnostic contains counts, source status and window geometry only.

The atom's small speech bubble reports actual Aurora activity: app opening, focus sessions, file indexing and weather refreshes. Brief notices fade away; its status button recalls the last update. Messages stay in memory, and motion follows the desktop setting. Search app results are labelled **Installed app**, including packaged Windows apps, and open their installed Start menu targets.

The AI presence surface adds a labelled core state, an activity bubble, a five-entry in-memory feed and a local draft composer. Its shape and motion follow the desktop's full/reduced/off setting and the operating system's reduced-motion preference. The composer opens the existing draft editor for review; it does not send a message.

An optional producer can write `assistant-presence.json` in the widget's Seelen data directory. Schema version 1 requires `id`, `source: "Codex"`, `state` (`idle`, `working` or `error`), `message`, and numeric millisecond `observedAt`/`expiresAt` values with a maximum 60-second lifetime. Aurora polls this one status file while visible and drops expired updates. This is a local status connection, not a subscription to Codex chat or voice. The included reader never opens a microphone or reads conversation history. A future voice-session adapter can supply short-lived explicit voice events to the presence module. Windows playback remains labelled **Audio playing**, since it can include any app.

## Colour themes

Use **Theme** in the top-right corner to choose **Solar Gold**, **Arctic Blue**, **Violet Night**, **Evergreen** or **Porcelain**. Solar Gold is the default and keeps Aurora's existing gold finish. Porcelain is the light option.

Your choice is saved on this PC and restored when Aurora opens. It coordinates Home, the existing Aurora Motion dock and the notification companion when installed, without restarting Seelen. Apps, layout and motion settings stay as you set them. Seelen may request configuration permission for the first dock colour change. If the dock cannot update, the selector reports it while keeping your chosen desktop colours.

## Remove or return to the previous desktop

Disable Aurora Home in Seelen settings and deselect Aurora Motion and Aurora Glass. Your applications and files stay in place. For manually loaded resources, unload the same paths used above:

```powershell
slu.exe resource unload widget .\dist\aurora-home
slu.exe resource unload widget .\dist\aurora-search
slu.exe resource unload theme .\dist\themes\aurora-motion
slu.exe resource unload theme .\dist\themes\aurora-glass
```

For a persistent installation, close Seelen normally before removing only the resource directories you copied. Keep any independently installed Aurora Glass theme. Local tasks and preferences live in the widget's browser storage; unloading is not a data-erasure command. Restore any dock dimension or toolbar changes separately if you made them manually.

## Connections and limits

### Built-in Aurora Files

`scripts/file-service.mjs --config <private-config.json>` starts the file connection on `127.0.0.1:18765`. It requires a private bearer token, an explicit root list and writable roots. The service only accepts the native Tauri origins and the local browser QA origin. Do not publish the token or the private configuration. The optional `AURORA_EXPLORER_CLIENT_CONFIG` build variable points to a separate local JSON file containing `baseUrl` and `token`; generated bundles and private files stay outside the publication source.

GPU temperature can use the same authenticated service with `gpuTelemetry: {"enabled": true, "uuid": "<verified NVIDIA GPU UUID>"}` in its private server configuration. Keep `scripts/gpu-telemetry.mjs` beside `file-service.mjs`. The fixed `/gpu-temperature` read accepts no command or query parameters. It calls the existing Windows `nvidia-smi.exe`, checks the returned UUID, times out after three seconds and coalesces requests within five seconds. Aurora requests temperature every 15 seconds while visible. Failed reads retain the last real reading with a stale label; unsupported temperatures remain unavailable. It does not install a sensor driver, start another listener, change clocks or provide CPU temperature. NVIDIA recommends UUID or PCI bus identity because adapter enumeration can change between reboots. [NVIDIA documentation](https://docs.nvidia.com/deploy/nvidia-smi/index.html#selective-query-options)

The explorer reads real folders, including empty directories and Windows hidden attributes. It provides eight tabs, Back/Forward/Up, an editable address, grid/list views, sorting, type filters, multi-selection, an inspector and keyboard shortcuts. File operations display exact paths for review and stop at conflicts without replacing existing files. Supported image previews preserve alpha; SVGs are displayed only as images. Text is rendered as text. Images are limited to 8 MB, text reads to 512 KB, searches to 20,000 visited entries and 500 results, and copies to 10,000 entries or 2 GB. File contents are not uploaded or cached by the service.

An optional `trashRoot` enables **Aurora Trash**, which is separate from the Windows Recycle Bin. Items move there on the same drive and can be restored to their original location. An existing destination blocks restoration. There is no permanent-delete or empty-Trash action. Cross-drive moves and Trash moves are unavailable; copying can be used between writable drives. Symlinks, junctions, credential previews and private application bulk searches are excluded.

The AI tools create reviewable local drafts from selected metadata or explicitly loaded text, compare actual file details and propose labelled file-type organisation rules. They do not claim semantic search or model analysis without a model connection, and no organisation plan runs before confirmation. Folder browsing stays inside Aurora; opening a document uses its associated app.

The shader composes transparent gold and silver light over the existing scene, follows measured playback energy and respects reduced/off motion, pause, visibility and context loss. Render buffers are bounded, adapt to slow frames and retain the current UI when GPU effects are unavailable.

Clicking the atom opens `https://chatgpt.com/` by default. The optional local draft editor does not send a prompt or start voice. Copy the draft yourself before opening ChatGPT. A local configuration can change the launch URL, but no personal chat URL is distributed here.

Playback response is **off by default**. Set `audio.enabled` to `true` in your local configuration, rebuild and reload to opt in. It uses Seelen's native feed from the default Windows multimedia output device. That includes sound from any application routed through that device, not just ChatGPT or a selected process. Applications routed to a different output may not appear. This feature does not start voice or access the microphone.

In Full motion, playback drives a luminous speaking sphere with a smooth, perceptual response capped at 85% expansion of the circular nucleus. Curved surface lines, small points of light and three soft circular waves follow the playback envelope. Their motion advances only during fresh sound, then fades back to the existing idle appearance. The centre, orbital paths and click target stay fixed. Reduced motion uses glow feedback without expansion or moving surface effects; Off disables the response. Pausing removes the speech layer without leaving another animation loop running.

Aurora converts the transient playback samples into an amplitude value in memory. It does not record audio, retain sample history, write audio to disk or upload it. No extra executable, server or API account is used. Motion off, pause and hidden states stop the visual response and client activity; reduced motion keeps a restrained response. **The first enabled native getter starts Seelen's playback capture. Seelen exposes no stop command for this feed, so host capture can continue after Aurora is paused, disabled or unloaded until Seelen is restarted.** To stop that host capture, disable the option, rebuild and restart Seelen normally. Default-off initialisation makes no audio getter or subscription call.

Playback integration is experimental. Its API wiring has been checked against Seelen 2.8.10 source and tested with simulated events. Live playback delivery and return to zero were also verified on one Windows installation running Seelen 2.8.10; other devices and host versions still need testing. Seelen can repeat its last waveform after sound stops, so Aurora treats an unchanged nonzero waveform lasting two seconds as idle. Only a bounded fingerprint is retained for that check. An exactly repeating sustained tone can also become idle; the feed does not supply a producer timestamp to distinguish those cases.

The Outlook adapter is off by default. Enabling `calendar.enabled` reads a schema-version-1 `outlook-calendar.json` file in the widget's Seelen data directory. An authorised external process must maintain that cache. This project contains no account credentials, calendar data, synchronisation job, event writer, booking reminders or phone notifications. Its parser and freshness handling are in `src/outlook/outlook-calendar.mjs`.

Notification access depends on Windows and Seelen. An empty native feed cannot prove permission was granted, so the interface says access is unverified. The history view shows at most 200 notifications and offers the native notification panel for additional controls. No dismissal or clear-all operation is implemented here.

The original index browser can miss unindexed files or empty folders. The optional local file service reads configured folders directly; File Explorer remains available as a fallback. NVIDIA GPU temperature requires the existing vendor interface and the explicit service configuration described above. CPU temperature remains unavailable. Playback response is optional and depends on Seelen's native feed; it is not a per-assistant voice meter. The clock, local tasks and visual effects work without those connections. The project does not restyle every native Windows dialogue or animate external application windows.

Motion respects the interface's full/reduced/off settings. GPU acceleration is requested from the host, but no frame-rate guarantee is made. Browser visibility is not a complete native window-occlusion signal, so a covering application may not pause every effect. Keep Windows and Seelen recovery controls available.

The Sun's actual painted position and radius drive warm light on glass surfaces, source-facing rims and shadows in the opposite direction. During a live notification, the desktop uses the actual topmost carrier position until the Sun returns. Off and reduced modes keep a static light; hidden states suspend it. Playback is labelled as PC audio. A voice state requires a fresh, explicitly linked voice-session update.

The Frequently used panel beside Weather refreshes every minute. It ranks installed apps by observed foreground time while Aurora runs. Website counts cover successful Aurora launches only, not general browser activity. The fixed local `frequent-usage.json` contains bounded app identifiers, installed app labels, hostnames and aggregate counters. It contains no window titles, document names, full URLs, queries or message contents. Tracking can be paused and rankings cleared from the panel. Entries unused for 90 days expire. Launches resolve from the current installed-app catalogue or a recorded HTTPS hostname; supplied row paths are never executed.

Windows notifications from WhatsApp and other apps share the same source-neutral arrival feed. Aurora does not connect directly to social accounts or send messages. Delivery depends on the source app, Windows and Seelen notification settings.

The existing notification companion supports an optional local priority list. Build it with `scripts/build-notification-overlay.mjs --priority-config <local-json>` where the JSON contains `schema_version: 1` and an `appIds` array of exact Windows sender identities. No apps are prioritised by default. Selected senders move ahead of ordinary cards and can appear in Windows' `PriorityOnly` mode. An explicit `priorityDuringDnd: true` in the local JSON also permits only those selected senders through `AlarmsOnly`; the default is false. Active Windows Focus sessions, unknown quiet state and paused alerts still suppress them. Windows modes and schedules remain unchanged. This is an Aurora preference, not a live copy of Windows' per-app exception list. Configure Windows app permissions separately. Display names and notification text cannot grant priority, and a website sender does not grant priority to its whole browser. Popups remain local, use the existing atom journey, and never replay suppressed history when quiet mode ends.

To assign popup ownership, the local JSON can include `popupAppIds`, an array of exact sender identities. In normal and priority-only modes, Aurora only displays popups for these senders; other senders keep their Windows popup surface and remain in Aurora history. Omit the field to retain the default all-source popup behaviour. Configure native Windows banners separately for senders owned by Aurora. The explicitly enabled alarms-only exception can still admit the selected priority senders, because Windows suppresses its ordinary banners in that mode. Unknown states and active Focus sessions remain quiet.

For Chrome websites, the same local JSON can include `sites: [{"appId":"Chrome","origin":"https://www.example.com"}]`. Aurora validates Chrome's root notification launch metadata against the exact sender and HTTPS origin before granting priority. This parser follows the installed Chrome 156 launch format. Other origins, private browsing, missing metadata and unrecognised formats do not receive priority. Seelen can fall back to plain text without launch metadata, so this rule needs installed delivery verification and is not a guarantee for every Chrome notification. It does not inspect web pages, messages or browser credentials, and it does not change browser permissions or background policies.

## Source map and validation

`src/fragments/` contains the original code-rendered scene, calendar and interaction surfaces. `src/native-bridge.mjs` adapts them to Seelen; the separate modules handle notifications, indexed files, system controls, lighting, window motion, weather and the optional calendar cache. `scripts/build.mjs` assembles and bundles the widget. `themes/aurora-glass/` contains the required upstream theme source; `themes/aurora-motion/` contains the custom overlay.

`npm test` uses synthetic, local fixtures for notification parsing and bounds, native command contracts, file shortcuts, animation lifecycle and configuration. It makes no native UI calls or account reads. These tests do not replace visual testing in Seelen, particularly at different display scaling and monitor sizes. `SOURCE-MANIFEST.txt` lists the publication source files. Generated resources, private configuration, caches, logs and dependencies are excluded from Git.

Licensed under **AGPL-3.0-only**. Upstream licences and credits are retained in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), `licenses/` and the base theme directory. Seelen, Windows and OpenAI names identify compatibility and do not imply endorsement.
