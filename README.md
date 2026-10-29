# YapCord for Windows

YapCord is a Vencord-style mod for the Yapper desktop app: plugins, themes and extra
settings on top of the official Yapper client. This guide covers **Windows only** —
how to build YapCord yourself from source, and the two ways to actually get it
running inside Yapper.

## Requirements

- **Node.js** 18 or newer ([nodejs.org](https://nodejs.org)) — this gives you `node` and `npm`.
- **The official Yapper app** already installed (for the "patch Yapper" method below).
- An internet connection the first time you build (npm/electron-builder download their own pieces).

Check Node is installed:

```powershell
node -v
npm -v
```

## 1. Get the source

Download the YapCord source zip (or `git clone` the repo) and extract it.

> **Watch out for double-nested folders.** Windows' "Extract All" sometimes creates
> `YapCord-Windows-main\YapCord-Windows-main\...` instead of just
> `YapCord-Windows-main\...`. If a command below says it can't find `package.json`,
> `cd` one folder deeper and try again.

Open PowerShell or a terminal **inside the extracted folder** (the one that directly
contains `package.json`), then install dependencies once:

```powershell
npm install
```

## 2. Two ways to run YapCord

You don't need both — pick the one that fits what you want.

### Option A — Patch your existing Yapper install (recommended, no .exe needed)

This writes YapCord straight into your already-installed Yapper app. No installer,
no portable .exe, just one command:

```powershell
node tools\yapper-patch.js install
```

It auto-detects your Yapper install folder (usually under
`%LOCALAPPDATA%\Programs\yapper-desktop` or similar). If it can't find it, point it
at the folder yourself:

```powershell
node tools\yapper-patch.js install --dir "C:\Users\<you>\AppData\Local\Programs\yapper-desktop"
```

Restart Yapper afterwards — YapCord is now active inside the real app.

Other commands:

```powershell
node tools\yapper-patch.js status      REM shows whether Yapper is currently patched
node tools\yapper-patch.js uninstall   REM removes YapCord, restores the original Yapper
```

### Option B — Build a YapCord Installer .exe

This produces a standalone `YapCord-Installer-<version>.exe` that does the same
patching as Option A, but through a GUI — handy if you want to install it on another
PC, or hand it to someone else without them touching a terminal.

```powershell
npm run dist:installer
```

When it finishes, you'll find it at:

```
dist\YapCord-Installer-<version>.exe
```

Run that .exe, point it at your Yapper folder if asked, and it patches Yapper for you.

> **One thing to know:** if the folder you extracted YapCord into has a character
> like `(` or `)` in its path (for example `YapCord-Windows-main (1)`, which Windows
> adds automatically when you extract a zip a second time without deleting the
> first copy), this build step will refuse to run and tell you to rename/move the
> folder first. Move it somewhere simple, like `C:\YapCord`, and run the command
> again.

### (Optional) Plain portable .exe, without the installer/patcher

If you'd rather run YapCord as its own separate app window (not inside the official
Yapper app), you can build a portable executable instead:

```powershell
npm run dist
```

Output: `dist\YapCord-<version>-portable.exe`.

## 3. Updating to a new version

Grab the new source, extract it somewhere fresh (don't mix old and new files), run
`npm install` again if `package.json`'s dependencies changed, and repeat whichever
option (A or B) you used before. If you used Option A, re-running
`node tools\yapper-patch.js install` simply overwrites the previous YapCord patch
with the new version.

## Troubleshooting

| Problem | Fix |
|---|---|
| `ENOENT ... Could not read package.json` | You're one folder too deep or too shallow — `cd` into the folder that directly contains `package.json`. |
| `Invalid version: "1.34"` from electron-builder | `package.json`'s `"version"` field needs a full three-part version like `"1.34.0"`, not `"1.34"`. |
| Build script refuses to run because of `(` or `)` in the folder path | Move/rename the folder so its path has no parentheses (ideally no spaces either), then retry. |
| `node tools\yapper-patch.js install` can't find Yapper | Pass `--dir "<your Yapper install folder>"` explicitly. |

## Testing your build (optional, for anyone changing the source)

```powershell
npm test
```

Runs the full automated test suite (syntax, unit tests, Electron smoke tests,
installer/patch smoke tests) before you ship a change.
