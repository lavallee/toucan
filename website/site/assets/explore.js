// A static copy of a toucan canvas: tldraw's own SVG, with the details and walking the app would show. See scripts/build-docs.mjs.
(() => {
	const maps = window.TOUCAN_MAPS ?? {}
	const order = ['odyssey', 'meditations', 'shop'].filter((id) => maps[id])
	const $ = (id) => document.getElementById(id)
	const stage = $('stage'), world = $('world'), mark = $('mark'), card = $('card')
	const params = new URLSearchParams(location.search)
	let map, nodes, selected = null
	let cam = { x: 0, y: 0, z: 1 }, bounds = null, offset = { x: 0, y: 0 }, labels = []

	const apply = () => {
		world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`
		// Frame names stay readable at any zoom, as they do in the app.
		for (const { el, f } of labels) el.style.transform = `translate(${cam.x + (f.x - offset.x) * cam.z}px, ${cam.y + (f.y - offset.y) * cam.z - 25}px)`
		if (selected) {
			const n = selected
			mark.hidden = false
			mark.style.transform = `translate(${cam.x + (n.x - offset.x) * cam.z - 3}px, ${cam.y + (n.y - offset.y) * cam.z - 3}px)`
			mark.style.width = `${n.w * cam.z + 6}px`
			mark.style.height = `${n.h * cam.z + 6}px`
		} else mark.hidden = true
	}
	const room = () => {
		const r = stage.getBoundingClientRect()
		const covered = !card.hidden && innerWidth > 720 ? card.offsetWidth + 28 : 0
		return { w: r.width - covered, h: r.height }
	}
	const fit = () => {
		const r = room()
		const z = Math.min(1, (r.w - 40) / bounds.w, (r.h - 90) / bounds.h)
		// A little high, to clear the controls along the bottom.
		cam = { z, x: (r.w - bounds.w * z) / 2, y: Math.max(20, (r.h - bounds.h * z) / 2 - 24) }
		apply()
	}
	const zoomAt = (factor, px, py) => {
		const z = Math.min(2.5, Math.max(0.1, cam.z * factor))
		cam.x = px - ((px - cam.x) * z) / cam.z
		cam.y = py - ((py - cam.y) * z) / cam.z
		cam.z = z
		apply()
	}
	const centre = (n) => {
		const r = room()
		const z = Math.max(cam.z, Math.min(0.8, (r.w - 80) / (n.w * 2.2)))
		cam = { z, x: r.w / 2 - (n.x - offset.x + n.w / 2) * z, y: r.h / 2 - (n.y - offset.y + n.h / 2) * z }
		world.style.transition = mark.style.transition = 'transform .25s ease'
		apply()
		setTimeout(() => (world.style.transition = mark.style.transition = ''), 280)
	}
	const button = (text, onClick, cls) => {
		const b = document.createElement('button')
		b.type = 'button'
		b.textContent = text
		if (cls) b.className = cls
		b.onclick = onClick
		return b
	}
	const select = (n, { move = true } = {}) => {
		selected = n
		card.hidden = !n
		if (!n) {
			history.replaceState(null, '', `?map=${map.id}`)
			return apply()
		}
		$('card-title').textContent = n.text
		$('card-detail').textContent = n.detail
		$('card-see').replaceChildren(...n.see.map((s) => {
			const li = document.createElement('li')
			li.append(button(`→ ${s.label || s.text}`, () => go(s.key)))
			return li
		}))
		$('card-walk').replaceChildren(
			...n.prev.map((s) => button(`← ${s.text}`, () => go(s.key), 'prev')),
			...n.next.map((s) => button(`${s.text} →`, () => go(s.key), 'next')),
		)
		history.replaceState(null, '', `?map=${map.id}&box=${encodeURIComponent(n.key)}`)
		if (move) centre(n)
		else apply()
	}
	const go = (key) => {
		const n = nodes.get(key)
		if (n) select(n)
	}
	const pointOn = (e) => {
		const r = stage.getBoundingClientRect()
		return { x: (e.clientX - r.left - cam.x) / cam.z + offset.x, y: (e.clientY - r.top - cam.y) / cam.z + offset.y }
	}
	const hit = (p) => [...nodes.values()].find((n) => p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h) ?? null

	function show(id, box) {
		map = maps[id]
		nodes = new Map(map.nodes.map((n) => [n.key, n]))
		world.innerHTML = map.svg
		const svg = world.querySelector('svg')
		// The SVG's viewBox is in page coordinates, the same ones as the boxes.
		const vb = svg.viewBox.baseVal
		offset = { x: vb.x, y: vb.y }
		bounds = { w: vb.width, h: vb.height }
		svg.setAttribute('width', vb.width)
		svg.setAttribute('height', vb.height)
		svg.style.removeProperty('width')
		svg.style.removeProperty('height')
		for (const { el } of labels) el.remove()
		labels = map.frames.map((f) => {
			const el = document.createElement('div')
			el.className = 'frame-label'
			el.textContent = f.name
			stage.append(el)
			return { el, f }
		})
		$('blurb').textContent = map.blurb
		document.title = `${map.title}: explore — toucan`
		for (const b of document.querySelectorAll('.maps button')) b.setAttribute('aria-current', String(b.dataset.map === id))
		selected = null
		card.hidden = true
		fit()
		const start = box && nodes.get(box)
		if (start) select(start)
		else history.replaceState(null, '', `?map=${id}`)
	}

	document.querySelector('.maps').append(...order.map((id) => {
		const b = button(maps[id].title, () => show(id))
		b.dataset.map = id
		return b
	}))

	// Drag to move; a press that doesn't travel is a click on what's under it.
	let drag = null
	stage.addEventListener('pointerdown', (e) => {
		drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }
		stage.setPointerCapture(e.pointerId)
		stage.classList.add('dragging')
	})
	stage.addEventListener('pointermove', (e) => {
		if (!drag) return
		const dx = e.clientX - drag.x, dy = e.clientY - drag.y
		if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true
		if (drag.moved) {
			cam.x = drag.cx + dx
			cam.y = drag.cy + dy
			apply()
		}
	})
	const release = (e) => {
		if (drag && !drag.moved && e.type === 'pointerup') select(hit(pointOn(e)))
		drag = null
		stage.classList.remove('dragging')
	}
	stage.addEventListener('pointerup', release)
	stage.addEventListener('pointercancel', release)
	stage.addEventListener('wheel', (e) => {
		e.preventDefault()
		const r = stage.getBoundingClientRect()
		zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top)
	}, { passive: false })
	$('zoom-in').onclick = () => zoomAt(1.25, room().w / 2, room().h / 2)
	$('zoom-out').onclick = () => zoomAt(0.8, room().w / 2, room().h / 2)
	$('zoom-fit').onclick = () => fit()
	$('close').onclick = () => select(null)
	addEventListener('keydown', (e) => {
		if (e.key === 'Escape') return select(null)
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
		e.preventDefault()
		if (!selected) return select(map.nodes[0])
		const to = (e.key === 'ArrowRight' ? selected.next : selected.prev)[0]
		if (to) go(to.key)
	})
	addEventListener('resize', () => (selected ? apply() : fit()))
	show(order.includes(params.get('map')) ? params.get('map') : order[0], params.get('box'))
})()
