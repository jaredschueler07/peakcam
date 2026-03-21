#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Install deps if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

exec node server.js
