#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Building cobeing-sandbox image..."
docker build -t cobeing-sandbox:latest "$PROJECT_ROOT/cobeing/sandbox/"

echo "Done. Image: cobeing-sandbox:latest"
docker images cobeing-sandbox:latest
