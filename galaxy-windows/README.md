# Galaxy Atlas for Windows

This snapshot includes the maintained Galaxy Atlas desktop, its launcher and the motion companion with public media feeds. The parent project contains Aurora, the source for the Search and Notifications widgets and the Galaxy Atlas dock theme. The styles in `installed-styles` capture the appearance installed on 26 November 2026. The maintained desktop and motion sources also include later staged changes.

## Build the desktop

In `desktop`, run `npm ci`, then `npm run build`. The resulting Seelen widget is in `desktop/dist`. The build uses the repository's example configuration. To apply your own configuration, set `GALAXY_DESKTOP_CONFIG` to your local JSON file before building. The voice demo uses a synthetic reading of the demo text.

In Windows PowerShell, run `launcher/Build-GalaxyAtlasLauncher.ps1` to build the desktop launcher and `motion/build.ps1` to build the motion companion. The launcher expects Seelen UI with the Galaxy Atlas desktop widget already installed. Both build scripts only compile their target. Desktop widget configuration, app data and calendar caches are supplied by the user on their PC.
