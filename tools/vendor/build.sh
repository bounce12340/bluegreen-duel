#!/usr/bin/env bash
# 重新打包 site/vendor/ 的特效函式庫（平常不用跑；升級版本時才需要）
# 網站的 CSP 只允許自家網址的程式，所以函式庫打包成本機 ESM 檔，第一次用到才 import()。
set -euo pipefail
cd "$(dirname "$0")"
work=$(mktemp -d)
cp ./*.js "$work/"
cd "$work"
npm init -y >/dev/null
npm i --silent canvas-confetti@1.9.4 @tsparticles/engine@4.5.0 @tsparticles/basic@4.5.0 @tsparticles/shape-line@4.5.0 \
  @tsparticles/plugin-emitters@4.5.0 @tsparticles/plugin-emitters-shape-square@4.5.0 @tsparticles/updater-life@4.5.0 @tsparticles/updater-rotate@4.5.0 lottie-web@5.13.0 pixi.js@8.22.0 pixi-filters@6.1.5 esbuild
out="$OLDPWD/../../site/vendor"
for e in confetti particles lottie pixi; do
  npx esbuild "$e.js" --bundle --format=esm --minify --legal-comments=eof --outfile="$out/fx-$e.mjs" --log-level=warning
done
echo "done → $out"
