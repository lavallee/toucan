#!/bin/sh
# Install toucan: https://github.com/lavallee/toucan
#
#   curl -fsSL https://github.com/lavallee/toucan/releases/latest/download/install.sh | sh
#   curl -fsSL …/install.sh | sh -s -- --no-open       # arguments go to `toucan setup`
#
# It needs Node 22 or newer, installs the release with npm (no sudo: a user directory if npm's global one
# isn't writable), then runs `toucan setup`. The name `toucan` on the npm registry is someone else's
# package, so this installs the tarball from toucan's own GitHub release.
#
# TOUCAN_TARBALL: install this file or URL instead of the latest release.
set -eu

TARBALL="${TOUCAN_TARBALL:-https://github.com/lavallee/toucan/releases/latest/download/toucan.tgz}"

fail() {
	printf 'toucan: %s\n' "$1" >&2
	exit 1
}

command -v node >/dev/null 2>&1 || fail "Node 22 or newer is needed and isn't installed. Get it from https://nodejs.org, then run this again."
command -v npm >/dev/null 2>&1 || fail "npm is needed and isn't on your PATH. It comes with Node: https://nodejs.org"
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 22 ] || fail "Node 22 or newer is needed; this is $(node --version). Upgrade from https://nodejs.org, then run this again."

prefix=$(npm prefix -g)
if [ -w "$prefix/lib/node_modules" ] 2>/dev/null || { [ ! -e "$prefix/lib/node_modules" ] && [ -w "$prefix" ]; }; then
	bin="$prefix/bin"
else
	prefix="$HOME/.local"
	bin="$prefix/bin"
	printf "npm's global directory isn't writable, so installing under %s\n" "$prefix"
fi

printf 'Installing toucan…\n'
npm install --global --prefix "$prefix" --no-audit --no-fund --loglevel=error "$TARBALL"

case ":$PATH:" in
*":$bin:"*) ;;
*)
	printf '\n%s is not on your PATH. Add it, for agents and new terminals:\n' "$bin"
	printf '  export PATH="%s:$PATH"\n\n' "$bin"
	;;
esac

"$bin/toucan" setup "$@"
