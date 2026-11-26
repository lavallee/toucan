// Plans: views of a system of record, drawn on a canvas and read back from it. Pure: no browser, no server.
//
// A *plan* (`toucan.plan/1`) is what a source says a project is: declared fields, and items in rank order. A *view* is a
// small spec from a fixed catalog (board, gantt, timeline, graph, table) that names fields of that plan and never holds
// values of its own. `render` draws a view as a toucan graph (lib/tg.mjs) of native shapes, each managed one carrying
// `meta.plan`; `changesFrom` is its inverse: given what was drawn and what the canvas holds now, it names the field
// changes a person's gestures meant (card into a column = set the grouped field; bar stretched = set start and end).
// The same rules serve the built-in file source (`applyChanges`), so a plan is usable with nothing else installed.

import { boxFor, sizedNode, snap } from './boxes.mjs'
import { layOut } from './layouts.mjs'
import { STYLE_VALUES } from './tg.mjs'

// ---- the plan -------------------------------------------------------------------------------------------------------------

export const FIELD_TYPES = ['text', 'option', 'options', 'date', 'number', 'bool']
/** Item fields every source may give without declaring them. Only declared fields are shown, grouped by or written. */
export const WELL_KNOWN = ['id', 'version', 'title', 'detail', 'stage', 'assignee', 'start', 'end', 'priority', 'labels', 'dependsOn', 'parent', 'milestone', 'done', 'estimate', 'url']
export const ERROR_CODES = ['not_found', 'invalid', 'conflict', 'forbidden', 'unavailable']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const VIEW_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i

export class PlanError extends Error {
	constructor(code, message) {
		super(message)
		this.code = code
	}
}

/** A plan as a source gave it, checked and with the gaps filled, or a PlanError('invalid') saying what's wrong with it. */
export function checkPlan(raw) {
	const bad = (msg) => {
		throw new PlanError('invalid', `not a plan: ${msg}`)
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('expected a JSON object with "plan": 1, "fields" and "items"')
	if (raw.plan !== 1) bad(`"plan" is ${JSON.stringify(raw.plan)}; this toucan reads "plan": 1`)
	if (!Array.isArray(raw.items)) bad('"items" must be a list')
	const fields = Array.isArray(raw.fields) && raw.fields.length ? raw.fields : [{ id: 'title', label: 'Title', type: 'text', writable: true }]
	const seenField = new Set()
	for (const f of fields) {
		if (!f || typeof f.id !== 'string' || !f.id) bad('every field needs an "id"')
		if (seenField.has(f.id)) bad(`field "${f.id}" is declared twice`)
		seenField.add(f.id)
		if (!FIELD_TYPES.includes(f.type)) bad(`field "${f.id}" has type ${JSON.stringify(f.type)}; types: ${FIELD_TYPES.join(', ')}`)
		// `items: true`: the options are the plan's own items (a parent, an epic, a milestone), and needn't be listed twice.
		if ((f.type === 'option' || f.type === 'options') && !Array.isArray(f.options) && f.items !== true) bad(`field "${f.id}" is an ${f.type} field and needs "options"`)
		for (const o of f.options ?? []) if (!o || (typeof o.id !== 'string' && typeof o.id !== 'number')) bad(`an option of "${f.id}" has no "id"`)
	}
	const seen = new Set()
	const items = raw.items.map((it, i) => {
		if (!it || typeof it !== 'object') bad(`item ${i} is not an object`)
		const id = it.id === undefined || it.id === null ? '' : String(it.id)
		if (!id) bad(`item ${i} has no "id"`)
		if (seen.has(id)) bad(`two items have the id "${id}"`)
		seen.add(id)
		return { ...it, id, version: it.version ?? 1, title: String(it.title ?? id) }
	})
	return {
		plan: 1,
		source: { ref: '', title: 'Plan', description: '', readonly: false, ...(raw.source && typeof raw.source === 'object' ? raw.source : {}) },
		cursor: raw.cursor === undefined || raw.cursor === null ? '' : String(raw.cursor),
		fields: fields.map((f) => {
			const out = { label: f.id, writable: false, ...f }
			if (Array.isArray(f.options)) out.options = f.options.map((o) => ({ ...o, id: String(o.id) }))
			else if (f.items === true) {
				// The items something points at, in the plan's order.
				const used = new Set(items.flatMap((it) => [it[f.id]].flat().filter((v) => v !== undefined && v !== null).map(String)))
				out.options = items.filter((it) => used.has(it.id)).map((it) => ({ id: it.id, label: it.title }))
			}
			return out
		}),
		items,
	}
}

export const fieldOf = (plan, id) => (plan?.fields ?? []).find((f) => f.id === id)
const optionOf = (field, value) => (field?.options ?? []).find((o) => o.id === value)
const unset = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)

/** Finished: the item says so, or one of its option values is an option marked `done`. */
export function isDone(plan, item) {
	if (typeof item.done === 'boolean') return item.done
	return (plan.fields ?? []).some((f) => f.type === 'option' && optionOf(f, item[f.id])?.done === true)
}

// ---- dates ----------------------------------------------------------------------------------------------------------------

const DAY = 86400000
export const dayNum = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY)
export const isoOf = (n) => new Date(n * DAY).toISOString().slice(0, 10)
const validDate = (v) => typeof v === 'string' && ISO_DATE.test(v) && isoOf(dayNum(v)) === v
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`
export const todayIso = () => {
	const d = new Date()
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---- values ---------------------------------------------------------------------------------------------------------------

/** A value as people read it. */
export function formatValue(field, value, { long = false } = {}) {
	if (unset(value)) return ''
	if (!field) return Array.isArray(value) ? value.join(', ') : String(value)
	if (field.type === 'option') return optionOf(field, value)?.label ?? String(value)
	if (field.type === 'options') return [value].flat().map((v) => optionOf(field, v)?.label ?? String(v)).join(', ')
	if (field.type === 'date') return validDate(value) ? (long ? `${shortDate(value)}, ${value.slice(0, 4)}` : shortDate(value)) : String(value)
	if (field.type === 'bool') return value ? 'yes' : 'no'
	return String(value)
}

/** Why a value can't go in a field, or null. Used before writing, and by the file source. */
export function valueProblem(field, value) {
	if (value === null) return null
	const options = () => field.options.map((o) => (o.label && o.label !== o.id ? `${o.id} (${o.label})` : o.id)).join(', ')
	if (field.type === 'text') return typeof value === 'string' ? null : `${field.id} takes text`
	if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value) ? null : `${field.id} takes a number`
	if (field.type === 'bool') return typeof value === 'boolean' ? null : `${field.id} takes true or false`
	if (field.type === 'date') return validDate(value) ? null : `${field.id} takes a date as YYYY-MM-DD, not ${JSON.stringify(value)}`
	if (field.type === 'option') return optionOf(field, value) ? null : `${field.id} has no option ${JSON.stringify(value)}; options: ${options()}`
	if (field.type === 'options') {
		if (!Array.isArray(value)) return `${field.id} takes a list of options`
		const missing = value.find((v) => !optionOf(field, v))
		return missing === undefined ? null : `${field.id} has no option ${JSON.stringify(missing)}; options: ${options()}`
	}
	return `${field.id} has an unknown type`
}

/** Text someone typed (a CLI argument, a table cell) as a value of a field. An option may be named by id or by label. */
export function coerceValue(plan, fieldId, raw) {
	const field = fieldOf(plan, fieldId)
	if (!field) throw new PlanError('invalid', `no field "${fieldId}"; fields: ${plan.fields.map((f) => f.id).join(', ')}`)
	const text = String(raw ?? '').trim()
	if (!text || /^(null|none|unset|—|-)$/i.test(text)) return null
	const option = (t) => {
		const o = field.options.find((x) => x.id === t) ?? field.options.find((x) => String(x.label ?? '').toLowerCase() === t.toLowerCase() || x.id.toLowerCase() === t.toLowerCase())
		if (!o) throw new PlanError('invalid', valueProblem(field, t))
		return o.id
	}
	let value = text
	if (field.type === 'option') value = option(text)
	else if (field.type === 'options') value = text.split(',').map((t) => t.trim()).filter(Boolean).map(option)
	else if (field.type === 'number') value = Number(text)
	else if (field.type === 'bool') value = /^(true|yes|y|1)$/i.test(text) ? true : /^(false|no|n|0)$/i.test(text) ? false : text
	else if (field.type === 'date' && text.toLowerCase() === 'today') value = todayIso()
	const problem = valueProblem(field, value)
	if (problem) throw new PlanError('invalid', problem)
	return value
}

// ---- filter and sort ------------------------------------------------------------------------------------------------------

export const FILTER_OPS = ['eq', 'ne', 'in', 'contains', 'lt', 'gt', 'exists']
const valueOf = (plan, item, field) => (field === 'done' ? isDone(plan, item) : item[field])

/**
 * A filter in its one full form: { field, op, value }, { and: [...] } or { or: [...] }. The shorthand { done: false, stage: 'doing' }
 * means every pair holds (a list means "one of").
 */
export function normalizeFilter(f) {
	if (f === undefined || f === null) return null
	if (typeof f === 'string') return parseFilter(f)
	if (Array.isArray(f)) return { and: f.map(normalizeFilter) }
	if (typeof f !== 'object') throw new PlanError('invalid', `a filter is { field, op, value }, { and: [...] }, { or: [...] } or a shorthand like { "done": false }; got ${JSON.stringify(f)}`)
	if ('and' in f || 'or' in f) {
		const key = 'and' in f ? 'and' : 'or'
		if (!Array.isArray(f[key])) throw new PlanError('invalid', `filter "${key}" takes a list of filters`)
		return { [key]: f[key].map(normalizeFilter) }
	}
	if ('field' in f) return { field: String(f.field), op: f.op ?? (Array.isArray(f.value) ? 'in' : 'eq'), ...('value' in f && { value: f.value }) }
	const parts = Object.entries(f).map(([field, value]) => ({ field, op: Array.isArray(value) ? 'in' : 'eq', value }))
	return parts.length === 1 ? parts[0] : { and: parts }
}

/**
 * A filter as text, for the command line: `stage=doing`, `stage!=done`, `assignee in p1,p2`, `title~sitemap`, `end<2026-12-01`,
 * `start>2026-11-01`, `labels?` (is set), `!labels` (isn't), joined by `and` or by `or` (not both: write JSON for that).
 */
export function parseFilter(text) {
	const src = String(text).trim()
	if (!src) return null
	if (src.startsWith('{') || src.startsWith('[')) {
		try {
			return normalizeFilter(JSON.parse(src))
		} catch (e) {
			if (e instanceof PlanError) throw e
			throw new PlanError('invalid', `the filter looks like JSON but doesn't parse: ${e.message}`)
		}
	}
	const hasAnd = /\s+and\s+/i.test(src), hasOr = /\s+or\s+/i.test(src)
	if (hasAnd && hasOr) throw new PlanError('invalid', 'a text filter joins its parts with "and" or with "or", not both; write it as JSON: {"or": [{"and": [...]}, ...]}')
	const term = (t) => {
		const s = t.trim()
		const scalar = (v) => (v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : v)
		let m
		if ((m = /^!\s*([\w.-]+)$/.exec(s))) return { field: m[1], op: 'exists', value: false }
		if ((m = /^([\w.-]+)\s*\?$/.exec(s))) return { field: m[1], op: 'exists', value: true }
		if ((m = /^([\w.-]+)\s+in\s+(.+)$/i.exec(s))) return { field: m[1], op: 'in', value: m[2].split(',').map((v) => v.trim()).filter(Boolean) }
		if ((m = /^([\w.-]+)\s*(!=|=|~|<|>)\s*(.*)$/.exec(s))) return { field: m[1], op: { '!=': 'ne', '=': 'eq', '~': 'contains', '<': 'lt', '>': 'gt' }[m[2]], value: scalar(m[3].trim()) }
		throw new PlanError('invalid', `can't read the filter "${s}"; forms: field=value, field!=value, field in a,b, field~text, field<value, field>value, field? (is set), !field (isn't)`)
	}
	const parts = src.split(/\s+(?:and|or)\s+/i).map(term)
	return parts.length === 1 ? parts[0] : { [hasOr ? 'or' : 'and']: parts }
}

function filterProblems(plan, filter, out = []) {
	if (!filter) return out
	if (filter.and || filter.or) {
		for (const f of filter.and ?? filter.or) filterProblems(plan, f, out)
		return out
	}
	if (!FILTER_OPS.includes(filter.op)) out.push(`filter op "${filter.op}" isn't one of ${FILTER_OPS.join(', ')}`)
	if (!plan) return out
	const field = fieldOf(plan, filter.field)
	if (!field && !WELL_KNOWN.includes(filter.field)) out.push(`filter names the field "${filter.field}", which this plan doesn't have; fields: ${fieldIds(plan).join(', ')}`)
	if (field?.type === 'option' && ['eq', 'ne', 'in'].includes(filter.op)) {
		for (const v of [filter.value].flat()) if (v !== null && !optionOf(field, v)) out.push(`filter: ${valueProblem(field, v)}`)
	}
	return out
}
const fieldIds = (plan) => [...new Set([...plan.fields.map((f) => f.id), 'done'])]

/** Does an item pass a (normalized) filter? */
export function matches(plan, item, filter) {
	if (!filter) return true
	if (filter.and) return filter.and.every((f) => matches(plan, item, f))
	if (filter.or) return filter.or.some((f) => matches(plan, item, f))
	const v = valueOf(plan, item, filter.field), want = filter.value
	const has = (x) => (Array.isArray(v) ? v.includes(x) : unset(v) ? unset(x) : v === x || String(v) === String(x))
	switch (filter.op) {
		case 'eq': return has(want)
		case 'ne': return !has(want)
		case 'in': return [want].flat().some(has)
		case 'contains': return Array.isArray(v) ? v.includes(want) : String(v ?? '').toLowerCase().includes(String(want ?? '').toLowerCase())
		case 'lt': return !unset(v) && v < want
		case 'gt': return !unset(v) && v > want
		case 'exists': return unset(v) === (want === false)
		default: return true
	}
}

/** `stage,-end` or ["stage", "-end"] as [{ field, desc }]. */
export function normalizeSort(sort) {
	if (unset(sort)) return []
	const list = typeof sort === 'string' ? sort.split(',') : sort
	if (!Array.isArray(list)) throw new PlanError('invalid', 'sort is a list of field ids, each with "-" in front to reverse it: ["stage", "-end"]')
	return list.map((s) => (typeof s === 'object' && s ? { field: String(s.field), desc: !!s.desc } : { field: String(s).trim().replace(/^[-+]/, ''), desc: String(s).trim().startsWith('-') })).filter((s) => s.field)
}

/** The items a view shows, in the order it shows them: the source's rank order unless the view sorts. */
export function select(plan, view) {
	const filter = normalizeFilter(view.filter), sort = normalizeSort(view.sort)
	const items = plan.items.filter((it) => matches(plan, it, filter))
	if (!sort.length) return items
	const rank = new Map(plan.items.map((it, i) => [it.id, i]))
	const key = (it, s) => {
		const field = fieldOf(plan, s.field), v = valueOf(plan, it, s.field)
		if (unset(v)) return null
		if (field?.type === 'option') {
			const i = field.options.findIndex((o) => o.id === v)
			return i < 0 ? null : i
		}
		return typeof v === 'boolean' ? Number(v) : Array.isArray(v) ? v.join(',') : v
	}
	return [...items].sort((a, b) => {
		for (const s of sort) {
			const x = key(a, s), y = key(b, s)
			if (x === y) continue
			if (x === null) return 1 // unset goes last, either way round
			if (y === null) return -1
			return (x < y ? -1 : 1) * (s.desc ? -1 : 1)
		}
		return rank.get(a.id) - rank.get(b.id)
	})
}

// ---- the view catalog -----------------------------------------------------------------------------------------------------
// One schema: validation, defaults and the text agents read all come from it, so they can't drift apart.

const COMMON = {
	id: { type: 'id', about: 'the view\'s name on this canvas (letters, digits, - and _); its shapes are keyed plan:<id>:…' },
	title: { type: 'text', about: 'the frame\'s title; left out, it is made from the plan and the view' },
	filter: { type: 'filter', about: 'which items to show: {"done": false}, {"field": "end", "op": "lt", "value": "2026-12-01"}, {"and": [...]}, {"or": [...]}' },
	sort: { type: 'sort', about: 'field ids, "-" in front to reverse: ["priority", "-end"]; left out, the source\'s own order' },
	fields: { type: 'fields', about: 'fields shown as a short second line on each card' },
	color: { type: 'field', of: ['option'], none: true, about: 'the option field whose colours colour the cards, or "none"', fallback: (plan) => (fieldOf(plan, 'stage')?.type === 'option' ? 'stage' : 'none') },
}
const firstOption = (plan) => (fieldOf(plan, 'stage')?.type === 'option' ? 'stage' : plan.fields.find((f) => f.type === 'option')?.id)

export const KINDS = {
	board: {
		title: 'Board',
		about: 'A kanban board: one column per option of a field, cards in the source\'s order.',
		gestures: ['a card moved into another column sets the grouped field', 'with lanes, a card moved into another row sets that field too', 'a card moved up or down its column places it after the card above (when the view has no sort)', 'a card\'s text edited sets the title', 'a box drawn in a column, with text, creates an item there'],
		options: {
			groupBy: { type: 'field', of: ['option'], required: true, about: 'the option field whose options are the columns', fallback: firstOption },
			lanes: { type: 'field', of: ['option'], none: true, about: 'a second option field whose options are rows across the columns (swimlanes), or "none"', fallback: () => 'none' },
			rollup: { type: 'rollup', about: 'what each column header adds up: "count", "done" (percent finished), "sum:FIELD" for a number field; a list for several, [] for none', fallback: () => ['count'] },
			hideEmpty: { type: 'bool', about: 'leave out columns (and lanes) with no cards', fallback: () => false },
		},
	},
	gantt: {
		title: 'Gantt',
		about: 'Bars exactly as long as start to end along a date axis (a title that does not fit its bar stands beside it), packed into rows, optionally in one lane per option of a field. An item with one date, or marked a milestone, is a diamond; undated items wait in an "Unscheduled" strip. Grouped by a field whose options are items (a parent, an epic), each lane is headed by a bar spanning its children.',
		gestures: ['a bar moved sideways shifts start and end by whole days', 'a bar stretched or shrunk sets start or end', 'a bar moved to another lane sets the grouped field', 'a card dragged from Unscheduled onto the chart starts on that day (a bar dragged into Unscheduled goes back where it was: clear dates in the Details card or with `plan set ITEM start= end=`)', 'a bar\'s text, or the title standing beside it, edited sets the title'],
		options: {
			groupBy: { type: 'field', of: ['option'], none: true, about: 'an option field whose options are the lanes, or "none" for one chart', fallback: () => 'none' },
			scale: { type: 'enum', values: ['auto', 'day', 'week', 'month'], about: 'how much room a day gets (40, 16 or 5 px); auto picks what lets the typical bar hold a title', fallback: () => 'auto' },
			from: { type: 'date', about: 'first day on the axis (YYYY-MM-DD); left out, the earliest date shown' },
			to: { type: 'date', about: 'last day on the axis; left out, the latest date shown' },
			dependencies: { type: 'bool', about: 'draw an arrow from each item to the ones that depend on it', fallback: () => false },
			days: { type: 'number', about: 'how many days an item dragged out of Unscheduled gets when it has no estimate (with one: a day for every 8 hours of it)', fallback: () => 1 },
			rollup: { type: 'rollup', about: 'what each lane header adds up: "count", "done" (percent finished), "sum:FIELD" for a number field; a list for several', fallback: () => [] },
		},
	},
	timeline: {
		title: 'Timeline',
		about: 'Dated items in date order, each with its date. Undated items are left out.',
		gestures: ['a card\'s text edited sets the title'],
		options: {
			date: { type: 'field', of: ['date'], about: 'the date field to order by', fallback: (plan) => (fieldOf(plan, 'end')?.type === 'date' ? 'end' : plan.fields.find((f) => f.type === 'date')?.id), required: true },
			perRow: { type: 'number', about: 'cards across before it wraps', fallback: () => 6 },
		},
	},
	graph: {
		title: 'Dependencies',
		about: 'A box per item and an arrow from each item to the ones that depend on it (dependsOn), laid out as a flow.',
		gestures: ['a box\'s text edited sets the title'],
		options: {
			direction: { type: 'enum', values: ['RIGHT', 'DOWN'], about: 'which way the arrows run', fallback: () => 'RIGHT' },
		},
	},
	table: {
		title: 'Table',
		about: 'One row per item: its title, then a cell for each field in `fields`.',
		gestures: ['a title cell\'s text edited sets the title', 'another cell\'s text edited sets that field (an option by its label or id; a date as YYYY-MM-DD)'],
		options: {},
		fieldsAbout: 'the columns after the title',
		fieldsFallback: (plan) => ['stage', 'assignee', 'start', 'end'].filter((f) => fieldOf(plan, f)),
	},
}
const optionsOf = (kind) => ({ kind: { type: 'kind' }, ...COMMON, ...KINDS[kind].options })

/**
 * Checks a view spec against the catalog and, given the plan, against its fields. Returns { ok, errors, view }: each error says
 * what was wrong and what would be right, so whoever wrote the spec can fix it; `view` is the spec with nothing unknown in it.
 */
export function validateView(spec, plan = null) {
	const errors = []
	if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return { ok: false, errors: [`a view is an object like {"kind": "board", "groupBy": "stage"}; kinds: ${Object.keys(KINDS).join(', ')}`], view: null }
	if (!Object.hasOwn(KINDS, spec.kind)) return { ok: false, errors: [`unknown view kind ${JSON.stringify(spec.kind)}; kinds: ${Object.keys(KINDS).join(', ')}`], view: null }
	const options = optionsOf(spec.kind)
	const view = { kind: spec.kind }
	const fieldList = () => plan.fields.map((f) => f.id).join(', ')
	const fieldsOfType = (types) => plan.fields.filter((f) => types.includes(f.type)).map((f) => f.id)
	for (const [key, value] of Object.entries(spec)) {
		if (key === 'kind') continue
		const opt = options[key]
		if (!opt) {
			errors.push(`a ${spec.kind} view has no option "${key}"; options: ${Object.keys(options).filter((k) => k !== 'kind').join(', ')}`)
			continue
		}
		if (value === undefined || value === null) continue
		if (opt.type === 'id') {
			if (typeof value !== 'string' || !VIEW_ID.test(value)) errors.push(`id ${JSON.stringify(value)}: letters, digits, - and _, starting with a letter or digit, up to 40`)
		} else if (opt.type === 'text') {
			if (typeof value !== 'string') errors.push(`${key} takes text`)
		} else if (opt.type === 'bool') {
			if (typeof value !== 'boolean') errors.push(`${key} takes true or false, not ${JSON.stringify(value)}`)
		} else if (opt.type === 'number') {
			if (!Number.isInteger(value) || value < 1 || value > 50) errors.push(`${key} takes a whole number from 1 to 50, not ${JSON.stringify(value)}`)
		} else if (opt.type === 'enum') {
			if (!opt.values.includes(value)) errors.push(`${key} ${JSON.stringify(value)} isn't one of ${opt.values.join(', ')}`)
		} else if (opt.type === 'date') {
			if (!validDate(value)) errors.push(`${key} takes a date as YYYY-MM-DD, not ${JSON.stringify(value)}`)
		} else if (opt.type === 'field') {
			if (typeof value !== 'string') errors.push(`${key} takes a field id`)
			else if (value === 'none' && opt.none) {
				// fine
			} else if (plan) {
				const field = fieldOf(plan, value)
				const allowed = fieldsOfType(opt.of)
				const kinds = opt.of.join(' or ')
				if (!field) errors.push(`${key} names the field "${value}", which this plan doesn't have; ${kinds} fields: ${allowed.join(', ') || 'none'}`)
				else if (!opt.of.includes(field.type)) errors.push(`${key} "${value}" is a ${field.type} field; ${key} takes ${/^[aeiou]/.test(kinds) ? 'an' : 'a'} ${kinds} field: ${allowed.join(', ') || `this plan has none${opt.none ? ', so use "none"' : ''}`}`)
			}
		} else if (opt.type === 'rollup') {
			const list = typeof value === 'string' ? value.split(',').map((x) => x.trim()).filter(Boolean) : value
			if (!Array.isArray(list) || list.some((r) => typeof r !== 'string')) errors.push(`${key} takes "count", "done" or "sum:FIELD", or a list of them`)
			else {
				for (const r of list) {
					const sum = /^sum:(.+)$/.exec(r)
					if (r !== 'count' && r !== 'done' && !sum) errors.push(`${key} "${r}" isn't one of count, done, sum:FIELD`)
					else if (sum && plan && fieldOf(plan, sum[1])?.type !== 'number') errors.push(`${key} "${r}": ${fieldOf(plan, sum[1]) ? `${sum[1]} is a ${fieldOf(plan, sum[1]).type} field` : `this plan has no field "${sum[1]}"`}; number fields: ${fieldsOfType(['number']).join(', ') || 'none'}`)
				}
				view[key] = list
				continue
			}
		} else if (opt.type === 'fields') {
			const list = typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value
			if (!Array.isArray(list) || list.some((f) => typeof f !== 'string')) errors.push(`${key} takes a list of field ids`)
			else {
				if (plan) for (const f of list) if (!fieldOf(plan, f)) errors.push(`${key} names the field "${f}", which this plan doesn't have; fields: ${fieldList()}`)
				view[key] = list
				continue
			}
		} else if (opt.type === 'filter') {
			try {
				const filter = normalizeFilter(value)
				errors.push(...filterProblems(plan, filter))
				view.filter = filter
			} catch (e) {
				errors.push(e.message)
			}
			continue
		} else if (opt.type === 'sort') {
			try {
				const sort = normalizeSort(value)
				if (plan) for (const s of sort) if (!fieldOf(plan, s.field) && !WELL_KNOWN.includes(s.field)) errors.push(`sort names the field "${s.field}", which this plan doesn't have; fields: ${fieldList()}`)
				view.sort = sort.map((s) => (s.desc ? `-${s.field}` : s.field))
			} catch (e) {
				errors.push(e.message)
			}
			continue
		}
		view[key] = value
	}
	if (view.from && view.to && validDate(view.from) && validDate(view.to) && view.from > view.to) errors.push(`from ${view.from} is after to ${view.to}`)
	if (plan) {
		for (const [key, opt] of Object.entries(options)) {
			if (!opt.required || view[key] !== undefined) continue
			if (opt.fallback(plan) === undefined) errors.push(`a ${spec.kind} view needs ${key}, and this plan has no ${opt.of.join(' or ')} field to use: declare one in the plan's "fields"`)
		}
	}
	return { ok: !errors.length, errors, view }
}

/** A view with every option decided: what it says, else the catalog's default for this plan. */
export function resolveView(view, plan) {
	const out = { ...view }
	for (const [key, opt] of Object.entries(optionsOf(view.kind))) if (out[key] === undefined && opt.fallback) out[key] = opt.fallback(plan)
	for (const key of ['groupBy', 'color', 'lanes']) if (out[key] === 'none' || (out[key] && fieldOf(plan, out[key])?.type !== 'option')) out[key] = null
	if (out.fields === undefined) out.fields = KINDS[view.kind].fieldsFallback?.(plan) ?? []
	out.fields = out.fields.filter((f) => fieldOf(plan, f))
	out.filter = normalizeFilter(out.filter)
	out.sort = normalizeSort(out.sort)
	return out
}

/** The title a view's frame carries. */
export function viewTitle(view, plan) {
	if (view.title) return view.title
	const v = resolveView(view, plan)
	const by = v.groupBy ? ` by ${fieldOf(plan, v.groupBy)?.label ?? v.groupBy}` : ''
	return `${plan.source?.title || 'Plan'}: ${KINDS[view.kind].title}${by}`
}

/** An id for a new view: its kind, then kind-2, kind-3… */
export function freeViewId(kind, views) {
	const taken = new Set(views.map((v) => v.id))
	if (!taken.has(kind)) return kind
	for (let i = 2; ; i++) if (!taken.has(`${kind}-${i}`)) return `${kind}-${i}`
}

/** The catalog as agents read it (`toucan plan catalog`, and the chat agent's instructions). */
export function catalogText() {
	const typeText = (o) =>
		o.type === 'field' ? `${o.of.join(' or ')} field id${o.none ? ' or "none"' : ''}` : o.type === 'fields' ? 'list of field ids' : o.type === 'rollup' ? 'count | done | sum:FIELD, or a list' : o.type === 'enum' ? o.values.join(' | ') : o.type === 'date' ? 'YYYY-MM-DD' : o.type === 'bool' ? 'true | false' : o.type === 'id' ? 'name' : o.type
	const lines = [
		'A view is a small JSON object from this catalog. It names fields of the plan and holds no values of its own; toucan draws it, and redraws it when the plan changes.',
		'',
		'Every view takes:',
		...Object.entries(COMMON).map(([k, o]) => `  ${k} (${typeText(o)}): ${o.about}`),
		'',
	]
	for (const [kind, k] of Object.entries(KINDS)) {
		lines.push(`${kind}: ${k.about}`)
		for (const [name, o] of Object.entries(k.options)) lines.push(`  ${name} (${typeText(o)}${o.required ? ', needed' : ''}): ${o.about}`)
		if (k.fieldsAbout) lines.push(`  fields: ${k.fieldsAbout}`)
		lines.push(`  what a person's edits mean: ${k.gestures.join('; ')}.`)
		lines.push('')
	}
	lines.push(
		`Filters: { "field": F, "op": ${FILTER_OPS.join(' | ')}, "value": V }, joined with { "and": [...] } or { "or": [...] }. Shorthand: { "done": false, "stage": ["todo", "doing"] } (every pair holds; a list means one of). "done" is true for an item whose option is marked done.`,
		'As text on the command line: stage=doing, stage!=done, "assignee in p1,p2", title~sitemap, "end<2026-12-01", "labels?" (is set), "!labels" (isn\'t), joined by "and" or "or".',
		'Anything else a person does to a managed shape (deleting it, recolouring it, moving it somewhere that means nothing) changes nothing upstream: the next sync draws it as the plan says.',
	)
	return lines.join('\n')
}

// ---- render: a view as a toucan graph -------------------------------------------------------------------------------------

const CHAR_W = 10.5, PAD_X = 44 // lib/boxes.mjs: how much text fits a line
const DONE = '✓ '
/** An id as part of a key: only letters, digits, - and _ pass as they are, so no id can spell another shape's key. */
const esc = (id) => (id === null || id === undefined ? '.none' : String(id).replace(/[^A-Za-z0-9_-]/g, (c) => `.${c.codePointAt(0).toString(16)}.`))
/**
 * Keys: `plan:<view>` is the view's frame; everything else is `plan:<view>:<what>:<id…>`, where <what> says what it is
 * (item, col, lane, row, axis, head, cell, label, mark, frame, summary), so an item called "today" or "col:todo" is still just an item.
 */
const K = (view, what, ...ids) => (what ? `plan:${view.id}:${what}${ids.map((id) => `:${esc(id)}`).join('')}` : `plan:${view.id}`)
export const itemKey = (viewId, itemId) => K({ id: viewId }, 'item', itemId)
const colorOk = (c) => (STYLE_VALUES.color.includes(c) ? c : null)
/** Room one line of text needs in a box, with a little to spare: a title that is said to fit a bar, fits it on one line. */
const textWidth = (text) => Math.ceil(String(text).length * 9.2 + 40)

/** What a box's Details card says about an item: its own detail, then its fields. */
export function detailOf(plan, item) {
	const lines = []
	if (item.detail) lines.push(String(item.detail), '')
	for (const f of plan.fields) {
		if (f.id === 'title' || f.id === 'detail' || unset(item[f.id])) continue
		lines.push(`${f.label}: ${formatValue(f, item[f.id], { long: true })}`)
	}
	const title = (id) => plan.items.find((i) => i.id === id)?.title ?? id
	if (item.dependsOn?.length) lines.push(`Depends on: ${item.dependsOn.map(title).join(', ')}`)
	if (item.url) lines.push(String(item.url))
	return lines.join('\n').trim()
}

function context(plan, view, opts) {
	const v = resolveView(view, plan)
	const origin = { x: snap(opts.origin?.x ?? 0), y: snap(opts.origin?.y ?? 0) }
	const tg = { tg: 1, groups: [], nodes: [], edges: [] }
	const ctx = { plan, view: v, tg, origin, keys: opts.keys ?? {}, nest: opts.nest !== false, today: opts.today ?? todayIso(), titlesInBars: opts.titlesInBars !== false, root: K(v), frames: [], size: { w: 0, h: 0 }, axis: null }
	ctx.items = select(plan, v)
	ctx.colorOf = (item) => {
		if (isDone(plan, item)) return 'grey'
		const field = v.color && fieldOf(plan, v.color)
		return colorOk(optionOf(field, item[v.color])?.color) ?? 'black'
	}
	ctx.sub = (item) => subLine(plan, v, item)
	ctx.title = (item) => `${isDone(plan, item) ? DONE : ''}${item.title}`
	ctx.text = (item) => {
		const sub = ctx.sub(item)
		return sub ? `${ctx.title(item)}\n${sub}` : ctx.title(item)
	}
	ctx.keyOf = (item) => ctx.keys[item.id] ?? K(v, 'item', item.id)
	/** A managed frame, at an offset from the view's origin. */
	ctx.frame = (key, label, rel, plan_) => ctx.frames.push({ key, label, rel, plan: { view: v.id, ...plan_, dx: rel.x, dy: rel.y } })
	/** A managed box. `group` is a frame key, or null for the view's own frame. */
	ctx.node = (key, text, rel, group, style, meta) =>
		tg.nodes.push({ key, text, group: group ?? ctx.root, box: { x: origin.x + rel.x, y: origin.y + rel.y, w: rel.w, h: rel.h }, style: { color: 'black', fill: 'semi', dash: 'solid', geo: 'rectangle', size: 's', ...style }, meta })
	ctx.card = (item, rel, group, { text = ctx.text(item), geo = 'rectangle' } = {}) =>
		ctx.node(ctx.keyOf(item), text, rel, group, { color: ctx.colorOf(item), fill: isDone(plan, item) ? 'none' : 'semi', geo }, { plan: { item: item.id, view: v.id, version: item.version }, detail: detailOf(plan, item) })
	return ctx
}

/** The short second line of a card: the view's `fields`, as people read them. */
export function subLine(plan, view, item) {
	const parts = (view.fields ?? []).map((f) => formatValue(fieldOf(plan, f), item[f])).filter(Boolean)
	const line = parts.join(' · ')
	return line.length > 32 ? `${line.slice(0, 31)}…` : line
}

function finish(ctx) {
	const { tg, view, origin, plan } = ctx
	const sub = ctx.frames.length > 0
	// Excalidraw has no frames inside frames: there a view with columns or lanes has no frame of its own.
	const rooted = ctx.nest || !sub
	const axis = ctx.axis ? { axis: ctx.axis } : {}
	if (rooted) tg.groups.push({ key: ctx.root, label: viewTitle(view, plan), box: { x: origin.x, y: origin.y, w: ctx.size.w, h: ctx.size.h }, meta: { plan: { view: view.id, frame: 'root', dx: 0, dy: 0, ...axis } } })
	for (const f of ctx.frames) tg.groups.push({ key: f.key, label: f.label, ...(rooted && { parent: ctx.root }), box: { x: origin.x + f.rel.x, y: origin.y + f.rel.y, w: f.rel.w, h: f.rel.h }, meta: { plan: { ...f.plan, ...axis } } })
	if (!rooted) for (const n of tg.nodes) if (n.group === ctx.root) n.group = null
	return tg
}

const CARD_W = 220, PAD = 30, HEAD = 50

/** A header with what its items add up to: "To do (15, 40% done, 32 hours)". */
function headed(plan, view, label, items) {
	const parts = (view.rollup ?? []).map((r) => {
		if (r === 'count') return String(items.length)
		if (r === 'done') return `${items.length ? Math.round((items.filter((it) => isDone(plan, it)).length / items.length) * 100) : 0}% done`
		const field = fieldOf(plan, r.slice(4))
		const sum = items.reduce((n, it) => n + (Number(it[field?.id]) || 0), 0)
		return field ? `${Math.round(sum * 100) / 100} ${String(field.label).toLowerCase()}` : null
	}).filter(Boolean)
	return parts.length ? `${label} (${parts.join(', ')})` : label
}
/** The groups a field sorts items into: one per option, in option order, and one for unset values if there are any. */
function groupsBy(field, items) {
	const known = new Set(field.options.map((o) => o.id))
	const of = (it) => (known.has(it[field.id]) ? it[field.id] : null)
	const groups = field.options.map((o) => ({ id: o.id, label: o.label ?? o.id, items: items.filter((it) => of(it) === o.id) }))
	const loose = items.filter((it) => of(it) === null)
	if (loose.length) groups.push({ id: null, label: `No ${String(field.label ?? field.id).toLowerCase()}`, items: loose })
	return { groups, of }
}

function board(ctx) {
	const { plan, view, items } = ctx
	const field = fieldOf(plan, view.groupBy)
	if (!field) throw new PlanError('invalid', `a board needs an option field to group by, and this plan has none`)
	const COL_W = CARD_W + 60, GAP = 30, CARD_GAP = 14, BAND_GAP = 26, LABEL_W = 170
	let columns = groupsBy(field, items).groups
	if (view.hideEmpty) columns = columns.filter((c) => c.items.length)
	const laneField = view.lanes && view.lanes !== view.groupBy ? fieldOf(plan, view.lanes) : null
	const laned = laneField ? groupsBy(laneField, items) : null
	let lanes = laned ? laned.groups : [{ id: undefined, items }]
	if (laned && view.hideEmpty) lanes = lanes.filter((l) => l.items.length)
	const cardH = Math.max(64, ...items.map((it) => boxFor(ctx.text(it), CARD_W).h))
	const left = PAD + (laneField ? LABEL_W + GAP : 0)
	// Each lane is a band across every column, tall enough for its fullest cell and one card more: somewhere to drop one.
	const bands = []
	let y = HEAD + PAD
	for (const lane of lanes) {
		const most = Math.max(0, ...columns.map((c) => c.items.filter((it) => !laned || laned.of(it) === lane.id).length))
		const h = Math.max(laneField ? cardH : 200, (most + 1) * (cardH + CARD_GAP) - CARD_GAP)
		bands.push({ id: lane.id ?? null, y0: y, y1: y + h })
		// The row's name stands at the top of its band, and is where the band is read from when the canvas is read back.
		if (laneField) ctx.node(K(view, 'row', lane.id), headed(plan, view, lane.label, lane.items), { x: PAD, y, w: LABEL_W, h: Math.max(64, boxFor(headed(plan, view, lane.label, lane.items), LABEL_W).h) }, null, { fill: 'none', dash: 'none', color: 'black' }, { plan: { view: view.id, row: lane.id ?? null, y0: y } })
		y += h + BAND_GAP
	}
	const colH = y - BAND_GAP + PAD - HEAD
	columns.forEach((c, i) => {
		const key = K(view, 'col', c.id)
		const x = left + i * (COL_W + GAP)
		ctx.frame(key, headed(plan, view, c.label, c.items), { x, y: HEAD, w: COL_W, h: colH }, { frame: 'col', group: c.id, ...(laneField && { bands }) })
		lanes.forEach((lane, l) => c.items.filter((it) => !laned || laned.of(it) === lane.id).forEach((it, n) => ctx.card(it, { x: x + PAD, y: bands[l].y0 + n * (cardH + CARD_GAP), w: CARD_W, h: cardH }, key)))
	})
	ctx.size = { w: Math.max(left + CARD_W + PAD, left + columns.length * (COL_W + GAP) - GAP + PAD), h: HEAD + colH + PAD }
}

const SCALES = { day: 40, week: 16, month: 5 }
const mondayOf = (n) => n - ((((n + 3) % 7) + 7) % 7) // day 0 (1970-01-01) was a Thursday
const monthStart = (n) => dayNum(`${isoOf(n).slice(0, 7)}-01`)
const nextMonth = (n) => {
	const iso = isoOf(n), y = +iso.slice(0, 4), m = +iso.slice(5, 7)
	return dayNum(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`)
}
/** An item's days on the axis: its start and end, or its one date. A point is a milestone, or an item with a single date. */
function spanOf(it) {
	const s = validDate(it.start) ? dayNum(it.start) : null, e = validDate(it.end) ? dayNum(it.end) : null
	return { s: s ?? e, e: Math.max(e ?? s, s ?? e), point: s === null || e === null || it.milestone === true }
}
export const DAY_MINUTES = 480 // an `estimate` is minutes of work: this many to a day on the axis

function gantt(ctx) {
	const { plan, view, items } = ctx
	const BAR_H = 60, MARK = 36, ROW_GAP = 14, LANE_GAP = 54, INSET = 10, LABEL_GAP = 12, LABEL_MAX = 80
	const dated = (it) => validDate(it.start) || validDate(it.end)
	const scheduled = items.filter(dated), waiting = items.filter((it) => !dated(it))
	const today = dayNum(ctx.today)
	const spans = scheduled.map(spanOf)
	let lo = view.from ? dayNum(view.from) : spans.length ? Math.min(...spans.map((s) => s.s)) : today
	let hi = view.to ? dayNum(view.to) : spans.length ? Math.max(...spans.map((s) => s.e)) : today + 13
	if (hi < lo) hi = lo
	// A day's width. Left to choose, it is what lets the typical bar hold a short title, without the chart running away.
	let ppd = SCALES[view.scale]
	if (!ppd) {
		const lengths = spans.filter((s) => !s.point).map((s) => s.e - s.s + 1).sort((a, b) => a - b)
		const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 7
		ppd = Math.max(3, Math.min(48, Math.round(170 / median), Math.floor(7000 / (hi - lo + 14))))
		// A few weeks of work is read in weeks, whatever the bars are like.
		if (hi - lo <= 70) ppd = Math.max(ppd, 16)
	}
	// The axis runs whole weeks or months, so its header boxes line up with it; weeks while a week's box can hold its date.
	// (A week's box holds "Nov 16" on one line from 16 px a day; below that the boxes are months.)
	const unit = ppd >= 16 ? 'week' : 'month'
	// Whole units, with one of room before the first day of work and after the last (not past a `from` or `to` the view gives),
	// and never narrower than the room three waiting cards need, so the chart is as wide as its own Unscheduled strip.
	let from = unit === 'week' ? mondayOf(lo) - (view.from ? 0 : 7) : view.from ? monthStart(lo) : monthStart(monthStart(lo) - 1)
	let to = unit === 'week' ? mondayOf(hi) + (view.to ? 6 : 13) : (view.to ? nextMonth(hi) : nextMonth(nextMonth(hi))) - 1
	while ((to - from + 1) * ppd < 3 * CARD_W + 2 * 14 + PAD * 2 && !view.to) to = unit === 'week' ? to + 7 : nextMonth(to + 1) - 1
	const x0 = PAD + INSET
	const X = (day) => x0 + (day - from) * ppd
	const axisW = (to - from + 1) * ppd
	ctx.axis = { from: isoOf(from), ppd, x0 }

	// The header boxes are the axis: each says which day its left edge is, so dates are read against them, wherever they are.
	const TODAY_H = 60, HEAD_H = 60
	const headY = PAD + TODAY_H + 12
	for (let d = from; d <= to; ) {
		const next = unit === 'week' ? d + 7 : nextMonth(d)
		const iso = isoOf(d), w = (next - d) * ppd - 14
		const label = unit === 'week' ? shortDate(iso) : w >= 130 ? `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : w >= 76 ? MONTHS[+iso.slice(5, 7) - 1] : ''
		ctx.node(K(view, 'axis', iso), label, { x: X(d), y: headY, w, h: HEAD_H }, null, { fill: 'solid', color: 'black' }, { plan: { view: view.id, axis: iso, from: isoOf(from), ppd, dx: X(d), dy: headY } })
		d = next
	}

	const laneField = view.groupBy ? fieldOf(plan, view.groupBy) : null
	let lanes = [{ id: undefined, label: null, items: scheduled }]
	if (laneField) lanes = groupsBy(laneField, scheduled).groups
	let y = headY + HEAD_H + (laneField ? LANE_GAP : 24)
	const chartTop = y
	let reach = x0 + axisW
	for (const lane of lanes) {
		const key = laneField ? K(view, 'lane', lane.id) : null
		let top = laneField ? y + 20 : y
		// A lane of an item's children is headed by a bar from the first of them to the last.
		if (laneField?.items === true && lane.id !== null && lane.items.length) {
			const sp = lane.items.map(spanOf)
			const s0 = Math.min(...sp.map((x) => x.s)), e0 = Math.max(...sp.map((x) => x.e))
			ctx.node(K(view, 'summary', lane.id), '', { x: X(s0), y: top, w: (e0 - s0 + 1) * ppd, h: 14 }, key, { color: 'black', fill: 'solid' }, { plan: { view: view.id, summary: lane.id } })
			top += 14 + ROW_GAP
		}
		// A bar is as long as its item: start to end on the axis, and no longer. A title that doesn't fit inside stands beside it.
		const drawn = lane.items.map((it) => {
			const sp = spanOf(it), title = ctx.title(it)
			const bar = sp.point ? { x: Math.round(X(sp.s) + ppd / 2 - MARK / 2), w: MARK, h: MARK, geo: 'diamond' } : { x: X(sp.s), w: Math.max((sp.e - sp.s + 1) * ppd, 6), h: BAR_H, geo: 'rectangle' }
			const inside = ctx.titlesInBars && !sp.point && textWidth(title) <= bar.w
			const text = title.length > LABEL_MAX ? `${title.slice(0, LABEL_MAX - 1).trimEnd()}…` : title
			const label = inside ? null : { text, w: textWidth(text), clipped: text !== title }
			return { it, bar, inside, title, label, right: bar.x + bar.w + (label ? LABEL_GAP + label.w : 0) }
		}).sort((a, b) => a.bar.x - b.bar.x)
		// Bars (with their labels) that would run into each other get their own row, packed greedily in start order.
		const rows = []
		for (const d of drawn) {
			const row = rows.find((r) => r.at(-1).right + 16 <= d.bar.x)
			if (row) row.push(d)
			else rows.push([d])
		}
		let ry = top
		for (const row of rows) {
			for (const d of row) {
				ctx.card(d.it, { x: d.bar.x, y: ry + (BAR_H - d.bar.h) / 2, w: d.bar.w, h: d.bar.h }, key, { text: d.inside ? d.title : '', geo: d.bar.geo })
				if (d.label) ctx.node(K(view, 'label', d.it.id), d.label.text, { x: d.bar.x + d.bar.w + LABEL_GAP, y: ry, w: d.label.w, h: BAR_H }, key, { fill: 'none', dash: 'none', color: ctx.colorOf(d.it) === 'grey' ? 'grey' : 'black' }, { plan: { item: d.it.id, view: view.id, version: d.it.version, label: true, ...(d.label.clipped && { clipped: true }) }, detail: detailOf(plan, d.it) })
				reach = Math.max(reach, d.right)
			}
			ry += BAR_H + ROW_GAP
		}
		const bottom = rows.length ? ry - ROW_GAP : top + 70
		if (laneField) {
			ctx.frame(key, headed(plan, view, lane.label, lane.items), { x: PAD, y, w: axisW + INSET * 2, h: bottom + 20 - y }, { frame: 'lane', group: lane.id })
			y = bottom + 20 + LANE_GAP
		} else y = bottom + 24
	}
	const chartBottom = laneField ? y - LANE_GAP : y - 24
	// A label near the end of the chart runs past the axis: every lane is as wide as the widest reach.
	for (const f of ctx.frames) f.rel.w = Math.max(f.rel.w, reach + INSET - PAD)

	if (today >= from && today <= to) {
		const cx = X(today) + ppd / 2
		ctx.node(K(view, 'mark', 'today'), 'Today', { x: snap(cx - 45), y: PAD, w: 90, h: TODAY_H }, null, { color: 'red', fill: 'solid' }, { plan: { view: view.id, today: ctx.today } })
		if (!laneField) ctx.node(K(view, 'mark', 'todayline'), '', { x: Math.round(cx - 2), y: chartTop - 8, w: 4, h: chartBottom - chartTop + 16 }, null, { color: 'red', fill: 'solid' }, { plan: { view: view.id, today: ctx.today, line: true } })
	}

	let bottom = chartBottom
	if (waiting.length) {
		const key = K(view, 'frame', 'unscheduled')
		const width = Math.max(reach + INSET - PAD, CARD_W + PAD * 2)
		const perRow = Math.max(1, Math.floor((width - PAD * 2 + 14) / (CARD_W + 14)))
		const cardH = Math.max(64, ...waiting.map((it) => boxFor(ctx.text(it), CARD_W).h))
		const top = chartBottom + LANE_GAP
		waiting.forEach((it, i) => ctx.card(it, { x: PAD + PAD + (i % perRow) * (CARD_W + 14), y: top + PAD + Math.floor(i / perRow) * (cardH + 14), w: CARD_W, h: cardH }, key))
		const h = PAD * 2 + Math.ceil(waiting.length / perRow) * (cardH + 14) - 14
		ctx.frame(key, `Unscheduled (${waiting.length})`, { x: PAD, y: top, w: width, h }, { frame: 'unscheduled' })
		bottom = top + h
	}
	ctx.size = { w: Math.max(reach + INSET, ...ctx.frames.map((f) => f.rel.x + f.rel.w)) + PAD, h: bottom + PAD }

	if (view.dependencies) {
		const shown = new Map(scheduled.map((it) => [it.id, ctx.keyOf(it)]))
		for (const it of scheduled) for (const dep of it.dependsOn ?? []) if (shown.has(dep) && dep !== it.id) ctx.tg.edges.push(depEdge(view, shown.get(dep), shown.get(it.id), 'elbow'))
	}
}

const depEdge = (view, from, to, route = 'straight') => ({ key: `edge:${from}->${to}`, from, to, style: { color: 'grey', dash: 'solid', size: 's', route }, meta: { plan: { view: view.id, dep: true } } })

function timeline(ctx) {
	const { view, items } = ctx
	if (!view.date) throw new PlanError('invalid', 'a timeline needs a date field to order by, and this plan has none')
	const W = 240, GAP = 30
	const dated = items.filter((it) => validDate(it[view.date])).sort((a, b) => (a[view.date] < b[view.date] ? -1 : a[view.date] > b[view.date] ? 1 : 0))
	const text = (it) => `${ctx.title(it)}\n${formatValue({ type: 'date' }, it[view.date], { long: true })}`
	const h = Math.max(64, ...dated.map((it) => boxFor(text(it), W).h))
	const perRow = view.perRow
	dated.forEach((it, i) => ctx.card(it, { x: PAD + (i % perRow) * (W + GAP), y: PAD + Math.floor(i / perRow) * (h + GAP), w: W, h }, null, { text: text(it) }))
	const cols = Math.max(1, Math.min(perRow, dated.length)), rows = Math.max(1, Math.ceil(dated.length / perRow))
	ctx.size = { w: PAD * 2 + cols * (W + GAP) - GAP, h: PAD * 2 + rows * (h + GAP) - GAP }
}

async function graph(ctx) {
	const { view, items } = ctx
	if (!items.length) return void (ctx.size = { w: 400, h: 200 })
	const shown = new Map(items.map((it) => [it.id, ctx.keyOf(it)]))
	const edges = items.flatMap((it) => (it.dependsOn ?? []).filter((d) => shown.has(d) && d !== it.id).map((d) => ({ from: shown.get(d), to: shown.get(it.id) })))
	const laid = await layOut({ kind: 'flow', direction: view.direction, boxWidth: CARD_W, nodes: items.map((it) => ({ id: shown.get(it.id), text: ctx.text(it) })), edges })
	const byKey = new Map(laid.nodes.map((n) => [n.key, n.box]))
	for (const it of items) {
		const b = byKey.get(shown.get(it.id))
		ctx.card(it, { x: PAD + b.x, y: PAD + b.y, w: b.w, h: b.h }, null)
	}
	for (const e of laid.edges) ctx.tg.edges.push({ ...e, style: { ...e.style, size: 's' }, meta: { plan: { view: view.id, dep: true } } })
	ctx.size = { w: PAD * 2 + Math.max(...laid.nodes.map((n) => n.box.x + n.box.w)), h: PAD * 2 + Math.max(...laid.nodes.map((n) => n.box.y + n.box.h)) }
}

const EMPTY_CELL = '—'
function table(ctx) {
	const { plan, view, items } = ctx
	const TITLE_W = 280, CELL_W = 180, GAP = 14, HEAD_H = 56
	const cols = [{ id: 'title', label: fieldOf(plan, 'title')?.label ?? 'Title', w: TITLE_W }, ...view.fields.filter((f) => f !== 'title').map((f) => ({ id: f, label: fieldOf(plan, f).label, w: CELL_W, field: fieldOf(plan, f) }))]
	let x = PAD
	for (const c of cols) {
		c.x = x
		ctx.node(K(view, 'head', c.id), c.label, { x, y: PAD, w: c.w, h: HEAD_H }, null, { fill: 'solid', color: 'black' }, { plan: { view: view.id, head: c.id } })
		x += c.w + GAP
	}
	let y = PAD + HEAD_H + GAP
	for (const it of items) {
		const cell = (c) => (c.field ? formatValue(c.field, it[c.id], { long: true }) || EMPTY_CELL : ctx.title(it))
		const h = Math.max(64, ...cols.map((c) => boxFor(cell(c), c.w).h))
		for (const c of cols) {
			if (!c.field) ctx.card(it, { x: c.x, y, w: c.w, h }, null, { text: cell(c) })
			else {
				const color = c.field.type === 'option' ? colorOk(optionOf(c.field, it[c.id])?.color) ?? 'grey' : 'grey'
				ctx.node(K(view, 'cell', it.id, c.id), cell(c), { x: c.x, y, w: c.w, h }, null, { color: isDone(plan, it) ? 'grey' : color, fill: 'none' }, { plan: { item: it.id, view: view.id, version: it.version, field: c.id } })
			}
		}
		y += h + GAP
	}
	ctx.size = { w: x - GAP + PAD, h: y - GAP + PAD }
}

const RENDER = { board, gantt, timeline, graph, table }

/**
 * A view of a plan as a toucan graph, every box placed: a frame keyed `plan:<view>`, its columns or lanes as frames inside it,
 * and a native box per item keyed `plan:<view>:item:<id>` with `meta.plan = { item, view, version }` and the record in `meta.detail`.
 * The same plan, view and options always give the same graph. opts: `origin` (the frame's top left, page coordinates), `keys`
 * ({ itemId: key } for boxes a person drew that became items), `today` (YYYY-MM-DD), `nest: false` for an engine without frames in frames,
 * `titlesInBars: false` for one that can't give a box text it was drawn without (a gantt's titles then always stand beside their bars).
 */
export async function render(plan, view, opts = {}) {
	const ctx = context(plan, view, opts)
	await RENDER[ctx.view.kind](ctx)
	// The view's frame holds everything drawn in it: rounded up, never down.
	ctx.size = { w: Math.ceil(ctx.size.w / 10) * 10, h: Math.ceil(ctx.size.h / 10) * 10 }
	const tg = finish(ctx)
	for (const n of tg.nodes) n.box = { x: Math.round(n.box.x), y: Math.round(n.box.y), w: Math.round(n.box.w), h: Math.round(n.box.h) }
	return tg
}

// ---- reading the canvas back ----------------------------------------------------------------------------------------------

/**
 * What of a toucan graph a plan cares about: managed frames and boxes (by key, with where they are and what they say), managed
 * arrows, and `loose`: ordinary boxes with text that someone drew inside a board column. Heights are left out: an engine
 * grows a box to fit its text, and that isn't anyone's edit.
 */
export function observe(tg) {
	if (tg?.observed) return tg
	const out = { observed: 1, frames: {}, nodes: {}, edges: [], loose: {} }
	for (const g of tg?.groups ?? []) if (g.meta?.plan?.view && g.box) out.frames[g.key] = { x: g.box.x, y: g.box.y, w: g.box.w, h: g.box.h, l: g.label ?? '', ...(g.rotation && { r: 1 }), plan: g.meta.plan }
	for (const n of tg?.nodes ?? []) {
		if (!n.box) continue
		// (`r`: it has been turned. A turned shape is nobody's edit, and where it seems to be says nothing.)
		const at = { g: n.group ?? null, x: n.box.x, y: n.box.y, w: n.box.w, t: n.text ?? '', ...(n.rotation && { r: 1 }) }
		if (n.meta?.plan?.view) out.nodes[n.key] = { ...at, plan: n.meta.plan }
		// What may become an item: a plain rectangle about the size of a card, upright, with text. An ellipse with "!" in it, a
		// banner across the column, a sticky note: those are someone's annotations.
		else if (n.meta?.plan === undefined && out.frames[n.group]?.plan.frame === 'col' && String(n.text ?? '').trim() && (n.style?.geo ?? 'rectangle') === 'rectangle' && !n.rotation && n.box.w >= 100 && n.box.w <= 420 && n.box.h >= 40 && n.box.h <= 260) out.loose[n.key] = at
	}
	// (An arrow counts while it joins two of the plan's boxes: a copy someone made of a view takes copies of its arrows with it.)
	for (const e of tg?.edges ?? []) if (e.meta?.plan?.view && out.nodes[e.from] && out.nodes[e.to]) out.edges.push(`edge:${e.from}->${e.to}`)
	out.edges.sort()
	return out
}

const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v)
/** Are two observations the same? `loose: false` leaves out boxes people drew in columns (when nothing can be made of them). */
export function sameObserved(a, b, { loose = true, skip = [] } = {}) {
	const strip = (o) => {
		const l = { ...(loose ? o.loose : {}) }
		for (const k of skip) delete l[k]
		return JSON.stringify(canon({ frames: o.frames, nodes: o.nodes, edges: o.edges, loose: l }))
	}
	return strip(observe(a)) === strip(observe(b))
}

/** Where two observations differ, for whoever is debugging a sync: ["nodes plan:board:item:a: x 10 → 40", …]. */
export function diffObserved(a, b) {
	const A = observe(a), B = observe(b), out = []
	for (const part of ['frames', 'nodes', 'loose']) {
		for (const key of new Set([...Object.keys(A[part]), ...Object.keys(B[part])])) {
			const x = A[part][key], y = B[part][key]
			if (!x || !y) out.push(`${part} ${key}: ${x ? 'only in the first' : 'only in the second'}`)
			else for (const f of new Set([...Object.keys(x), ...Object.keys(y)])) if (JSON.stringify(canon(x[f])) !== JSON.stringify(canon(y[f]))) out.push(`${part} ${key}: ${f} ${JSON.stringify(x[f])} → ${JSON.stringify(y[f])}`)
		}
	}
	for (const e of new Set([...A.edges, ...B.edges])) if (A.edges.includes(e) !== B.edges.includes(e)) out.push(`edge ${e}: ${A.edges.includes(e) ? 'only in the first' : 'only in the second'}`)
	return out
}

/**
 * Where each view is now: { viewId: { x, y } }, from its own frame, else from any of its frames or axis boxes that is still
 * there (each knows its offset in the view), so a view is redrawn where it stands.
 */
export function originsOf(observed) {
	const out = {}, obs = observe(observed)
	for (const f of Object.values(obs.frames)) if (f.plan.frame === 'root') out[f.plan.view] = { x: f.x, y: f.y }
	for (const f of [...Object.values(obs.frames), ...Object.values(obs.nodes).filter((n) => n.plan.axis)]) out[f.plan.view] ??= { x: f.x - (f.plan.dx ?? 0), y: f.y - (f.plan.dy ?? 0) }
	return out
}

/** Every view's card for each item, as the canvas has it: { viewId: { itemId: key } }. A box a person drew that became an item keeps its own key. */
export function cardKeys(observed, prefer = {}) {
	const out = {}
	for (const [key, n] of Object.entries(observe(observed).nodes)) {
		if (n.plan.item === undefined || n.plan.field !== undefined || n.plan.label) continue
		const have = (out[n.plan.view] ??= {})[n.plan.item]
		// Its own key wins, then the one remembered, then the first seen: anything else is a copy someone made.
		const own = itemKey(n.plan.view, n.plan.item), kept = prefer[n.plan.view]?.[n.plan.item]
		if (have === undefined || key === own || (key === kept && have !== own)) out[n.plan.view][n.plan.item] = key
	}
	return out
}

const stripDone = (t) => String(t ?? '').replace(/^✓\s*/, '')
/** The title a card's text gives, given whether it was drawn with a second line under the title. */
function titleFromText(text, hadSub) {
	const lines = stripDone(text).split('\n').map((l) => l.trim())
	if (hadSub && lines.length > 1) lines.pop()
	return lines.filter(Boolean).join(' ').trim()
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
/** The band (a swimlane's stretch of a column) a height falls in: the one it is inside, else the nearest. */
const bandAt = (bands, y) => bands.find((b) => y + 20 >= b.y0 && y + 20 < b.y1) ?? [...bands].sort((p, q) => Math.min(Math.abs(y - p.y0), Math.abs(y - p.y1)) - Math.min(Math.abs(y - q.y0), Math.abs(y - q.y1)))[0]
/** The indexes of a longest run of `xs` that is already in rising order: what can stay while the rest is moved. */
function longestRising(xs) {
	const tails = [], prev = new Array(xs.length).fill(-1)
	xs.forEach((x, i) => {
		let lo = 0, hi = tails.length
		while (lo < hi) {
			const mid = (lo + hi) >> 1
			if (xs[tails[mid]] < x) lo = mid + 1
			else hi = mid
		}
		if (lo > 0) prev[i] = tails[lo - 1]
		tails[lo] = i
	})
	const keep = new Set()
	for (let i = tails.at(-1) ?? -1; i >= 0; i = prev[i]) keep.add(i)
	return keep
}

/**
 * The inverse of render: the upstream changes a person's edits meant. `before` is what was last drawn (render's graph, or an
 * observation of it) and `after` the canvas now. Each change quotes the version that was last drawn, which is what the person saw.
 *
 * Nothing here reads where a shape is on the page. A card's column is the frame it is in; its place in the column is its
 * order among the cards there; a bar's dates are where it stands against the view's own axis boxes (and against its lane
 * and the view's frame: a shift counts only when it is seen against all of them). So render followed by reading the canvas
 * back is always no change, however the view, its frames or its axis were moved, resized or redrawn in between.
 *
 * Returns the contract's `changes` without `mutation`. Off the wire: a create carries `shape` (the box it came from), an
 * update `drawn` (the version its shape carries now), and `{ op: 'note', id, message }` says why a gesture was not read.
 * Only writable fields, and nothing on a read-only source.
 */
export function changesFrom(plan, view, before, after) {
	if (plan.source?.readonly) return []
	const v = resolveView(view, plan)
	const B = observe(before), A = observe(after)
	const writable = (f) => fieldOf(plan, f)?.writable === true
	const items = new Map(plan.items.map((it) => [it.id, it]))
	const rank = new Map(plan.items.map((it, i) => [it.id, i]))
	const mine = (o) => o.plan?.view === v.id
	const framesIn = (obs, kind) => Object.entries(obs.frames).filter(([, f]) => mine(f) && f.plan.frame === kind).map(([key, f]) => ({ key, ...f }))
	/** The frame of a kind a box belongs to: the one it's in, else the one its centre is over. */
	const frameOf = (obs, n, kinds) => {
		const g = obs.frames[n.g]
		if (g && mine(g) && kinds.includes(g.plan.frame)) return { key: n.g, ...g }
		const cx = n.x + n.w / 2, cy = n.y + 20
		return kinds.flatMap((k) => framesIn(obs, k)).find((f) => cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h) ?? null
	}
	const rootOf = (obs) => framesIn(obs, 'root')[0] ?? null
	/** The view's axis as it stands in an observation: which day a page x is, from the header boxes (the middle one's word, so one moved alone changes nothing). */
	const axisOf = (obs) => {
		const heads = Object.values(obs.nodes).filter((n) => mine(n) && n.plan.axis && n.plan.ppd)
		if (!heads.length) return null
		const { from, ppd } = heads[0].plan
		return { from: dayNum(from), ppd, x: median(heads.map((h) => h.x - (dayNum(h.plan.axis) - dayNum(from)) * ppd)) }
	}
	/** Where a swimlane's rows are in an observation, from the row names standing at the top of each band. */
	const rowsOf = (obs) => {
		const rows = Object.values(obs.nodes).filter((n) => mine(n) && n.plan.row !== undefined && n.plan.y0 !== undefined)
		return rows.length ? median(rows.map((r) => r.y - r.plan.y0)) : null
	}
	const axis = { A: axisOf(A), B: axisOf(B) }, rows = { A: rowsOf(A), B: rowsOf(B) }
	const changes = new Map(), notes = []
	const change = (item, version, drawn) => {
		if (!changes.has(item.id)) changes.set(item.id, { op: 'update', id: item.id, version: version ?? item.version, set: {}, ...(drawn !== undefined && { drawn }) })
		return changes.get(item.id)
	}
	const managed = Object.entries(A.nodes).filter(([, n]) => mine(n) && n.plan.item !== undefined && items.has(n.plan.item)).map(([key, n]) => ({ key, ...n, item: items.get(n.plan.item) }))
	const cards = managed.filter((n) => n.plan.field === undefined && !n.plan.label)
	/** The row of a board a card is in, read two ways: against its column, and against the row names. */
	const laneOf = (obs, which, n, col) => {
		if (!col?.plan.bands) return null
		const byFrame = bandAt(col.plan.bands, n.y - (col.y - (col.plan.dy ?? 0))).id
		return { byFrame, byRows: rows[which] === null ? byFrame : bandAt(col.plan.bands, n.y - rows[which]).id }
	}

	/**
	 * The row a card is in now. It has changed rows only when it reads as another row both ways: the row names nudged, or its
	 * column resized round it, each change one reading and not the other, and then it is where it was.
	 */
	const rowNow = (n, col) => {
		const to = laneOf(A, 'A', n, col)
		if (!to) return undefined
		const b = B.nodes[n.key], was = b && frameOf(B, b, ['col']), from = was && laneOf(B, 'B', b, was)
		if (!from) return to.byFrame // something new: its column says
		return to.byFrame !== from.byFrame && to.byRows !== from.byRows ? to.byRows : from.byRows
	}

	/**
	 * Days for a distance along the axis. A move counts once it passes a third of a day (and 4 px, so nothing is read from a
	 * pixel's wobble), and then it is at least one day in the direction of travel: a nudge with the arrow keys moves a bar a
	 * day at any scale, where rounding would have let it snap back.
	 */
	const daysFor = (px, ppd) => (Math.abs(px) < Math.max(ppd / 3, 4) ? 0 : Math.sign(px) * Math.max(1, Math.round(Math.abs(px) / ppd)))
	let withAxis = false

	for (const a of managed) {
		const b = B.nodes[a.key]
		if (!b) continue
		const item = a.item
		const set = {}
		if (a.plan.field !== undefined) {
			// A table's other cells: the text is the value.
			if (a.t !== b.t && writable(a.plan.field)) {
				try {
					const value = coerceValue(plan, a.plan.field, a.t)
					if (JSON.stringify(value) !== JSON.stringify(item[a.plan.field] ?? null)) set[a.plan.field] = value
				} catch {} // not a value this field takes: the next sync puts the cell back
			}
		} else if (a.t !== b.t && writable('title')) {
			// What was typed is the title, exactly. (A title too long to show whole is never written back as it was shown.)
			const hadSub = !a.plan.label && (v.kind === 'timeline' || (v.kind === 'board' || v.kind === 'graph') && !!subLine(plan, v, item))
			const title = titleFromText(a.t, hadSub)
			if (title && title !== titleFromText(b.t, hadSub) && title !== item.title && !(a.plan.clipped && title.endsWith('…'))) set.title = title
		}
		if (a.plan.field === undefined && !a.plan.label && v.kind === 'board' && !a.r) {
			const now = frameOf(A, a, ['col']), was = frameOf(B, b, ['col'])
			if (now && was && v.groupBy && writable(v.groupBy) && now.plan.group !== was.plan.group) set[v.groupBy] = now.plan.group ?? null
			if (now && was && v.lanes && writable(v.lanes) && now.plan.bands && was.plan.bands) {
				const to = rowNow(a, now), from = laneOf(B, 'B', b, was).byRows
				if (to !== from) set[v.lanes] = to
			}
		}
		if (a.plan.field === undefined && !a.plan.label && v.kind === 'gantt' && !a.r) {
			const now = frameOf(A, a, ['lane', 'unscheduled']), was = frameOf(B, b, ['lane', 'unscheduled'])
			const both = writable('start') && writable('end')
			if (was?.plan.frame === 'unscheduled') {
				// Out of the waiting strip and onto the chart: it starts on the day it was dropped on, for as long as it is estimated to take.
				const onChart = now ? now.plan.frame === 'lane' : a.g !== b.g
				if (onChart && axis.A && both) {
					const day = axis.A.from + Math.floor((a.x - axis.A.x) / axis.A.ppd)
					const days = Number(item.estimate) > 0 ? Math.max(1, Math.ceil(Number(item.estimate) / DAY_MINUTES)) : v.days
					Object.assign(set, { start: isoOf(day), end: isoOf(day + days - 1) })
					if (now && v.groupBy && writable(v.groupBy) && (item[v.groupBy] ?? null) !== (now.plan.group ?? null)) set[v.groupBy] = now.plan.group ?? null
				}
			} else if (now?.plan.frame !== 'unscheduled') {
				// (Dropped into the waiting strip, a bar goes back where it was: clearing dates is not something to do by accident.)
				if (now && was && v.groupBy && writable(v.groupBy) && now.plan.group !== was.plan.group) set[v.groupBy] = now.plan.group ?? null
				if (axis.A && axis.B) {
					const ppd = axis.A.ppd
					// How far it moved, against everything it could have moved with: the axis, its lane, the view's frame.
					const shifts = [a.x - axis.A.x - (b.x - axis.B.x)]
					if (now && was && now.key === was.key) shifts.push(a.x - now.x - (b.x - was.x))
					const rootA = rootOf(A), rootB = rootOf(B)
					if (rootA && rootB) shifts.push(a.x - rootA.x - (b.x - rootB.x))
					const left = shifts.every((s) => daysFor(s, ppd) !== 0) ? daysFor(shifts[0], ppd) : 0
					const right = left + daysFor(a.w - b.w, ppd)
					// Dragged along with the axis boxes: against the axis it hasn't moved, though it has on the page and in its frame.
					if (!left && shifts.length > 1 && daysFor(a.x - b.x, ppd) && daysFor(axis.A.x - axis.B.x, ppd) && shifts.slice(1).some((s) => daysFor(s, ppd))) withAxis = true
					if (left || right) {
						const hasStart = validDate(item.start), hasEnd = validDate(item.end)
						const shift = (iso, days) => isoOf(dayNum(iso) + days)
						if (hasStart && hasEnd && item.end < item.start) notes.push({ op: 'note', id: item.id, message: `"${item.title}" ends before it starts (${item.start} to ${item.end}), so moving its bar says nothing certain about its dates. Put back; fix the dates first.` })
						else if (!hasStart || !hasEnd || item.milestone === true) {
							if (left && hasStart && writable('start')) set.start = shift(item.start, left)
							if (left && hasEnd && writable('end')) set.end = shift(item.end, left)
						} else {
							let start = left && writable('start') ? shift(item.start, left) : item.start
							let end = right && writable('end') ? shift(item.end, right) : item.end
							if (end < start) left && !right ? (start = end) : (end = start)
							if (start !== item.start) set.start = start
							if (end !== item.end) set.end = end
						}
					}
				}
			}
		}
		if (Object.keys(set).length) Object.assign(change(item, b.plan.version, a.plan.version).set, set)
	}

	if (withAxis) notes.push({ op: 'note', id: null, message: 'Bars were moved together with the date boxes above them, which changes no dates. To move work in time, drag its bar and leave the dates where they are. Put back.' })

	const created = []
	const placed = [] // the ids of items given a place, in the order the places must be applied
	if (v.kind === 'board') {
		const canPlace = !v.sort.length
		const canCreate = writable('title')
		const cells = []
		for (const col of framesIn(A, 'col')) {
			const members = cards.filter((c) => !c.r && frameOf(A, c, ['col'])?.key === col.key).map((c) => ({ ...c, id: c.item.id }))
			const drawn = canCreate ? Object.entries(A.loose).filter(([, n]) => n.g === col.key).map(([key, n]) => ({ key, ...n, id: null })) : []
			const all = [...members, ...drawn].sort((p, q) => p.y - q.y || p.x - q.x)
			const bands = col.plan.bands
			const cell = (m) => (bands ? rowNow(m, col) : undefined)
			for (const lane of bands ? bands.map((b) => b.id) : [undefined]) {
				const seq = all.filter((m) => cell(m) === lane)
				const ours = seq.filter((m) => m.id)
				// Of the cards that were here before, the longest run still in the source's order stayed put; the rest were moved. A card
				// that arrived from elsewhere was moved too, unless it was dropped just where the source's order would have it anyway.
				const here = (m) => {
					const was = B.nodes[m.key] && frameOf(B, B.nodes[m.key], ['col'])
					return !!was && was.key === col.key && (!bands || laneOf(B, 'B', B.nodes[m.key], was).byRows === lane)
				}
				const stayers = ours.filter(here)
				const run = longestRising(stayers.map((m) => rank.get(m.id)))
				const kept = new Set(stayers.filter((_, i) => run.has(i)).map((m) => m.key))
				ours.forEach((m, i) => {
					if (kept.has(m.key) || here(m)) return
					const above = ours.slice(0, i).reverse().find((x) => kept.has(x.key)), below = ours.slice(i + 1).find((x) => kept.has(x.key))
					if ((!above || rank.get(above.id) < rank.get(m.id)) && (!below || rank.get(m.id) < rank.get(below.id))) kept.add(m.key)
				})
				cells.push({ col, bands, lane, seq, kept })
			}
		}
		// Places are applied in the order they are sent, so each is anchored on a card that isn't moving, or on one placed earlier in
		// this same write: top to bottom down each cell, the card above being either. At the top of a cell the anchor is whatever
		// comes just before the first card below that is staying, among the items that are staying.
		const moving = new Set(cells.flatMap((c) => c.seq.filter((m) => m.id && !c.kept.has(m.key)).map((m) => m.id)))
		for (const { col, bands, lane, seq, kept } of cells) {
			const placeAt = (i, self) => {
				const above = seq.slice(0, i).reverse().find((m) => m.id)
				if (above) return { after: above.id }
				const below = seq.slice(i + 1).find((m) => m.id && kept.has(m.key))
				if (!below) return null
				const pred = plan.items.slice(0, rank.get(below.id)).reverse().find((it) => it.id !== self && !moving.has(it.id))
				return { after: pred?.id ?? null }
			}
			seq.forEach((m, i) => {
				if (!m.id) {
					const title = titleFromText(m.t, false)
					if (!title) return
					const place = canPlace ? placeAt(i, null) : null
					created.push({ op: 'create', set: { title, ...(v.groupBy && col.plan.group !== null && col.plan.group !== undefined && writable(v.groupBy) && { [v.groupBy]: col.plan.group }), ...(bands && lane !== null && v.lanes && writable(v.lanes) && { [v.lanes]: lane }) }, ...(place && { place }), shape: m.key })
					return
				}
				if (!canPlace || kept.has(m.key) || !B.nodes[m.key]) return
				const place = placeAt(i, m.id)
				if (!place) return
				change(m.item, B.nodes[m.key].plan.version, m.plan.version).place = place
				placed.push(m.id)
			})
		}
	}

	// Changes that only set fields first; then the places, in the order they build on each other.
	const at = (c) => (c.place ? placed.indexOf(c.id) : -1)
	const updates = [...changes.values()].filter((c) => Object.keys(c.set).length || c.place).sort((p, q) => at(p) - at(q)).map((c) => (Object.keys(c.set).length ? c : (({ set, ...rest }) => rest)(c)))
	return [...updates, ...created, ...notes]
}

/**
 * What to take off the canvas so it matches a render: `remove` is managed shapes the render no longer draws (an item that left
 * the view, a view that was removed); `release` is copies a person made of a card, a column or a whole view, which stay, whole,
 * as their own ordinary shapes.
 */
export function leftovers(observed, rendered) {
	const now = observe(observed), want = observe(rendered)
	// What a shape is in its view, whatever its key: a second shape that is the same thing is a copy someone made.
	const sig = ({ plan: p }) => [p.view, p.frame, p.group, p.item, p.field, p.label, p.axis, p.head, p.row, p.summary, p.today && 'today', p.line].map((x) => (x === undefined ? '' : String(x))).join('\n')
	const drawn = new Set([...Object.values(want.nodes), ...Object.values(want.frames)].map(sig))
	const remove = [], release = []
	for (const part of ['nodes', 'frames']) {
		for (const [key, o] of Object.entries(now[part])) {
			if (want[part][key]) continue
			if (drawn.has(sig(o))) release.push(key)
			else remove.push(key)
		}
	}
	// (An arrow between copies goes with the copies: once they are released it is nobody's but the person's.)
	const freed = new Set(release)
	const joinsCopies = (key) => [...freed].some((k) => key.startsWith(`edge:${k}->`) || key.endsWith(`->${k}`))
	for (const key of now.edges) if (!want.edges.includes(key) && !joinsCopies(key)) remove.push(key)
	return { remove, release }
}

// ---- writing: what a source does with changes (the built-in file source runs on this) -----------------------------------------

const hash = (s) => {
	let h = 2166136261
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
	return (h >>> 0).toString(36)
}

/**
 * Applies the contract's `changes` to a plan, as a source would: each on its own, with the version it quotes checked, only
 * declared writable fields set, and a change already applied (same `mutation`) answered as it was the first time.
 * `seen` is { mutation: { ok, id, error?, message? } } from earlier writes. Returns { plan, results, seen, changed }.
 */
export function applyChanges(plan, changes, seen = {}) {
	const items = plan.items.map((it) => ({ ...it }))
	const memo = { ...seen }
	const find = (id) => items.find((it) => it.id === String(id))
	let changed = false
	const results = (Array.isArray(changes) ? changes : []).map((c) => {
		const mutation = c?.mutation
		const fail = (error, message, item) => ({ ...(mutation !== undefined && { mutation }), ok: false, error, message, ...(item && { item: { ...item } }) })
		if (mutation !== undefined && memo[mutation]) {
			const m = memo[mutation], item = m.id !== undefined ? find(m.id) : undefined
			return m.ok ? { mutation, ok: true, ...(item && { item: { ...item } }) } : fail(m.error, m.message, item)
		}
		const remember = (r, id) => {
			if (mutation !== undefined) memo[mutation] = { ok: r.ok, ...(id !== undefined && { id }), ...(!r.ok && { error: r.error, message: r.message }) }
			return r
		}
		if (!c || (c.op !== 'update' && c.op !== 'create')) return remember(fail('invalid', `op ${JSON.stringify(c?.op)}: update or create`))
		const item = c.op === 'update' ? find(c.id) : null
		if (c.op === 'update' && !item) return remember(fail('not_found', `no item ${c.id}`))
		if (plan.source?.readonly) return remember(fail('forbidden', 'this plan is read-only', item), item?.id)
		if (item && c.version !== undefined && c.version !== null && String(c.version) !== String(item.version)) return remember(fail('conflict', `${item.title} changed upstream (version ${item.version}, not ${c.version})`, item), item.id)
		const set = c.set ?? {}
		for (const [k, v] of Object.entries(set)) {
			const field = fieldOf(plan, k)
			// A field whose options are the plan's items takes any item, not only the ones something already points at.
			const anyItem = field?.items === true && [v].flat().every((x) => x === null || find(x))
			const problem = !field ? `no field "${k}"; fields: ${plan.fields.map((f) => f.id).join(', ')}` : !field.writable ? `${k} can't be written` : anyItem ? null : valueProblem(field, v)
			if (problem) return remember(fail('invalid', problem, item), item?.id)
		}
		const anchor = c.place ? ('before' in c.place ? c.place.before : c.place.after) : null
		if (anchor !== null && anchor !== undefined && !find(anchor)) return remember(fail('invalid', `place ${'before' in c.place ? 'before' : 'after'} ${anchor}: no such item`, item), item?.id)
		let target = item
		if (c.op === 'create') {
			if (typeof set.title !== 'string' || !set.title.trim()) return remember(fail('invalid', 'a new item needs a title'))
			let id = `i-${hash(String(mutation ?? JSON.stringify(set)) + items.length)}`
			while (find(id)) id += 'x'
			target = { id, version: 0, title: '' }
			items.push(target)
		}
		for (const [k, v] of Object.entries(set)) {
			if (v === null) delete target[k]
			else target[k] = v
		}
		if (c.op === 'create' || Object.keys(set).length || c.place) target.version = (Number(target.version) || 0) + 1
		if (c.place) {
			items.splice(items.indexOf(target), 1)
			// Directly after an item (null: first), or directly before one (null: last).
			const at = 'before' in c.place ? (anchor === null || anchor === undefined ? items.length : items.findIndex((it) => it.id === String(anchor))) : anchor === null || anchor === undefined ? 0 : items.findIndex((it) => it.id === String(anchor)) + 1
			items.splice(at, 0, target)
		}
		changed = true
		return remember({ ...(mutation !== undefined && { mutation }), ok: true, item: { ...target } }, target.id)
	})
	// The item as it stands once everything has been applied.
	for (const r of results) if (r.item) r.item = { ...(find(r.item.id) ?? r.item) }
	const keys = Object.keys(memo)
	for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete memo[k]
	return { plan: { ...plan, items }, results, seen: memo, changed }
}

/** A compact table of a plan's items, for a terminal or a model. */
export function itemsText(plan, items = plan.items) {
	const cols = plan.fields.filter((f) => f.id !== 'title' && f.id !== 'detail')
	const lines = [`${plan.source.title}${plan.source.readonly ? ' (read-only)' : ''}: ${items.length} item${items.length === 1 ? '' : 's'}`, `fields: ${plan.fields.map((f) => `${f.id}${f.writable ? '' : ' (read-only)'}${f.options ? ` [${f.options.map((o) => o.id).join(', ')}]` : ` <${f.type}>`}`).join('; ')}`]
	for (const it of items) {
		const values = cols.filter((f) => !unset(it[f.id])).map((f) => `${f.id}=${Array.isArray(it[f.id]) ? it[f.id].join(',') : it[f.id]}`)
		lines.push(`${it.id} v${it.version}  ${it.title}${values.length ? `  ${values.join(' ')}` : ''}${it.dependsOn?.length ? `  dependsOn=${it.dependsOn.join(',')}` : ''}`)
	}
	return lines.join('\n')
}
