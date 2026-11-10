#!/usr/bin/env bash
# Assemble www/ (the app the Android shell loads) from src/ + EmulatorJS + the mGBA core.
set -euo pipefail
cd "$(dirname "$0")"
EJS=node_modules/@emulatorjs/emulatorjs/data
CORE=node_modules/@emulatorjs/core-mgba
rm -rf www && mkdir -p www/data/cores/reports
cp src/index.html www/
cp -r "$EJS"/{loader.js,emulator.css,version.json,src,compression,localization} www/data/
cp "$CORE"/mgba-wasm.data "$CORE"/mgba-legacy-wasm.data www/data/cores/
cp "$CORE"/reports/mgba.json www/data/cores/reports/
echo "www/ ready: $(du -sh www | cut -f1)"
