#!/usr/bin/env node
// An example plan source for toucan: one file, no dependencies, made-up data. Copy it, rename it
// `toucan-source-NAME`, and replace what's between the lines marked "your system" with calls to yours.
//
// Try it as it is:
//   cp examples/toucan-source-example.mjs ~/.local/bin/toucan-source-example && chmod +x ~/.local/bin/toucan-source-example
//   toucan plugins                                   # is it found? if not, this says why
//   toucan sources                                   # the plans it lists
//   toucan new demo --plan example demo/garden --views board,gantt
//
// The protocol (website/content/extending.md has all of it): JSON on stdout and exit 0; on failure a non-zero exit and
// {"error": CODE, "message": TEXT} on stderr, CODE one of not_found, invalid, conflict, forbidden, unavailable.
//
//   describe                       -> {"name", "description", "version"}          (optional)
//   list                           -> {"sources": [{"ref", "title", "description"?}]}
//   read REF                       -> a plan: {"plan": 1, "source", "cursor", "fields", "items"}
//   changes REF --after CURSOR     -> {"cursor", "changed"}                        (cheap: toucan asks every few seconds)
//   write REF   < {"changes": []}  -> {"cursor", "results": [{"mutation", "ok", "item"} | {"mutation", "ok": false, "error", "message", "item"?}]}

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fail = (error, message) => {
	console.error(JSON.stringify({ error, message }))
	process.exit(1)
}
const answer = (value) => console.log(JSON.stringify(value))

// ---- your system ----------------------------------------------------------------------------------------------------------
// Here it is a JSON file (TOUCAN_SOURCE_EXAMPLE_FILE, or one in the temp folder), seeded with two small projects. `rev`
// counts writes, and is the cursor.
const FILE = process.env.TOUCAN_SOURCE_EXAMPLE_FILE || join(tmpdir(), 'toucan-source-example.json')
const FIELDS = [
	{ id: 'title', label: 'Title', type: 'text', writable: true },
	{ id: 'stage', label: 'Stage', type: 'option', writable: true, options: [{ id: 'todo', label: 'To do', color: 'grey' }, { id: 'doing', label: 'Doing', color: 'blue' }, { id: 'done', label: 'Done', color: 'green', done: true }] },
	// Fields of this system's own: toucan groups by, shows and writes any field declared here.
	{ id: 'bed', label: 'Bed', type: 'option', writable: true, options: [{ id: 'north', label: 'North bed', color: 'orange' }, { id: 'south', label: 'South bed', color: 'violet' }, { id: 'pots', label: 'Pots', color: 'light-blue' }] },
	{ id: 'hours', label: 'Hours', type: 'number', writable: true },
	{ id: 'start', label: 'Start', type: 'date', writable: true },
	{ id: 'end', label: 'End', type: 'date', writable: true },
]
const seed = () => ({
	rev: 1,
	seen: {},
	projects: {
		'demo/garden': {
			title: 'Spring garden',
			readonly: false,
			items: [
				{ id: 'g1', version: 1, title: 'Clear the north bed', stage: 'done', bed: 'north', hours: 3, start: '2027-03-01', end: '2027-03-03' },
				{ id: 'g2', version: 1, title: 'Order seeds', stage: 'done', hours: 1, start: '2027-03-02', end: '2027-03-02' },
				{ id: 'g3', version: 1, title: 'Sow tomatoes', stage: 'doing', bed: 'pots', hours: 2, start: '2027-03-08', end: '2027-03-10', dependsOn: ['g2'] },
				{ id: 'g4', version: 1, title: 'Build the bean frame', stage: 'todo', bed: 'north', hours: 4, start: '2027-03-15', end: '2027-03-19', dependsOn: ['g1'] },
				{ id: 'g5', version: 1, title: 'Plant out', stage: 'todo', bed: 'south', hours: 5, start: '2027-04-12', end: '2027-04-16', dependsOn: ['g3'] },
				{ id: 'g6', version: 1, title: 'Mulch everything', stage: 'todo', hours: 2 },
			],
		},
		'demo/archive': { title: 'Last year (read-only)', readonly: true, items: [{ id: 'a1', version: 1, title: 'Harvest', stage: 'done', bed: 'south', hours: 6 }] },
	},
})
const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : seed())
const save = (state) => {
	writeFileSync(`${FILE}.${process.pid}.tmp`, JSON.stringify(state, null, 2))
	renameSync(`${FILE}.${process.pid}.tmp`, FILE)
}
// ---------------------------------------------------------------------------------------------------------------------------

const [verb, ref, flag, cursor] = process.argv.slice(2)
if (verb === 'describe') answer({ name: 'Example', description: 'A made-up plan source to copy from: two small projects kept in a JSON file.', version: '1' })
else if (verb === 'list') answer({ sources: Object.entries(load().projects).map(([r, p]) => ({ ref: r, title: p.title, ...(p.readonly && { readonly: true }) })) })
else if (['read', 'changes', 'write'].includes(verb)) {
	const state = load()
	const project = state.projects[ref]
	if (!project) fail('not_found', `no project ${ref}; \`list\` says which there are`)
	if (verb === 'read') answer({ plan: 1, source: { ref, title: project.title, readonly: project.readonly }, cursor: String(state.rev), fields: FIELDS, items: project.items })
	else if (verb === 'changes') answer({ cursor: String(state.rev), changed: flag !== '--after' || cursor !== String(state.rev) })
	else {
		let input
		try {
			input = JSON.parse(readFileSync(0, 'utf8'))
		} catch {
			fail('invalid', 'write takes {"changes": [...]} on stdin')
		}
		const results = (input.changes ?? []).map((c) => {
			// The same change again (toucan retries with the same `mutation`) gets the same answer, and is applied once.
			const before = state.seen[c.mutation]
			if (before) return { ...before, ...(before.id && { item: project.items.find((it) => it.id === before.id) }), id: undefined }
			const refuse = (error, message, item) => {
				state.seen[c.mutation] = { mutation: c.mutation, ok: false, error, message, ...(item && { id: item.id }) }
				return { mutation: c.mutation, ok: false, error, message, ...(item && { item }) }
			}
			let item = c.op === 'update' ? project.items.find((it) => it.id === c.id) : null
			if (c.op === 'update' && !item) return refuse('not_found', `no item ${c.id}`)
			if (project.readonly) return refuse('forbidden', `${project.title} can't be changed`, item)
			if (item && c.version !== item.version) return refuse('conflict', `${item.title} changed upstream`, item)
			for (const [key, value] of Object.entries(c.set ?? {})) {
				const field = FIELDS.find((f) => f.id === key)
				if (!field?.writable) return refuse('invalid', `${key} can't be written`, item)
				if (value !== null && field.type === 'option' && !field.options.some((o) => o.id === value)) return refuse('invalid', `${key} has no option ${value}`, item)
			}
			if (c.op === 'create') {
				if (!c.set?.title) return refuse('invalid', 'a new item needs a title')
				item = { id: `g${state.rev}-${project.items.length + 1}`, version: 0 }
				project.items.push(item)
			}
			for (const [key, value] of Object.entries(c.set ?? {})) value === null ? delete item[key] : (item[key] = value)
			item.version++
			// `place`: directly after an item, or first. This system keeps its order as the order of the list.
			if (c.place) {
				project.items.splice(project.items.indexOf(item), 1)
				const at = 'before' in c.place ? (c.place.before === null ? project.items.length : project.items.findIndex((it) => it.id === c.place.before)) : c.place.after === null ? 0 : project.items.findIndex((it) => it.id === c.place.after) + 1
				project.items.splice(Math.max(0, at), 0, item)
			}
			state.seen[c.mutation] = { mutation: c.mutation, ok: true, id: item.id }
			return { mutation: c.mutation, ok: true, item }
		})
		state.rev++
		save(state)
		answer({ cursor: String(state.rev), results })
	}
} else fail('invalid', `unknown verb ${verb}: describe, list, read REF, changes REF --after CURSOR, write REF`)
