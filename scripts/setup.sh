#!/usr/bin/env bash
# Mac/Linux — Node yoksa proje içine (.runtime/node) indirir, sonra bootstrap.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ROOT="$(pwd)"
RUNTIME_NODE="$PROJECT_ROOT/.runtime/node"
MIN_MAJOR=18

NVM_BIN=""
if [ -d "$HOME/.nvm/versions/node" ]; then
  NVM_BIN="$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" | tail -1)/bin"
fi
export PATH="${RUNTIME_NODE}/bin:/opt/homebrew/bin:/usr/local/bin:${NVM_BIN}:${PATH}"

node_major() {
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "0"
}

have_usable_node() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major="$(node_major)"
  [ "${major}" -ge "${MIN_MAJOR}" ]
}

detect_arch() {
  case "$(uname -m)" in
    arm64|aarch64) echo "arm64" ;;
    *) echo "x64" ;;
  esac
}

latest_lts() {
  python3 - <<'PY' 2>/dev/null || true
import json, urllib.request
with urllib.request.urlopen("https://nodejs.org/dist/index.json", timeout=20) as res:
    arr = json.load(res)
for item in arr:
    if item.get("lts"):
        print(item["version"])
        break
PY
}

install_project_node() {
  local ver arch url tmp
  ver="$(latest_lts)"
  if [ -z "${ver}" ]; then
    ver="v24.19.0"
  fi
  arch="$(detect_arch)"
  url="https://nodejs.org/dist/${ver}/node-${ver}-darwin-${arch}.tar.gz"

  echo "[setup] Node.js ${ver} (${arch}) proje içine kuruluyor: .runtime/node"
  mkdir -p "${PROJECT_ROOT}/.runtime"
  tmp="$(mktemp -d "${PROJECT_ROOT}/.runtime/tmp-node.XXXXXX")"
  curl -fL --retry 3 --retry-delay 2 "${url}" -o "${tmp}/node.tar.gz"
  tar -xzf "${tmp}/node.tar.gz" -C "${tmp}"
  rm -rf "${RUNTIME_NODE}"
  mv "${tmp}/node-${ver}-darwin-${arch}" "${RUNTIME_NODE}"
  rm -rf "${tmp}"
  export PATH="${RUNTIME_NODE}/bin:${PATH}"
}

if ! have_usable_node; then
  echo "[setup] Kullanılabilir Node.js ${MIN_MAJOR}+ bulunamadı."
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "[setup] Linux: https://nodejs.org LTS kurun, sonra tekrar çalıştırın."
    exit 1
  fi
  install_project_node
fi

if ! have_usable_node || ! command -v npm >/dev/null 2>&1; then
  echo "[setup] Node/npm hâlâ yok. https://nodejs.org LTS kurun."
  exit 1
fi

echo "[setup] Node $(node -v) / npm $(npm -v)  ($(command -v node))"
exec node scripts/bootstrap.mjs "$@"
