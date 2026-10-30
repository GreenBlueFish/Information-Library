#!/usr/bin/env bash
# Runs the test suite with Node, minus the files in tests/known-gaps.txt.
#
# Several tests import fast-check and linkedom from a CDN by https:// URL, which
# Node does not load on its own; tests/net/register.js adds that, reading each
# from its copy in tests/vendor/ so the suite runs offline. Only a module with no
# copy is fetched, honouring HTTPS_PROXY.
#
# --quiet keeps the output short and puts the totals first: the Hive clips the
# test record a reviewer reads to its first 4000 characters.
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_USE_ENV_PROXY=1
exec node --no-warnings --import ./tests/net/register.js tests/run.js --quiet --skip tests/known-gaps.txt
