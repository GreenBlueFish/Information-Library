#!/usr/bin/env bash
# Runs the test suite with Node, minus the files in tests/known-gaps.txt.
#
# Several tests import fast-check and linkedom from a CDN by https:// URL, which
# Node does not load on its own; tests/net/register.js adds that. The fetch
# honours HTTPS_PROXY.
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_USE_ENV_PROXY=1
exec node --no-warnings --import ./tests/net/register.js tests/run.js --skip tests/known-gaps.txt
