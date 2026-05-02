# @cardhub/native

Tauri v2 shell that wraps the [`@cardhub/web`](../web) React frontend into native apps for **Desktop (Windows / macOS / Linux) + iOS + Android** out of one cargo workspace.

The frontend lives in `apps/cardhub/web` — there is **no React code in this directory**. Editing UI? Change web; every platform picks it up automatically.

---

## Per-OS prerequisites

### Common (all platforms)

- Node 22 + pnpm 10 (already installed at the repo root)
- Rust toolchain — install [rustup](https://rustup.rs):
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  rustup default stable
  ```

### macOS desktop

- Xcode Command Line Tools: `xcode-select --install`
- WebKit comes with the OS — no extra package.

### Windows desktop

- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (the "Desktop development with C++" workload).
- WebView2 Runtime — preinstalled on Windows 11; on Windows 10 download the [Evergreen Bootstrapper](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

### Linux desktop

- Required GTK / WebKitGTK system packages. On Debian/Ubuntu:
  ```bash
  sudo apt update
  sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```
  Fedora/Arch/openSUSE see <https://v2.tauri.app/start/prerequisites/#linux>.

### iOS (mobile)

- macOS only.
- Xcode 15+ and the iOS 17 SDK (open Xcode once and accept the licence so `xcrun` works).
- iOS rust targets: `rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim`.

### Android (mobile)

- Android Studio (any OS).
- JDK 17+: `brew install --cask temurin@17` on macOS.
- Android SDK + NDK r25+ via Android Studio's SDK Manager.
- Environment variables:
  ```bash
  export ANDROID_HOME="$HOME/Library/Android/sdk"        # macOS default
  export NDK_HOME="$ANDROID_HOME/ndk/<version>"
  export PATH="$ANDROID_HOME/platform-tools:$PATH"
  ```
- Android rust targets: `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`.

See the [Tauri v2 prerequisites guide](https://v2.tauri.app/start/prerequisites/) for the canonical reference.

---

## Commands

Run from anywhere in the repo (turbo handles the working directory).

### Desktop

```bash
# Dev — launches `pnpm --filter @cardhub/web dev` then the native window.
pnpm --filter @cardhub/native dev

# Production bundle — outputs to src-tauri/target/release/bundle/
#   macOS  -> .dmg + .app
#   Windows -> .msi + .exe
#   Linux  -> .AppImage + .deb
pnpm --filter @cardhub/native build

# Just the Rust side (debug-only smoke test, skips bundling)
pnpm --filter @cardhub/native exec tauri build --debug --no-bundle
```

### Mobile (M4)

```bash
# First-time init — creates src-tauri/gen/{android,apple}. The Android one
# requires ANDROID_HOME + NDK_HOME; the iOS one requires Xcode + accepted
# Apple licence. Both are interactive on first run.
pnpm --filter @cardhub/native android:init
pnpm --filter @cardhub/native ios:init

# Dev (launches simulator / connected device)
pnpm --filter @cardhub/native android:dev
pnpm --filter @cardhub/native ios:dev

# Release bundles (.apk / .aab / .ipa)
pnpm --filter @cardhub/native android:build
pnpm --filter @cardhub/native ios:build
```

If `ios:init` / `android:init` fails because of toolchain gaps, see [`MOBILE_SETUP.md`](./MOBILE_SETUP.md) for OS-specific install steps.

---

## Icons

`tauri.conf.json` references icons at `src-tauri/icons/` (32/64/128 px PNG, `icon.icns`, `icon.ico`, plus iOS/Android variants in subdirs).

The current set is generated from `src-tauri/icons/source.png` (1024×1024 placeholder — a white "C" on an indigo→fuchsia gradient). To regenerate after replacing the source:

```bash
# 1. Drop a new 1024x1024 PNG in src-tauri/icons/source.png. To rebuild the
#    placeholder programmatically, run:
python3 apps/cardhub/native/src-tauri/icons/generate-source.py

# 2. Fan out to every platform asset.
pnpm --filter @cardhub/native exec tauri icon apps/cardhub/native/src-tauri/icons/source.png
```

> **TODO** — replace `source.png` with the real Cardhub brand asset before App Store / Play Store submission.

---

## Runtime API URL

The Tauri WebView loads the same web bundle as the browser. URL routing happens in [`apps/cardhub/web/src/lib/trpc.tsx`](../web/src/lib/trpc.tsx) (`resolveTrpcUrl`):

| Runtime                    | URL                                                                 |
| -------------------------- | ------------------------------------------------------------------- |
| Tauri Desktop dev          | `VITE_TRPC_URL_TAURI` (defaults to `http://localhost:4000/trpc`)    |
| Tauri Desktop production   | `VITE_TRPC_URL_TAURI` (set per `.env.production` to the Render URL) |
| Tauri Android emulator dev | `http://10.0.2.2:4000/trpc` (auto-detected from UA)                 |
| Tauri iOS simulator        | inherits the Desktop URL — simulator shares host network            |
| Real device                | always `VITE_TRPC_URL_TAURI` (must be HTTPS)                        |

The API server side already permits the Tauri custom protocol origins via `CORS_ORIGIN` (`tauri://localhost,https://tauri.localhost`) — see [`apps/cardhub/api/.env.example`](../api/.env.example).

---

## Troubleshooting

- **"command not found: tauri"** — never invoke `tauri` directly; always use the workspace script `pnpm --filter @cardhub/native exec tauri ...` or one of the npm scripts above.
- **Rust target missing on iOS / Android** — re-run the `rustup target add ...` commands in the prerequisites section.
- **macOS GUI permission prompts** — first `pnpm --filter @cardhub/native dev` will trigger a "<App> wants to use the network" dialog. Accept once.
- **Windows AV false positive** — Tauri-built `.exe` files sometimes trip Windows Defender heuristics. Sign the binary in CI for releases.
