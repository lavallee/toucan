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
const box = (key, text, x, y, w, h, color, size = 's', meta, fill = 'semi') => ({
	key, text, box: { x, y, w, h }, style: { color, size, fill, dash: 'solid' }, meta,
})
const graph = (nodes) => ({ groups: [], nodes, edges: [] })
export const seed = graph([
	text('menu-title', 'The Thanksgiving table', 0, 0, 1300, 'xl'),
	text('menu-subtitle', 'Dinner for eight. Five recipes to bring to the table.', 0, 57, 1300, 'm'),
])

export function menuCode(cards) {
	assert.deepEqual(cards.map(({ id }) => id).sort(), recipes.map(({ id }) => id).sort())
	const nodes = [], pics = []
	for (const [i, r] of recipes.entries()) {
		const card = cards.find(({ id }) => id === r.id)
		for (const field of ['ingredients', 'prep']) assert.ok(typeof card[field] === 'string' && card[field].length > 15 && card[field].length <= 130, `${r.id}: ${field}`)
		const x = i * 280
		const refs = [{ label: `Open recipe at ${r.source}`, ref: r.url }]
		nodes.push(box(`card-${r.id}`, '', x, 108, 260, 485, colors[i], 's', undefined, 'none'))
		nodes.push(text(`recipe-${r.id}`, r.title, x + 14, 274, 232, 'm', 'black', { refs, detail: `${card.ingredients}\n\n${card.prep}` }))
		nodes.push(text(`${r.id}-source`, r.source + ' ↗', x + 14, 313, 232, 's', 'black', { refs }))
		nodes.push(text(`${r.id}-ingredients-label`, 'Ingredients', x + 14, 356, 232, 's', colors[i]))
		nodes.push(text(`${r.id}-ingredients`, card.ingredients, x + 14, 383, 232, 's'))
		nodes.push(text(`${r.id}-prep-label`, 'Prep', x + 14, 467, 232, 's', colors[i]))
		nodes.push(text(`${r.id}-prep`, card.prep, x + 14, 494, 232, 's'))
		pics.push({ id: r.id, x, url: r.url, src: 'data:image/jpeg;base64,' + readFileSync(join(photos, r.id + '.jpg')).toString('base64') })
	}
	return `
await toucan.applyGraph(${JSON.stringify(graph(nodes))})
const pics = ${JSON.stringify(pics)}
for (const pic of pics) {
	const assetId = 'asset:thanksgiving-' + pic.id
	const id = toucan.idFor('photo-' + pic.id)
	if (editor.getShape(id)) continue
	editor.createAssets([{ id: assetId, typeName: 'asset', type: 'image', meta: {}, props: { name: pic.id + '.jpg', src: pic.src, w: 640, h: 400, mimeType: 'image/jpeg', isAnimated: false } }])
	editor.createShape({ id, type: 'image', parentId: editor.getCurrentPageId(), x: pic.x + 10, y: 118, props: { assetId, w: 240, h: 150, url: pic.url }, meta: { key: 'photo-' + pic.id } })
}
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

	const dinner = 18 * 60
	const stages = {
		dressingPrep: ['Assemble dressing', 'prep', 'orange'],
		dough: ['Mix & rise', 'prep', 'yellow'],
		proof: ['Shape & proof', 'prep', 'yellow'],
		salad: ['Toss salad', 'finish', 'green'],
		hold: ['Rest & hold turkey', 'finish', 'orange'],
		table: ['Table & drinks', 'host', 'violet'],
		welcome: ['Welcome guests', 'host', 'violet'],
		carve: ['Carve & plate', 'host', 'red'],
	}
	const tasks = Object.entries(stages).map(([id, [label, lane, color]]) => {
		const task = plan.tasks.find((item) => item.id === id)
		assert.ok(task, `Missing ${id}`)
		const start = clock(task.start), end = clock(task.end)
		assert.ok(start < end && end <= dinner, `Invalid window for ${id}`)
		return { id, label, lane, color, start, end }
	})
	const get = (id) => tasks.find((event) => event.id === id)
	assert.equal(plan.tasks.length, tasks.length)
	assert.ok(get('dressingPrep').end <= clock(oven[1].start), 'Assemble the dressing before baking')
	assert.ok(get('dough').end - get('dough').start >= 75, 'Allow time to mix the dough and finish its first rise')
	assert.ok(get('proof').start - get('dough').end >= 0 && get('proof').start - get('dough').end <= 15, 'Shape after the first rise')
	assert.ok(get('proof').end - get('proof').start >= 35 && get('proof').end - get('proof').start <= 55, 'Allow 35–55 minutes to shape and proof the rolls')
	assert.ok(clock(oven[2].start) - get('proof').end >= 0 && clock(oven[2].start) - get('proof').end <= 10, 'Bake the rolls soon after the final proof')
	assert.ok(get('salad').start >= 17 * 60 + 20, 'Toss the salad late')
	assert.equal(get('hold').start, clock(oven[0].end), 'Rest and hold start at turkey removal')
	assert.ok(get('hold').end >= get('carve').start, 'Hold the turkey until carving')
	assert.equal(get('carve').end, dinner, 'Plate for dinner at six')
	for (const lane of ['prep', 'finish', 'host']) {
		const row = tasks.filter((task) => task.lane === lane).sort((a, b) => a.start - b.start)
		// Turkey holding is passive and can overlap salad prep.
		const active = row.filter((task) => task.id !== 'hold')
		for (let i = 1; i < active.length; i++) assert.ok(active[i - 1].end <= active[i].start, `Overlap in ${lane}`)
	}
	const origin = Math.min(clock(oven[0].start), ...tasks.map((task) => task.start))
	const startHour = Math.floor(origin / 60) * 60
	const px = (minute) => 165 + (minute - startHour) / (dinner - startHour) * 1175
	const display = (minute) => shown(`${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`)
	const names = { turkey: 'Turkey', dressing: 'Dressing', rolls: 'Rolls' }
	const y = 910
	const rows = { oven: 143, prep: 305, finish: 387, host: 504 }
	const laneLabels = { oven: 'Main oven', prep: 'Prep counter', finish: 'Finishing', host: 'Hosting' }
	const laneColors = { oven: 'orange', prep: 'yellow', finish: 'green', host: 'violet' }
	const nodes = [
		text('schedule-title', 'Dinner at six', 0, y, 1300, 'xl'),
		text('schedule-summary', 'One main oven. Prep, cooking and hosting on the same clock.', 0, y + 60, 1300, 'm'),
	]
	for (const [lane, row] of Object.entries(rows)) {
		nodes.push(text(`schedule-lane-${lane}`, laneLabels[lane], 0, y + row + 9, 158, 's', laneColors[lane]))
	}
	for (let tick = startHour; tick <= dinner; tick += 60) {
		const x = px(tick)
		nodes.push(text(`hour-${tick}`, display(tick), x - 12, y + 101, 65, 's', tick === dinner ? 'red' : 'grey'))
	}
	for (const [i, event] of oven.entries()) {
		const start = clock(event.start), end = clock(event.end), width = px(end) - px(start)
		nodes.push(box(`schedule-${event.id}`, width >= 100 ? `${names[event.id]}
${event.temp}°F` : width >= 72 ? names[event.id] : '', px(start), y + rows.oven, width, 84, colors[i], 's', { detail: `${shown(event.start)}–${shown(event.end)} at ${event.temp}°F.` }, 'solid'))
		if (i > 0) {
			const change = clock(oven[i - 1].end)
			nodes.push(box(`schedule-heat-${event.id}`, '', px(change), y + rows.oven, px(start) - px(change), 84, 'grey', 's', { detail: `At ${display(change)}, set the oven to ${event.temp}°F and let it come to temperature.` }, 'pattern'))
		}
	}
	const ovenLine = oven.map((event) => `${shown(event.start)}–${shown(event.end)}  ${names[event.id]} ${event.temp}°F`).join('    /    ')
	nodes.push(text('schedule-temperatures', ovenLine, 165, y + 232, 1230, 's'))
	nodes.push(text('schedule-transitions', `Preheat to 325°F before ${shown(oven[0].start)}   ·   ${oven.slice(1).map((event, i) => `${shown(oven[i].end)} → ${event.temp}°F`).join('   ·   ')}`, 165, y + 264, 1230, 's', 'orange'))
	for (const task of tasks) {
		const x = px(task.start), width = px(task.end) - x
		const subrow = task.id === 'salad' ? 41 : 0
		const yy = y + rows[task.lane] + subrow
		nodes.push(box(`schedule-task-${task.id}`, '', x, yy, width, 32, task.color, 's', { detail: `${task.label}, ${display(task.start)}–${display(task.end)}` }, 'solid'))
	}
	const summary = (lane) => tasks.filter((task) => task.lane === lane).sort((a,b) => a.start - b.start).map((task) => `${display(task.start)}–${display(task.end)} ${task.label}`).join('   ·   ')
	nodes.push(text('schedule-prep-cues', summary('prep'), 165, y + 344, 1230, 's'))
	nodes.push(text('schedule-finish-cues', summary('finish'), 165, y + 464, 1175, 's'))
	nodes.push(text('schedule-host-cues', summary('host'), 165, y + 542, 1230, 's'))
	nodes.push(text('schedule-day-before', 'Day before\n' + plan.dayBefore, 0, y + 606, 430, 's'))
	nodes.push(text('schedule-morning', 'Before the timeline\n' + plan.morning, 470, y + 606, 415, 's'))
	nodes.push(text('schedule-serve', 'At the table\n' + plan.serve, 940, y + 606, 420, 's'))
	return `await toucan.applyGraph(${JSON.stringify(graph(nodes))}); return ${JSON.stringify(plan)}`
}
