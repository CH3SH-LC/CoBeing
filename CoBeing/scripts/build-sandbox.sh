#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Building cobeing-sandbox images..."

echo "[1/3] Building base image..."
docker build -t cobeing-sandbox:base -f "$PROJECT_ROOT/sandbox/Dockerfile.base" "$PROJECT_ROOT/sandbox/"

echo "[2/3] Building python image..."
docker build -t cobeing-sandbox:python -f "$PROJECT_ROOT/sandbox/Dockerfile.python" "$PROJECT_ROOT/sandbox/"

echo "[3/3] Building full image..."
docker build -t cobeing-sandbox:full -t cobeing-sandbox:latest -f "$PROJECT_ROOT/sandbox/Dockerfile.full" "$PROJECT_ROOT/sandbox/"

echo "Done. Images:"
docker images cobeing-sandbox
