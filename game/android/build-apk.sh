#!/usr/bin/env bash
# Builds a signed, installable Umbra.apk from the current web build.
# Requires: JDK 17+, Android SDK platform 34 + build-tools 34.0.0.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

: "${ANDROID_HOME:=/opt/android-sdk}"
BT="$ANDROID_HOME/build-tools/34.0.0"
PLATFORM="$ANDROID_HOME/platforms/android-34/android.jar"
APP="android/app/src/main"
OUT="android/build"
KS_PASS="umbra2026"
KEYSTORE="android/umbra-release.keystore"

for f in "$BT/aapt2" "$BT/d8" "$BT/apksigner" "$BT/zipalign" "$PLATFORM"; do
  [ -e "$f" ] || { echo "Missing build dependency: $f"; exit 1; }
done

echo "==> 1/8 building the web bundle"
npm run build >/dev/null
mkdir -p "$APP/assets"
cp dist/index.html "$APP/assets/index.html"
echo "    bundled $(du -h "$APP/assets/index.html" | cut -f1)"

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "==> 2/8 compiling resources"
"$BT/aapt2" compile --dir "$APP/res" -o "$OUT/res.zip"

echo "==> 3/8 linking resources + assets"
"$BT/aapt2" link \
  -o "$OUT/base.apk" \
  -I "$PLATFORM" \
  --manifest "$APP/AndroidManifest.xml" \
  --min-sdk-version 23 \
  --target-sdk-version 34 \
  --version-code 1 \
  --version-name "1.0" \
  --java "$OUT/gen" \
  -R "$OUT/res.zip" \
  -A "$APP/assets" \
  --auto-add-overlay

echo "==> 4/8 compiling Java"
javac -source 8 -target 8 -encoding UTF-8 -nowarn \
  -classpath "$PLATFORM" -d "$OUT/classes" \
  $(find "$OUT/gen" -name '*.java') $(find "$APP/java" -name '*.java') 2>&1 | grep -v 'bootstrap class path' || true

echo "==> 5/8 dexing"
"$BT/d8" --lib "$PLATFORM" --min-api 23 --output "$OUT/dex" \
  $(find "$OUT/classes" -name '*.class')
( cd "$OUT/dex" && zip -q ../base.apk classes.dex )

echo "==> 6/8 aligning"
"$BT/zipalign" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"

echo "==> 7/8 signing"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -alias umbra \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=Umbra, OU=Games, O=Umbra Studio, C=US" >/dev/null 2>&1
fi
"$BT/apksigner" sign \
  --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$OUT/Umbra.apk" "$OUT/aligned.apk"

echo "==> 8/8 verifying"
"$BT/apksigner" verify --print-certs "$OUT/Umbra.apk" | head -4
mkdir -p public/download
cp "$OUT/Umbra.apk" public/download/Umbra.apk
echo "    wrote public/download/Umbra.apk ($(du -h public/download/Umbra.apk | cut -f1))"
