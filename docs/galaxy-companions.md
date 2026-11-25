# Galaxy Atlas companion widgets

`scripts/build-galaxy-companions.mjs` builds two independent Seelen widgets:

| Widget | Runtime ID | Output folder |
| --- | --- | --- |
| Notifications | `@galaxy-atlas/notifications` | `galaxy-notifications` |
| Search | `@galaxy-atlas/search` | `galaxy-search` |

Both target the desktop `@galaxy-atlas/desktop`. The builder rewrites maintained source event names from `aurora:` to `galaxy-atlas:` across every bundled module. Native Seelen and Tauri event names remain unchanged. Existing `customArgs.auroraCommand` command payloads remain compatible with the desktop router.

## Build

Run from this project with Node 22 and the pinned dependencies installed:

```powershell
node scripts/build-galaxy-companions.mjs --output "C:\path\to\stage\widgets" --private-config "C:\path\outside\the\repository\companion-profile.json"
```

The private configuration is a schema version 1 object with `notifications`, `search`, and optional `locale`. Notification fields are `priorityAppIds`, `prioritySites`, `priorityDuringDnd`, and `popupAppIds`. Search fields are `knownRoots`, `categories`, `chatgptUrl`, and optional `verificationApps`. Locale fields are `timezone` and `clockLabel`. Use the existing approved local configuration. Do not substitute defaults during migration or commit this file.

Each widget contains `metadata.yml`, `index.html`, `index.css`, `index.js`, and a SHA-256 build manifest. `galaxy-companions-build.json` contains identities, file hashes, and the private configuration hash. It excludes private configuration values. The build does not install widgets or change native notification settings.

## Native contracts

Both widgets register an early `internal::liveness-ping` listener and reply to their exact webview label with `internal::liveness-pong`. They release the listener on pagehide, including late registration completion.

Notifications initially reads native history as a baseline. Only subsequent eligible notifications create actual cards. Native quiet state, approved ownership/priority rules, activation, local dismissal, history, two-card stacking, and bounded queue handling remain in `aurora-notifications.mjs`.

The star presentation is finite and decorative. Four staggered stars descend within at most 158 CSS pixels of temporary headroom, converge, and reveal the same native card DOM. Reduced, off, paused, and OS reduced motion immediately settle the real cards. Keyboard focus also settles any pending card. No idle star render loop runs.

The native window remains bottom-right and bounded to its monitor work area. The supported global mouse feed and a fresh pointer read map physical native coordinates to actual revealed card rectangles. The entire window passes input through over transparent headroom and gutters. A card becomes interactive after revealing. No foreground or focus request is made by notification arrival.

The desktop answers `galaxy-atlas:notification-presence-request` with `galaxy-atlas:notification-presence-source`. The response must contain matching `id`, matching `homeWidgetId`, physical `monitor` geometry with `scaleFactor`, `paletteId`, `motion`, and `frame:null`. This presentation does not require an atom screenshot or desktop ownership. Its `away:false` state message may be acknowledged without changing the desktop. Palette changes use `galaxy-atlas:palette-state` scoped by `homeWidgetId`.

Search is lazy and opens through its own `galaxy-atlas-search` shortcut, with Ctrl+Alt+Space as the default. Activity messages include both `homeWidgetId` and `sourceWidgetId`. App indexing does not launch apps. Explicit selection retains the existing native app/file/command launch and reveal routes.

Diagnostic filenames are `galaxy-atlas-notifications-startup.json` and `galaxy-atlas-search-startup.json`, written through the existing Seelen `WriteFile` API. Notification diagnostics contain numeric/enum state and geometry, never notification text or pointer coordinates.

## Verification

The relevant maintained tests are `verify-notifications.mjs`, `verify-notification-stars.mjs`, `verify-notification-overlay.mjs`, `verify-notification-priority.mjs`, `verify-notification-palette.mjs`, `verify-notification-sites.mjs`, `verify-search-provider.mjs`, `verify-spotlight-ui.mjs`, and `verify-search-integration.mjs` under `tests/`.

`verify-notification-journey.mjs` tests the current native-window orchestration with a finite presentation adapter: bounded star headroom, fixed card anchoring, pointer pass-through, metadata handoff, palette races, quiet cancellation, reduced motion, native visibility readbacks, scoped watchdog and cleanup. Its retained legacy bridge checks also cover ownership lease recovery. Browser integration verifies actual stars and real card identity, phases, stack continuity, keyboard focus and explicit native command routing. Actual Windows stacking, click-through delivery, OS notification arrival, and watchdog continuity still require a native smoke test after installation.
