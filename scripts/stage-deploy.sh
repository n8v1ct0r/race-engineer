#!/usr/bin/env bash
# Stage a deploy folder that holds the committed code plus exactly one exported session.
# Formula 1 derived data never enters git; this copies it from public/data/ into the staged
# folder only, with a manifest filtered to that one session.
#
#   scripts/stage-deploy.sh <session_id> <dest_dir>
#   e.g. scripts/stage-deploy.sh 2026-11-q /private/tmp/race-engineer-deploy
set -euo pipefail
sid="${1:?session id, e.g. 2026-11-q}"
dest="${2:?destination folder}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
src="$repo/public/data"
[ -f "$src/manifest.json" ] || { echo "no $src/manifest.json: run pnpm export first" >&2; exit 1; }
[ -d "$src/$sid" ] || { echo "no exported session $sid in $src" >&2; exit 1; }
[ ! -e "$dest" ] || { echo "$dest exists; pick a new folder" >&2; exit 1; }
mkdir -p "$dest"
git -C "$repo" archive HEAD | tar -x -C "$dest"
mkdir -p "$dest/public/data"
cp -R "$src/$sid" "$dest/public/data/$sid"
node -e '
const fs = require("fs");
const [src, out, sid] = process.argv.slice(1);
const m = JSON.parse(fs.readFileSync(src, "utf8"));
m.sessions = m.sessions.filter((s) => s.session_id === sid);
if (m.sessions.length !== 1) throw new Error("session " + sid + " not in manifest");
fs.writeFileSync(out, JSON.stringify(m));
' "$src/manifest.json" "$dest/public/data/manifest.json" "$sid"
# The staged folder is a deploy source, not a repo: drop the gitignore so Vercel uploads public/data.
rm -f "$dest/.gitignore" "$dest/.vercelignore"
printf '.next\nnode_modules\n.vercel\n' > "$dest/.vercelignore"
echo "staged $sid into $dest:"
ls "$dest/public/data"
