#!/usr/bin/env bash
#
# OrganizeOS fork guard: the published-site runtime packages stay byte-identical
# to upstream (docs/ORGANIZEOS-FORK.md section 1).
#
# A published site installs @webstudio-is/sdk, react-sdk, sdk-components-react,
# its Radix, React Router and Remix variants (the CLI templates list them),
# image and wsauth from npm, at upstream's release PUBLISHED_RUNTIME_VERSION
# (packages/cli/src/runtime-version.ts), never from this fork, while the builder
# and the CLI run this fork's copies. Any difference splits what the builder
# shows from what a site runs.
#
# scripts/upstream-base.txt holds the upstream commit this fork is based on. It
# is bumped with every upstream merge, in the same change as
# PUBLISHED_RUNTIME_VERSION. The check needs that commit in history, so CI
# checks out with fetch-depth: 0.
#
# Run by `pnpm check:runtime-upstream` and in CI. Exit non-zero on any diff.
set -euo pipefail

cd "$(dirname "$0")/.."

packages=(
  packages/sdk
  packages/react-sdk
  packages/sdk-components-react
  packages/sdk-components-react-radix
  packages/sdk-components-react-router
  packages/sdk-components-react-remix
  packages/image
  packages/wsauth
)

base_file="scripts/upstream-base.txt"
base="$(tr -d '[:space:]' <"$base_file")"

if [[ ! "$base" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: $base_file must hold one full commit SHA, as git rev-parse prints it." >&2
  exit 1
fi

# 1. The base must be in HEAD's history. A shallow clone does not have it.
if ! git merge-base --is-ancestor "$base" HEAD 2>/dev/null; then
  echo "ERROR: upstream base $base ($base_file) is not in HEAD's history." >&2
  if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
    echo "       This clone is shallow. Fetch the full history (git fetch --unshallow;" >&2
    echo "       in CI, actions/checkout with fetch-depth: 0) and run the check again." >&2
  else
    echo "       $base_file must name the upstream commit this fork" >&2
    echo "       last merged, and an upstream merge must land as a merge commit," >&2
    echo "       never squashed, so that commit stays in history." >&2
  fi
  exit 1
fi

# 2. Every package must exist at the base, or the diff below checks nothing.
for package in "${packages[@]}"; do
  if ! git cat-file -e "$base:$package" 2>/dev/null; then
    echo "ERROR: $package is not in upstream base $base." >&2
    echo "       Update the package list in scripts/check-runtime-upstream.sh." >&2
    exit 1
  fi
done

# 3. The packages at HEAD must be byte-identical to the base.
status=0
git diff --exit-code --name-status "$base" HEAD -- "${packages[@]}" || status=$?
if [ "$status" -eq 1 ]; then
  cat >&2 <<EOF
ERROR: the runtime package files listed above differ from upstream ($base).

These packages must stay byte-identical to upstream (docs/ORGANIZEOS-FORK.md
section 1). A published site installs upstream's npm release of them,
PUBLISHED_RUNTIME_VERSION in packages/cli/src/runtime-version.ts, while the
builder and the CLI run this fork's copies, so a change here splits what the
builder shows from what a site runs.

- A fork change: revert it. OrganizeOS site code belongs outside these
  packages (the CLI templates, or a package of the fork's own).
- An upstream merge: set $base_file to the merged
  upstream commit, in the same change that bumps PUBLISHED_RUNTIME_VERSION.
EOF
  exit 1
elif [ "$status" -ne 0 ]; then
  exit "$status"
fi

echo "OK: runtime packages at HEAD are byte-identical to upstream $base."
