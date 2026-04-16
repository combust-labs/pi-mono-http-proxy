#!/usr/bin/env bash

# A simple wrapper to install dependencies, build the project, and start the server.
# Usage: ./run.sh [command]
#   If no command is provided, the default sequence (install, build, start) runs.
#   You can also pass a custom npm script name (e.g., dev, test).

set -euo pipefail

# Ensure we are running from the project root (parent of this script's directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

# Helper to display usage
usage() {
  echo "Usage: $0 [npm-script]"
  echo "If omitted, defaults to install -> build -> start"
}

# If a custom npm script is supplied, just run it.
if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *)
      echo "Running custom npm script: $1"
      npm run "$1"
      exit 0
      ;;
  esac
fi

# Default workflow
echo "Installing dependencies..."
npm ci

echo "Building the project..."
npm run build

echo "Starting the server..."
npm start
