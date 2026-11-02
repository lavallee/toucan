// Checks for server/routines.mjs: headers parse, banked routines shadow shipped ones, and the program
// handed to a canvas has its args in scope.
//   node scripts/routines-check.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compose, createRoutines, parse } from '../server/routines.mjs'

const dir = mkdtempSync(join(tmpdir(), 'toucan-routines-'))
try {
	const p = parse('x', '// routine: Do X\n// description: Does it.\n// engines: tldraw\n\nreturn 1\n')
	assert.deepEqual([p.title, p.description, p.engines], ['Do X', 'Does it.', ['tldraw']])
	assert.deepEqual([parse('y', 'return 1').title, parse('y', 'return 1').engines], ['y', ['tldraw', 'excalidraw']], 'a bare file still works')
	assert.equal(parse('z', 'return 1\n// routine: not a header').title, 'z', 'a header ends at the first code')

	const composed = compose({ title: 'New\ntitle', engines: ['excalidraw'], code: '// routine: Old\nreturn 2' })
	assert.equal(composed, '// routine: New title\n// engines: excalidraw\n\nreturn 2', 'fields passed replace the header')

	assert.equal(compose({ code: '// routine: Keep\n// description: me\n// engines: tldraw\n\nreturn 1' }), '// routine: Keep\n// description: me\n// engines: tldraw\n\nreturn 1', 'a header stays when no fields are passed')
	assert.equal(compose({ title: 'New', code: '// routine: Old\n// engines: tldraw\n\nreturn 1' }), '// routine: New\n// engines: tldraw\n\nreturn 1', 'only the fields passed change')
	assert.equal(compose({ code: 'const s = 1\n// routine: inside\nreturn s' }), 'const s = 1\n// routine: inside\nreturn s', 'header-like lines in the code are left alone')

	const shipped = join(dir, 'shipped')
	mkdirSync(shipped)
	writeFileSync(join(shipped, 'a.js'), '// routine: Shipped A\nreturn "shipped"')
	const r = createRoutines({ shipped, data: join(dir, 'data') })
	assert.deepEqual(r.list().map((x) => [x.name, x.source]), [['a', 'shipped']])
	assert.equal(r.remove('a'), false, 'a shipped routine cannot be removed')

	r.save('b', { title: 'Banked B', description: 'd', code: 'return args.n' })
	r.save('a', { title: 'My A', code: 'return "mine"' })
	assert.deepEqual(r.list().map((x) => [x.name, x.title, x.source]), [['b', 'Banked B', 'banked'], ['a', 'My A', 'banked']], 'a banked routine replaces a shipped one')
	assert.ok(r.remove('a'))
	assert.equal(r.get('a').title, 'Shipped A', 'removing it brings the shipped one back')

	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
	assert.equal(await new AsyncFunction(r.program(r.get('b'), { n: 7 }))(), 7, 'args reach the routine')

	// The routines toucan ships parse and name real engines.
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
	const real = createRoutines({ shipped: join(root, 'routines'), data: join(dir, 'none') }).list()
	assert.ok(real.length >= 2, 'shipped routines found')
	for (const x of real) {
		assert.ok(x.title !== x.name && x.description, `${x.name} has a title and a description`)
		new AsyncFunction('editor', 'tl', 'toucan', r.program(x, {})) // compiles
	}
	console.log('ok  routines')
} finally {
	rmSync(dir, { recursive: true, force: true })
}
