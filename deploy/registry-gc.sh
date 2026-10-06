#!/usr/bin/env bash
# Server-side cleanup for ship.ps1 -Mode registry: /srv/school/registry-gc.sh [keep]   (default keep=5)
# Keeps the newest <keep> edu-app tags (by image creation time) both as local images and in the private registry
# (registry.compose.yml), plus — always — the running APP_IMAGE and the rollback target in .last_tag. Then frees
# the registry's unreferenced blobs. Do NOT run it while a ship.ps1 push is in progress (the registry is stopped
# for a few seconds during garbage-collect).
set -euo pipefail
KEEP="${1:-${KEEP:-5}}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
REG="http://127.0.0.1:5000"
REPO="edu-app"
ACCEPT="application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json"
log() { printf '[registry-gc] %s\n' "$*"; }

# tags that must survive regardless of age
PROTECT=" "
tag_of() { sed -E 's/#.*//; s/^[[:space:]]*edu-app://' | awk 'NF{print $1; exit}'; }   # "edu-app:<sha>  # comment" -> <sha>
running="$(grep -E '^APP_IMAGE=' .env 2>/dev/null | cut -d= -f2- | tag_of || true)"
[[ -n "$running" ]] && PROTECT+="$running "
[[ -s .last_tag ]] && PROTECT+="$(tag_of < .last_tag) "
log "keep newest $KEEP; always keep:${PROTECT}"
protected() { [[ "$PROTECT" == *" $1 "* ]]; }

# ---- 1) local images ---------------------------------------------------------------------------------------------
# stray registry-named tags left by an interrupted ship.ps1 (edu-app:<sha> is the name deploy.sh uses)
for ref in $(docker image ls "127.0.0.1:5000/$REPO" --format '{{.Repository}}:{{.Tag}}'); do
  docker rmi "$ref" >/dev/null && log "untagged $ref"
done
n=0
for tag in $(docker image ls "$REPO" --format '{{.Tag}}' | grep -v '<none>' |
             while read -r t; do printf '%s %s\n' "$(docker image inspect -f '{{.Created}}' "$REPO:$t")" "$t"; done |
             sort -r | awk '{print $2}'); do
  n=$((n + 1))
  if (( n <= KEEP )) || protected "$tag"; then continue; fi
  docker rmi "$REPO:$tag" >/dev/null && log "removed local $REPO:$tag"
done
docker image prune -f >/dev/null

# ---- 2) registry -------------------------------------------------------------------------------------------------
if ! curl -sf "$REG/v2/" >/dev/null; then
  log "registry not running at $REG — skipping registry cleanup"; exit 0
fi
manifest() { curl -sf -H "Accept: $ACCEPT" "$REG/v2/$REPO/manifests/$1"; }
digest_of() { curl -sfI -H "Accept: $ACCEPT" "$REG/v2/$REPO/manifests/$1" | tr -d '\r' | awk -F': ' 'tolower($1)=="docker-content-digest"{print $2}'; }
# every manifest digest a reference stands for: itself + (for an index) its children (image + attestation manifests)
digests_of() { local d; d="$(digest_of "$1")"; echo "$d"; manifest "$d" | jq -r '.manifests[]?.digest'; }
created_of() {   # creation time of the image's config (first non-attestation manifest of an index)
  local m cfg
  m="$(manifest "$1")"
  if [[ "$(jq -r '.manifests // empty | length' <<<"$m")" != "" ]]; then
    m="$(manifest "$(jq -r '[.manifests[] | select(.platform.os != "unknown")][0].digest' <<<"$m")")"
  fi
  cfg="$(jq -r '.config.digest' <<<"$m")"
  curl -sf "$REG/v2/$REPO/blobs/$cfg" | jq -r '.created'
}

tags="$(curl -sf "$REG/v2/$REPO/tags/list" | jq -r '.tags[]?' || true)"
[[ -z "$tags" ]] && { log "registry has no $REPO tags"; exit 0; }
mapfile -t ordered < <(for t in $tags; do printf '%s %s\n' "$(created_of "$t")" "$t"; done | sort -r | awk '{print $2}')

keep_digests=" "; drop=()
for i in "${!ordered[@]}"; do
  t="${ordered[$i]}"
  if (( i < KEEP )) || protected "$t"; then keep_digests+="$(digests_of "$t" | tr '\n' ' ')"; else drop+=("$t"); fi
done
if (( ${#drop[@]} == 0 )); then log "registry: ${#ordered[@]} tag(s), nothing to drop"; exit 0; fi

for t in "${drop[@]}"; do
  for d in $(digests_of "$t"); do
    [[ "$keep_digests" == *" $d "* ]] && continue   # same image also under a kept tag
    curl -sf -X DELETE "$REG/v2/$REPO/manifests/$d" >/dev/null || true
  done
  log "dropped registry tag $REPO:$t"
done

# garbage-collect needs a quiet registry: stop it, collect in a one-off container on the same volume, start again
log "garbage-collect"
docker compose -f registry.compose.yml stop registry >/dev/null 2>&1
docker compose -f registry.compose.yml run --rm --no-deps registry \
  garbage-collect /etc/docker/registry/config.yml 2>&1 | grep -ciE 'blob eligible for deletion' |
  xargs -I{} printf '[registry-gc] %s blob(s) deleted\n' {} || true
docker compose -f registry.compose.yml up -d registry >/dev/null 2>&1
log "done"
