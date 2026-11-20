// Drawing helpers for the agent-led Thanksgiving capture. Inputs are chosen by the chat agent.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const recipes = JSON.parse(readFileSync(join(here, 'recipes.json')))
const photos = join(here, '../../website/site/assets/use-cases/thanksgiving')
const colors = ['orange', 'red', 'yellow', 'green', 'violet']
const text = (key, text, x, y, w, size = 'm', color = 'black', meta) => ({
	key, text, box: { x, y, w, h: 40 }, style: { geo: 'text', size, color }, meta,
})
const box = (key, text, x, y, w, h, color, size = 's', meta) => ({
	key, text, box: { x, y, w, h }, style: { color, size, fill: 'semi', dash: 'solid' }, meta,
})
const graph = (nodes) => ({ groups: [], nodes, edges: [] })
export const seed = graph([
	text('menu-title', 'Thanksgiving dinner', 0, 0, 1180, 'xl'),
	text('menu-subtitle', 'Five recipes. One oven. A table for eight.', 0, 57, 1180, 'm', 'black'),
])

export function menuCode(cards) {
	assert.deepEqual(cards.map(({ id }) => id).sort(), recipes.map(({ id }) => id).sort())
	const nodes = [], pics = []
	for (const [i, r] of recipes.entries()) {
		const card = cards.find(({ id }) => id === r.id)
		for (const field of ['ingredients', 'prep']) assert.ok(typeof card[field] === 'string' && card[field].length > 15 && card[field].length <= 130, `${r.id}: ${field}`)
		const x = i * 248
		const refs = [{ label: `Open recipe at ${r.source}`, ref: r.url }]
		nodes.push(text(`recipe-${r.id}`, r.title, x, 264, 238, 'm', 'black', { refs, detail: `${card.ingredients}\n\n${card.prep}` }))
		nodes.push(text(`${r.id}-source`, r.source + ' ↗', x, 305, 238, 's', colors[i], { refs }))
		nodes.push(text(`${r.id}-ingredients`, 'Ingredients\n' + card.ingredients, x, 347, 234, 's'))
		nodes.push(text(`${r.id}-prep`, 'Prep\n' + card.prep, x, 457, 234, 's'))
		pics.push({ id: r.id, x, url: r.url, src: 'data:image/jpeg;base64,' + readFileSync(join(photos, r.id + '.jpg')).toString('base64') })
	}
	return `
const pics = ${JSON.stringify(pics)}
for (const pic of pics) {
	const assetId = 'asset:thanksgiving-' + pic.id
	const id = toucan.idFor('photo-' + pic.id)
	if (editor.getShape(id)) continue
	editor.createAssets([{ id: assetId, typeName: 'asset', type: 'image', meta: {}, props: { name: pic.id + '.jpg', src: pic.src, w: 640, h: 400, mimeType: 'image/jpeg', isAnimated: false } }])
	editor.createShape({ id, type: 'image', parentId: editor.getCurrentPageId(), x: pic.x, y: 107, props: { assetId, w: 224, h: 140, url: pic.url }, meta: { key: 'photo-' + pic.id } })
}
await toucan.applyGraph(${JSON.stringify(graph(nodes))})
return { recipes: pics.length }
`
}

const clock = (value) => {
	assert.match(value, /^(1[0-8]):[0-5][0-9]$/)
	const [h, m] = value.split(':').map(Number)
	return h * 60 + m
}
const shown = (value) => {
	const [h,m] = value.split(':').map(Number)
	return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')}`
}

export function scheduleCode(plan) {
	const specs = { turkey: [325, 180], dressing: [350, 65], rolls: [375, 24] }
	const oven = ['turkey', 'dressing', 'rolls'].map((id) => {
		const event = plan.oven.find((item) => item.id === id)
		assert.ok(event, `Missing ${id}`)
		const [temp, minutes] = specs[id]
		assert.equal(event.temp, temp)
		assert.ok(clock(event.end) - clock(event.start) >= minutes, `Too little time for ${id}`)
		return event
	})
	assert.equal(plan.oven.length, oven.length)
	for (let i = 1; i < oven.length; i++) {
		assert.ok(clock(oven[i].start) - clock(oven[i - 1].end) >= 8, 'Allow at least eight minutes for an oven change')
	}
	assert.ok(clock(oven.at(-1).end) <= 17 * 60 + 55, 'Leave five minutes before dinner')
	for (const name of ['dayBefore', 'morning', 'serve']) assert.ok(typeof plan[name] === 'string' && plan[name].length >= 22 && plan[name].length <= 140, name)
	const sal = plan.salad
	assert.ok(clock(sal.start) >= 17 * 60 + 20 && clock(sal.end) <= 18 * 60 && clock(sal.end) > clock(sal.start))
	const origin = clock(oven[0].start)
	const px = (value) => 160 + (clock(value) - origin) / (18 * 60 - origin) * 1020
	const names = { turkey: 'Turkey', dressing: 'Dressing', rolls: 'Rolls' }
	const y = 760
	const nodes = [
		text('schedule-title', 'Dinner at 6:00', 0, y, 1150, 'xl'),
		text('schedule-summary', 'One main oven · three temperatures · salad and sauce off the oven clock', 0, y + 58, 1200, 'm'),
		text('schedule-oven', 'Main oven', 0, y + 183, 150, 'm'),
		text('schedule-prep', 'Counter', 0, y + 284, 150, 'm'),
		text('schedule-day-before', 'Day before\n' + plan.dayBefore, 0, y + 390, 375, 's'),
		text('schedule-morning', 'Earlier that day\n' + plan.morning, 415, y + 390, 385, 's'),
		text('schedule-serve', 'Rest, hold & serve\n' + plan.serve, 830, y + 390, 355, 's'),
	]
	for (const [i, event] of oven.entries()) {
		const left = px(event.start)
		nodes.push(text(`schedule-clock-${event.id}`, shown(event.start), left, y + 128, 100, 's'))
		nodes.push(box(`schedule-${event.id}`, names[event.id], left, y + 176, px(event.end) - left, 65, colors[i], 's', { detail: `${shown(event.start)}–${shown(event.end)} at ${event.temp}°F.` }))
	}
	const ovenLine = oven.map((event) => `${shown(event.start)} ${names[event.id]} ${event.temp}°F`).join('   →   ')
	nodes.push(text('schedule-temperatures', ovenLine, 160, y + 248, 1025, 'm'))
	nodes.push(text('schedule-transitions', `Oven adjustments: ${oven.slice(1).map((event, i) => `${shown(oven[i].end)} → ${event.temp}°F`).join('   ·   ')}`, 160, y + 336, 1030, 's'))
	nodes.push(text('schedule-salad', `${shown(sal.start)}–${shown(sal.end)}   Toss salad while the oven is busy`, 160, y + 290, 1020, 'm', 'green'))
	return `await toucan.applyGraph(${JSON.stringify(graph(nodes))}); return ${JSON.stringify(plan)}`
}
