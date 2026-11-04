// Open a link in the person's browser, if there's a person at this machine.

import { spawn } from 'node:child_process'

/**
 * True if a browser took it. Over ssh or with no display, there's nothing to open it on. The token is in the link, so it's on
 * this command line for as long as the opener runs; on a machine shared with people you don't trust, use `toucan url` instead.
 */
export function openInBrowser(url, { platform = process.platform, env = process.env } = {}) {
	if (env.SSH_CONNECTION || env.SSH_TTY) return Promise.resolve(false)
	if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return Promise.resolve(false)
	const [cmd, ...args] = env.TOUCAN_BROWSER ? [env.TOUCAN_BROWSER] : platform === 'darwin' ? ['open'] : platform === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler'] : ['xdg-open']
	return new Promise((resolve) => {
		const child = spawn(cmd, [...args, url], { detached: true, stdio: 'ignore' })
		child.on('error', () => resolve(false))
		child.on('exit', (code) => resolve(code === 0))
		// Openers usually return at once; one still going after this is the browser itself.
		setTimeout(() => (child.unref(), resolve(true)), 1500).unref()
	})
}
