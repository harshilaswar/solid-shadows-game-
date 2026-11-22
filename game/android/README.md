# Umbra — Android shell

A minimal, offline-first WebView shell that packages the game as a real APK.
The web build is inlined by `vite-plugin-singlefile`, so the package contains the
whole game in `assets/index.html` — no server, no network required.

## Layout

```
android/
  build-apk.sh                  one-command build (web bundle -> signed APK)
  umbra-release.keystore        persistent signing key (keep this!)
  app/src/main/
    AndroidManifest.xml         com.umbra.game, minSdk 23, targetSdk 34
    java/com/umbra/game/MainActivity.java
    res/values/{strings,styles}.xml
    res/mipmap-*/ic_launcher.png
    assets/index.html           generated: the single-file game
  build/Umbra.apk               build output (copied to apk/ and public/download/)
```

## Build

```bash
# needs JDK 17+ and Android SDK platform 34 + build-tools 34.0.0
ANDROID_HOME=/opt/android-sdk ./android/build-apk.sh
```

The script compiles resources with `aapt2`, links the manifest, compiles Java,
dexes with `d8`, aligns with `zipalign`, signs with `apksigner` (v1/v2/v3) and
copies the result to `public/download/Umbra.apk`.

## Why a persisted keystore

Android only allows an update to replace an installed app when it is signed by
the same key. `umbra-release.keystore` is therefore kept out of the wiped build
folder. The password is the documented development one (`umbra2026`); replace it
with a private key stored outside the repository before any public release.

## Runtime notes

- The HTML is handed to the WebView with `loadDataWithBaseURL("https://umbra.local/")`,
  which gives module scripts, `localStorage` (editor saves) and secure-context
  APIs a normal origin — `file://` would break them.
- Immersive full screen with portrait lock; the HUD respects
  `env(safe-area-inset-*)` so a notch never covers a control.
- `FLAG_KEEP_SCREEN_ON` keeps the puzzle awake while it is open.
