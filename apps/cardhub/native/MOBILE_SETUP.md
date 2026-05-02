# Cardhub Mobile (Tauri iOS / Android) — Setup Guide

The Tauri shell at `apps/cardhub/native` is one Cargo workspace that targets six runtimes (Win/macOS/Linux desktop + iOS + Android + WebView). Mobile targets need extra toolchains the desktop build does not. This file documents the bootstrap step-by-step.

> **The `gen/` subdirectory is gitignored.** Every fresh checkout must run `tauri ios init` / `tauri android init` once before mobile dev / build commands work. iOS init takes ~30 s, Android init takes ~3 min on a fast SSD.

---

## iOS — macOS only

### Prerequisites

| Tool                       | Install                                                                      |
| -------------------------- | ---------------------------------------------------------------------------- |
| Xcode 15+ + iOS 17 SDK     | Mac App Store; **open it once** to accept the licence                        |
| Xcode Command-Line Tools   | `xcode-select --install`                                                     |
| `xcodegen`                 | `brew install xcodegen` (Tauri uses it to emit the .xcodeproj)               |
| Cocoapods                  | `brew install cocoapods` (or `sudo gem install cocoapods`)                   |
| iOS rust targets           | `rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim` |
| `idevicesyslog` (optional) | `brew install libimobiledevice` — needed for real-device logs                |

### One-time init

```bash
pnpm --filter @cardhub/native ios:init      # = tauri ios init
# Equivalent CI form:
#   pnpm --filter @cardhub/native exec tauri ios init --ci --skip-targets-install
```

This emits `src-tauri/gen/apple/` containing `cardhub.xcodeproj`, `Podfile`, `Sources/`, and the `Assets.xcassets` icon catalogue (driven from the icon set generated in M3).

### Dev cycle

```bash
# Launches iOS Simulator + Vite dev server. Set the device explicitly via
# --device "iPhone 15" if multiple are available.
pnpm --filter @cardhub/native ios:dev
```

The web bundle inside the Simulator hits `http://localhost:4000/trpc` because iOS Simulator shares the host's network namespace — no URL rewriting needed.

### Real device & TestFlight

You need an Apple Developer Program membership ($99 / year). Workflow:

1. Set `APPLE_DEVELOPMENT_TEAM=<10-char team id>` (or add `bundle.iOS.developmentTeam` in `tauri.conf.json`).
2. Open `src-tauri/gen/apple/cardhub.xcodeproj` in Xcode → Signing & Capabilities → enable Automatic.
3. `pnpm --filter @cardhub/native ios:build --target aarch64` produces an `.ipa` in `src-tauri/gen/apple/build/`.
4. Upload to TestFlight via Transporter.app or `xcrun altool --upload-app`.

> **TODO** — automate the TestFlight upload via fastlane in CI. Out of MVP scope.

---

## Android — macOS / Linux / Windows

### Prerequisites

| Tool                    | Install                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| Android Studio          | <https://developer.android.com/studio>                                                                    |
| Android SDK Platform 34 | Android Studio → SDK Manager (auto-installed on first run)                                                |
| Android NDK r25+        | SDK Manager → SDK Tools → NDK (Side by Side)                                                              |
| JDK 17+                 | macOS: `brew install --cask temurin@17`. Linux: `sudo apt install temurin-17-jdk`                         |
| Android rust targets    | `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android` |

### Environment variables

Append to `~/.zshrc` / `~/.bashrc`:

```bash
# macOS default — Linux uses ~/Android/Sdk; Windows uses %LOCALAPPDATA%\Android\Sdk.
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/$(ls $ANDROID_HOME/ndk | sort -V | tail -1)"
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$JAVA_HOME/bin:$PATH"
```

Verify with:

```bash
java --version            # should print 17.x
echo $ANDROID_HOME        # should not be empty
adb --version             # should print Android Debug Bridge
```

### One-time init

```bash
pnpm --filter @cardhub/native android:init  # = tauri android init
```

This emits `src-tauri/gen/android/` containing the Gradle project, `AndroidManifest.xml`, and the icon mipmap set generated in M3.

### Dev cycle (emulator)

```bash
# 1. Boot an AVD (Android Virtual Device) via Android Studio's Device Manager.
# 2. Confirm with `adb devices` that the emulator shows up.
# 3. Run dev — Tauri will install the apk on the running emulator.
pnpm --filter @cardhub/native android:dev
```

> **CRITICAL — Android emulator network**: `localhost` inside the emulator does **not** point to the host. `apps/cardhub/web/src/lib/trpc.tsx`'s `resolveTrpcUrl()` auto-detects the Android UA and dev mode and rewrites the tRPC URL to `http://10.0.2.2:4000/trpc` (Android emulator's loopback to the host). Real devices and `prod` builds use `VITE_TRPC_URL_TAURI` instead (must be HTTPS).

### Real device

```bash
adb devices              # confirm device is listed (USB debugging on, computer trusted)
pnpm --filter @cardhub/native android:dev --device <serial>
```

`adb reverse tcp:4000 tcp:4000` is **not** enough for our setup because the WebView's URL rewrite still asks for `10.0.2.2`. For real devices, set `VITE_TRPC_URL_TAURI` to your machine's LAN IP (e.g. `http://192.168.1.42:4000/trpc`) and rebuild, or hit the Render staging URL.

### Release & Play Store

You need a Google Play Console account ($25 one-time). Workflow:

1. Generate a release keystore: `keytool -genkey -v -keystore release.jks -alias cardhub -keyalg RSA -keysize 2048 -validity 10000`. **Keep this file outside the repo.**
2. Configure signing in `src-tauri/gen/android/app/build.gradle.kts` per the Tauri Android docs.
3. `pnpm --filter @cardhub/native android:build --aab` produces an `.aab` in `src-tauri/gen/android/app/build/outputs/bundle/`.
4. Upload to Play Console.

> **TODO** — automate via Gradle Play Publisher plugin in CI. Out of MVP scope.

---

## Current detection results (snapshot 2026-05-03)

| Tool                                   | Status on this machine         |
| -------------------------------------- | ------------------------------ |
| Xcode (`/usr/bin/xcodebuild -version`) | ✅ Xcode 16.4 + iOS 17 SDK     |
| iOS rust targets                       | ✅ aarch64/x86_64/aarch64-sim  |
| Cocoapods + xcodegen                   | ✅ via Homebrew                |
| `tauri ios init --ci`                  | ✅ runs end-to-end (~30s)      |
| `ANDROID_HOME`                         | ❌ unset                       |
| `JAVA_HOME` / `java` 17                | ❌ no JDK installed            |
| `adb`                                  | ❌ Android SDK not present     |
| `tauri android init`                   | ⏭ skipped — toolchain missing |

Once `ANDROID_HOME` + JDK 17 + NDK are installed, run `pnpm --filter @cardhub/native android:init`. The TypeScript / Rust code is already mobile-ready (`tauri.conf.json` carries the right `identifier`; `lib.rs` exports `#[cfg_attr(mobile, tauri::mobile_entry_point)]`).

---

## Common failure modes

| Symptom                                                          | Fix                                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `error: failed to find tool. Is xcrun installed?`                | `xcode-select --install` then `sudo xcode-select -s /Applications/Xcode.app`  |
| `xcodegen` "command not found"                                   | `brew install xcodegen`                                                       |
| Pods Bundler version mismatch                                    | `cd src-tauri/gen/apple && bundle install`                                    |
| Android `Could not find a version that satisfies tools-build:34` | Open SDK Manager, install Android SDK Build-Tools 34 + Platform 34            |
| Emulator boots but app shows white screen, console says CORS     | API's `CORS_ORIGIN` must include `http://10.0.2.2:5173` for emulator dev URLs |
| Real Android device "App not installed"                          | Disable "Verify apps over USB" in Developer Options                           |
