// An edit made through the same keyed import that terminal agents use.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function captureRundown({ cli, open, page, root, dest, home, fixture, run }) {
	const segments = [
		['Dawn chorus', 4, 'Reeds at first light'],
		['Under the bridge', 9, 'A conversation with the ferry pilot'],
		['The last crossing', 7, 'Deck sounds and closing credits'],
	]
	const text = (key, text, x, y, w, size, color = 'black') => ({
		key, text, box: { x, y, w, h: 40 }, style: { geo: 'text', size, color },
	})
	function rundown(trim) {
		let minute = 0
		const nodes = [
			text('title', 'Sounds from the river', 0, 0, 930, 'xl'),
			text('deck', 'Fieldnote Radio   /   Episode rundown', 0, 62, 880, 'm', 'blue'),
		]
		for (const [i, [name, raw, detail]] of segments.entries()) {
			const duration = raw - (i === 1 ? trim : 0)
			const y = 136 + i * 92
			nodes.push(text('cue-' + i, String(minute).padStart(2, '0') + ':00', 495, y, 108, 'm', 'blue'))
			nodes.push(text('name-' + i, name, 610, y, 345, 'm'))
			nodes.push(text('length-' + i, duration + ' min', 955, y, 110, 'm', 'violet'))
			nodes.push(text('detail-' + i, detail, 610, y + 38, 380, 's'))
			minute += duration
		}
		nodes.push(text('clock', minute + ':00  /  18:00 slot', 495, 419, 520, 'l', 'blue'))
		nodes.push(text('instruction', trim ? 'Ready for air • Ferry interview cut to seven minutes.' : 'Two minutes over • Keep the opening and closing tape.', 0, 506, 1050, 'm'))
		return { nodes, edges: [], groups: [] }
	}
	const name = 'river-episode'
	await cli('new', name, '--title', 'Fieldnote Radio · Edit suite', '--from', fixture('rough.tg.json', rundown(0)))
	await open(name, 'clock')
	await page.getByRole('button', { name: /^Appearance:/ }).click()
	await page.getByRole('radio', { name: 'Admiralty' }).click()
	await page.keyboard.press('Escape')
	await page.waitForFunction(() => window.editor.getCurrentThemeId() === 'admiralty')
	await page.setViewportSize({ width: 1280, height: 800 })
	const src = 'data:image/svg+xml;base64,' + readFileSync(join(root, 'examples/radio/river.svg')).toString('base64')
	await page.evaluate((src) => {
		const { editor, toucan } = window
		const assetId = 'asset:river'
		editor.createAssets([{ id: assetId, type: 'image', typeName: 'asset', meta: {}, props: { name: 'River recording locations', src, w: 480, h: 360, mimeType: 'image/svg+xml', isAnimated: false } }])
		editor.createShape({ id: toucan.idFor('river'), type: 'image', x: 0, y: 125, props: { assetId, w: 454, h: 340.5 }, meta: { key: 'river' } })
		editor.updateShape({ id: toucan.idFor('title'), type: 'text', props: { font: 'serif' } })
		editor.setCamera({ x: 52, y: 112, z: 1 })
	}, src)
	await page.evaluate(async () => { await document.fonts.ready })
	const shot = (file) => page.screenshot({ path: join(home, file + '.png') })
	const frames = []
	const hold = async (name, duration) => {
		await shot(name)
		frames.push({ name, duration })
	}
	// Follow the edit into the cue sheet and back out using the editor's camera.
	const pan = async (reverse) => {
		for (let i = 1; i <= 12; i++) {
			const t = reverse ? 1 - i / 12 : i / 12
			const eased = t * t * (3 - 2 * t)
			await page.evaluate((f) => {
				window.editor.setCamera({ x: 52 - 385 * f, y: 112 - 140 * f, z: 1 + .47 * f }, { immediate: true })
			}, eased)
			await hold((reverse ? 'out-' : 'in-') + i, 1 / 12)
		}
	}
	await hold('rough', 2.1)
	await pan(false)
	await page.evaluate(() => { window.editor.select(window.toucan.idFor('length-1')) })
	await hold('select', 1.4)
	await cli('--canvas', name, 'import', fixture('air.tg.json', rundown(2)))
	await page.waitForFunction(() => window.toucan.get('clock').props.richText.content[0].content[0].text.startsWith('18:00'))
	await page.evaluate(() => { window.editor.selectNone() })
	await hold('edit', 1.2)
	const graph = await page.evaluate(() => window.toucan.graph())
	assert.deepEqual(graph.nodes.filter(n => n.key.startsWith('length-')).sort((a,b) => a.key.localeCompare(b.key)).map(n => n.text), ['4 min', '7 min', '7 min'])
	await page.waitForFunction(() => !document.querySelector('.toucan-pulse, .toucan-pulse-tag, .toucan-agent-status, .toucan-agent-cursor'), null, { timeout: 15000 })
	await pan(true)
	await hold('final', 2.4)
	await page.screenshot({ path: join(dest, 'river-rundown.png') })
	// Hold on the source, the selected cut, the import feedback, and its settled result.
	writeFileSync(join(home, 'rundown-frames.txt'), frames.map(({ name, duration }) => `file '${name}.png'\nduration ${duration}\n`).join('') + "file 'final.png'\n")
	await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(home, 'rundown-frames.txt'), '-vf', 'fps=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(dest, 'river-rundown.mp4')])
}
