// Demo helper invoked by the real chat agent. Keeps layout separate from the agent's meal decisions.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { menuCode, recipes, scheduleCode } from './board.mjs'

const connection = resolve('../connection.json')
const [command, path] = process.argv.slice(2)
if (command === 'recipes') {
	console.log(JSON.stringify(recipes, null, 2))
} else {
	if (!['menu', 'schedule'].includes(command) || !path) throw new Error('usage: agent-tool recipes | menu JSONFILE | schedule JSONFILE')
	const { url, token } = JSON.parse(readFileSync(connection, 'utf8'))
	if (new URL(url).hostname !== '127.0.0.1' || !token) throw new Error('The demo helper requires a disposable local Toucan server')
	const input = JSON.parse(readFileSync(path === '-' ? 0 : path, 'utf8'))
	const code = (command === 'menu' ? menuCode : scheduleCode)(input)
	const cli = fileURLToPath(new URL('../../bin/toucan.mjs', import.meta.url))
	console.log(execFileSync(process.execPath, [cli, '--canvas', 'thanksgiving', '--agent', 'Codex', 'exec', '--label', command === 'menu' ? 'Add five recipe cards' : 'Draw the dinner timeline', '-'], { input: code, encoding: 'utf8', maxBuffer: 8 << 20, env: { ...process.env, TOUCAN_URL: url, TOUCAN_TOKEN: token } }))
	writeFileSync(join(dirname(connection), command + '.json'), JSON.stringify(input, null, 2))
}
