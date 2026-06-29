#!/usr/bin/env bash
#
# OrganizeOS AGPL-only fork guard.
#
# The upstream @webstudio-is/sdk-components-animation package is EULA-proprietary
# and was physically removed from this fork. It must never be reintroduced into the
# builder, CLI, templates, or shipped output, and the proprietary EULA license banner
# must never appear anywhere in the tree.
#
# Run by `pnpm check:no-proprietary` and in CI. Exit non-zero on any hit.
set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

# 1. No references to the proprietary animation package in builder / CLI / packages.
#    (fixtures/* are build-excluded example projects and are not checked.)
if grep -rIn "sdk-components-animation" apps packages \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" --include="*.json" \
  2>/dev/null; then
  echo "ERROR: proprietary @webstudio-is/sdk-components-animation reference(s) found above." >&2
  echo "       This is an AGPL-only fork; the animation package must stay removed." >&2
  fail=1
fi

# 2. The proprietary EULA license banner must not appear anywhere we ship. The
#    banner SPDX id is assembled here so this guard does not flag its own source;
#    docs/ (which describe the policy in prose) and this script are excluded.
banner="LicenseRef-Webstudio,""Inc-Proprietary"
if grep -rIn "$banner" . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs \
  --exclude="check-no-proprietary.sh" 2>/dev/null; then
  echo "ERROR: proprietary EULA license banner found above (must not ship)." >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "OK: no proprietary animation-package references."
