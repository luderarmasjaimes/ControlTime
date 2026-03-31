#!/usr/bin/env bash
set -euo pipefail

# Detect GitHub repository owner from git remote URL and write .env
GIT_URL=$(git config --get remote.origin.url || true)
if [ -z "$GIT_URL" ]; then
  echo "No git remote.origin.url found. Please set IMAGE_NAMESPACE manually or run this inside a git repo." >&2
  exit 1
fi

# Support SSH and HTTPS URLs
if [[ "$GIT_URL" =~ ^git@github.com:(.+)/(.+)\.git$ ]]; then
  OWNER="${BASH_REMATCH[1]}"
elif [[ "$GIT_URL" =~ ^https://github.com/(.+)/(.+)\.git$ ]]; then
  OWNER="${BASH_REMATCH[1]}"
else
  # try to parse loosely
  OWNER=$(echo "$GIT_URL" | sed -E 's#.*[:/](.+)/(.+)(\.git)?$#\1#')
fi

if [ -z "$OWNER" ]; then
  echo "Could not parse repo owner from remote URL: $GIT_URL" >&2
  exit 1
fi

ENV_FILE=.env
echo "IMAGE_REGISTRY=ghcr.io" > "$ENV_FILE"
echo "IMAGE_NAMESPACE=$OWNER" >> "$ENV_FILE"

echo ".env written with IMAGE_REGISTRY=ghcr.io and IMAGE_NAMESPACE=$OWNER"
echo "Contents:" && cat "$ENV_FILE"
