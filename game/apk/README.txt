UMBRA — Android app (Umbra.apk)
===============================

This is a real, signed Android package (not a shortcut or a web bookmark).
It contains the whole game, so it runs offline with no browser and no store.

Install on your phone
---------------------
1. Copy Umbra.apk to the phone (download it, or send it to yourself).
2. Tap the file in your Files app.
3. Android will ask to allow installs from this source — allow it once.
   (Settings -> Apps -> Special access -> Install unknown apps)
4. Tap Install, then open "Umbra" from your home screen.

Details
-------
Package           com.umbra.game
Version           1.0 (versionCode 1)
Size              ~352 KB (the game compresses well inside the package)
Android           6.0 and newer (minSdk 23, targetSdk 34)
Orientation       portrait, full-screen immersive
Permissions       internet (for the optional Google Fonts), vibrate
Signature         self-signed, SHA-256
                  34:E7:9E:60:20:3C:07:9F:C4:89:DC:EB:F7:E5:17:0B:C9:28:FD:27:00:3D:F7:86:5C:65:2D:CA:1B:70:DA:20

APK SHA-256       6d62f2a5bcff99410c49d9bf434ca74237b60f5a30e669d5eea07854b2fd1c64

Because it is self-signed rather than distributed by Google Play, Play Protect
may show a "scan" prompt the first time. That is expected for side-loaded apps.

Updating an existing install
---------------------------
Android only accepts an update signed with the same key as the installed copy.
If a future build carries a different certificate, uninstall the old app first
(Android will say "App not installed" otherwise), then install the new APK.

Rebuilding
----------
The Android shell lives in /android and needs JDK 17+ plus Android SDK
platform 34 and build-tools 34.0.0:

    ANDROID_HOME=/path/to/android-sdk ./android/build-apk.sh

The signing key is kept at android/umbra-release.keystore, so future
builds replace the app in place. The build script rebuilds the web bundle, embeds dist/index.html into the APK as
assets/index.html, compiles and signs everything, and copies the finished
package to public/download/Umbra.apk.
