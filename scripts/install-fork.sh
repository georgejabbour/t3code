#!/usr/bin/env bash
# Compatibility entry point. All deployment logic lives in the Hermes script.
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "${HERMES_HOME:-$HOME/.hermes}/scripts/t3_reinstall_restart.sh" --repo "$repo_dir" "$@"
