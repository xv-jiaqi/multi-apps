# @cardhub/native

Tauri v2 shell that packages the `@cardhub/web` React frontend into native apps for **Desktop (Windows / macOS / Linux) + iOS + Android** from one single project.

## Prerequisites

- Rust toolchain (`rustup` — stable)
- macOS: Xcode (for iOS & macOS builds)
- Android: Android Studio + Android SDK + NDK, `ANDROID_HOME` + `NDK_HOME` set
- Node 22 + pnpm 10 (already set up at repo root)

See the [Tauri v2 prerequisites guide](https://v2.tauri.app/start/prerequisites/) for platform details.

## Commands

Run from anywhere in the repo:

```bash
# Desktop dev (launches web dev server + native window)
pnpm --filter @cardhub/native dev

# Desktop production bundle (.dmg / .msi / .AppImage)
pnpm --filter @cardhub/native build

# First-time mobile init (creates src-tauri/gen/android and src-tauri/gen/apple)
pnpm --filter @cardhub/native android:init
pnpm --filter @cardhub/native ios:init

# Mobile dev (launches emulator / device + web dev server)
pnpm --filter @cardhub/native android:dev
pnpm --filter @cardhub/native ios:dev

# Mobile production bundles (.apk/.aab/.ipa)
pnpm --filter @cardhub/native android:build
pnpm --filter @cardhub/native ios:build
```

## Icons

`tauri.conf.json` expects icons at `src-tauri/icons/` (png 32/128/128@2x, `.icns`, `.ico`). Generate them with:

```bash
pnpm --filter @cardhub/native tauri icon path/to/source.png
```

## Shared frontend

The frontend comes from `../web/dist`; there is no React code inside this directory. To change UI, edit `apps/cardhub/web` — all platforms pick it up automatically.
