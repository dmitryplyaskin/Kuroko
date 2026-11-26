#!/bin/sh
set -e

case "$0" in
  */*) script_dir=${0%/*} ;;
  *) script_dir=. ;;
esac
CDPATH='' cd -- "$script_dir/.."
exec bun run start --open
