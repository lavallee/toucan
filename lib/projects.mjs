// Which canvas belongs to which project. A person's repository stays untouched: the link lives in
// ~/.config/toucan/projects.json, so commands run anywhere inside a project find its canvas without --canvas
// (agents' shells don't keep environment variables from one command to the next).

import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { PROJECTS, readJson } from './paths.mjs'

/** The enclosing git repository's top level, or the directory itself. */
export function projectRoot(cwd = process.cwd()) {
	for (let d = cwd; ; d = dirname(d)) {
		if (existsSync(join(d, '.git'))) return d
		if (dirname(d) === d) return cwd
	}
}

/** A directory too general to stand for one project. */
export const tooGeneral = (dir) => dir === homedir() || dirname(dir) === dir

/** A valid canvas name from a directory's name. */
export function slug(dir) {
	const s = basename(dir).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 56)
	return s || 'canvas'
}

/** The project a directory is in, if one has been linked: the nearest linked directory at or above it. */
export function findProject(cwd = process.cwd()) {
	const links = readJson(PROJECTS)
	for (let d = cwd; ; d = dirname(d)) {
		if (links[d]) return { root: d, canvas: links[d] }
		if (dirname(d) === d) return null
	}
}

export function linkProject(root, canvas) {
	mkdirSync(dirname(PROJECTS), { recursive: true })
	const tmp = `${PROJECTS}.${process.pid}.tmp`
	writeFileSync(tmp, JSON.stringify({ ...readJson(PROJECTS), [root]: canvas }, null, 2) + '\n')
	chmodSync(tmp, 0o600)
	renameSync(tmp, PROJECTS)
}

/** Choose a canvas for a project: its existing one, a name someone asked for, or one from the directory's name. */
export function chooseCanvas({ root, name, existing }) {
	const linked = readJson(PROJECTS)[root]
	if (!name && linked && existing.includes(linked)) return { canvas: linked, create: false }
	if (name) return { canvas: name, create: !existing.includes(name) }
	const base = slug(root)
	// Another project's canvas, or one someone made for something else, isn't this project's.
	let canvas = base
	for (let i = 2; existing.includes(canvas); i++) canvas = `${base}-${i}`
	return { canvas, create: true }
}
