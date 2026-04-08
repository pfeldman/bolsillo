#!/bin/bash
INFO_PLIST="ios/App/App/Info.plist"

# === URL Schemes ===
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$INFO_PLIST" 2>/dev/null

# App URL scheme for OAuth callback
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string com.pieve.bolsillo" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string com.pieve.bolsillo" "$INFO_PLIST"

# === App Icon ===
ICON_SRC="public/icon-512.svg"
ICON_DST="ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
# SVG icons need conversion - check for PNG first
if [ -f "public/icons/icon-512.png" ]; then
  ICON_SRC="public/icons/icon-512.png"
elif [ -f "public/icon-512.png" ]; then
  ICON_SRC="public/icon-512.png"
fi

if [ -f "$ICON_SRC" ] && [[ "$ICON_SRC" == *.png ]]; then
  sips -z 1024 1024 "$ICON_SRC" --out /tmp/icon_resized.png > /dev/null 2>&1
  sips -s format jpeg -s formatOptions 100 /tmp/icon_resized.png --out /tmp/icon_flat.jpg > /dev/null 2>&1
  sips -s format png /tmp/icon_flat.jpg --out "$ICON_DST" > /dev/null 2>&1
  rm -f /tmp/icon_resized.png /tmp/icon_flat.jpg
  echo "App icon set (alpha removed)"
fi

echo "iOS configuration complete"
