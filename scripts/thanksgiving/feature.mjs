// Cut the site film from the original 1600×1000 Toucan session.
// Usage: node scripts/thanksgiving/feature.mjs SOURCE.mp4 OUTPUT_DIRECTORY [conflict|result]
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'

const run = promisify(execFile)
const [recording, output, opening = 'conflict'] = process.argv.slice(2)
if (!recording || !output || !['conflict', 'result'].includes(opening)) {
	throw new Error('Pass SOURCE.mp4 OUTPUT_DIRECTORY [conflict|result]')
}
const source = resolve(recording)
const destination = resolve(output)
const assets = fileURLToPath(new URL('../../website/site/assets/use-cases/thanksgiving/', import.meta.url))
const temp = mkdtempSync(join(tmpdir(), 'thanksgiving-feature-'))
const viewport = { width: 1600, height: 900 }
const fps = 30

// Crops refer to the original recording. The destination rectangle uses the source aspect ratio.
const result = { id: 'result', seconds: 1.8, at: 24.6, crop: [48, 270, 1504, 234], rect: [76, 516, 1448] }
const conflict = [
	{ id: 'rolls', seconds: .9, photo: 'rolls', dish: 'PARKER HOUSE ROLLS', temp: 375 },
	{ id: 'turkey', seconds: .9, photo: 'turkey', dish: 'ROAST TURKEY', temp: 325 },
]
const sequence = [
	...(opening === 'conflict' ? conflict : [result]),
	{ id: 'links', seconds: 1.3, at: 17.5, crop: [1298, 96, 280, 254], rect: [1030, 228, 490] },
	{ id: 'menu', seconds: 1.6, at: 18.70, speed: 1.0, crop: [18, 78, 1180, 688], rect: [155, 104, 1290] },
	{ id: 'detail', seconds: 1.55, at: 28.71, crop: [802, 100, 434, 764], rect: [981, 92, 414] },
	{ id: 'dinner', seconds: 2.1, at: 31.6, speed: 1.30, crop: [878, 824, 714, 171], rect: [89, 515, 1422] },
	{ id: 'timeline', seconds: 2.65, at: 42.18, speed: 1.02, crop: [18, 84, 1166, 756], rect: [200, 82, 1200] },
	{ id: 'oven', seconds: 2.15, at: 50, crop: [46, 296, 1462, 198], rect: [76, 475, 1448] },
	{ id: 'prep', seconds: 2.15, at: 50, crop: [48, 496, 1442, 299], rect: [76, 467, 1448] },
	{ id: 'end', seconds: 1.45, at: 59.1, crop: [470, 101, 664, 726], rect: [885, 63, 692] },
]
const count = (entry) => Math.round(entry.seconds * fps)
const runtime = sequence.reduce((n, entry) => n + count(entry), 0) / fps
const photoUrl = (name) => 'data:image/jpeg;base64,' + readFileSync(join(assets, name + '.jpg')).toString('base64')

function labels(shot) {
	switch (shot.id) {
		case 'rolls':
		case 'turkey':
			return `<section class="temperature title"><p>${shot.dish}</p><h1>${shot.temp}<sup>°F</sup></h1></section>`
		case 'result':
			return '<section class="title"><p>THANKSGIVING IN TOUCAN</p><h1>Five links.<br><em>One oven.</em></h1></section>'
		case 'links':
			return '<section class="title"><p>01  /  THE MENU</p><h1>One oven.</h1><div class="desc">First, give Codex five recipe links.</div></section>'
		case 'menu':
			return '<div class="strip">01  /  CODEX BUILDS THE MENU</div>'
		case 'detail':
			return '<section class="title"><p>ON THE CANVAS</p><h1>Ingredients<br>&amp; prep</h1><div class="desc">With a link to each original recipe.</div></section>'
		case 'dinner':
			return '<section class="title"><p>02  /  THE SCHEDULE</p><h1>Dinner at <em>6:00.</em></h1></section><div class="prompt">THE NEXT REQUEST IN TOUCAN CHAT</div>'
		case 'timeline':
			return '<div class="strip">02  /  CODEX DRAWS THE SCHEDULE</div>'
		case 'oven':
			return '<div class="summary"><h1>One oven, three temperatures.</h1><div class="cells"><b>325°F<small>1:10 · TURKEY</small></b><b>350°F<small>4:18 · DRESSING</small></b><b>375°F<small>5:31 · ROLLS</small></b></div></div><div class="under">The gaps give the oven time to heat up.</div>'
		case 'prep':
			return '<div class="summary"><h1>The whole afternoon.</h1><div class="cells"><b>Prep<small>4:45 · SHAPE AND PROOF ROLLS</small></b><b>Finish<small>5:40 · TOSS SALAD</small></b><b>Host<small>5:25 · WELCOME GUESTS</small></b></div></div>'
		case 'end':
			return '<section class="title"><p>TOUCAN</p><h1>Rolls out at 5:55.<br><em>Dinner at six.</em></h1><div class="desc">Open the editable Thanksgiving board.</div></section>'
	}
}

function artwork(shot, box) {
	const food = shot.photo ?? { result: 'turkey', detail: 'rolls' }[shot.id]
	return `<!doctype html><html lang="en"><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{--dark:#142e26;--light:#fff1d8;--paper:#f6eedc;--accent:#ffbf86;margin:0;position:relative;width:1600px;height:900px;overflow:hidden;background:var(--dark);color:var(--light);font-family:Arial,sans-serif}
body:before{content:"";position:absolute;inset:0;background:radial-gradient(#fbe5c531 1px,transparent 1px) 0 0/21px 21px;mask-image:linear-gradient(90deg,#000,transparent 92%)}
body.oven,body.prep,body.detail{--dark:#f6eedc;--light:#183329;--accent:#9d4230}
.food{position:absolute;inset:0 0 0 auto;width:1150px;height:900px;object-fit:cover;object-position:50% 47%}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,#112b22 10%,#112b22eb 28%,#112b2260 58%,transparent 82%),linear-gradient(0deg,#0b201b75,transparent 30%)}
.rolls .food{object-position:53% 44%}.turkey .food{object-position:50% 38%}
.panel{position:absolute;background:#f5f6f8;border-radius:10px;box-shadow:0 18px 80px #142e2645}
.title{position:absolute;left:82px;top:200px}
.title p,.strip,.prompt{margin:0 0 31px;font:bold 27px/1 Arial,sans-serif;letter-spacing:.14em;color:var(--accent)}
h1{margin:0;font:500 122px/.92 Georgia,'Nimbus Roman',serif;letter-spacing:-.06em}
h1 em{font-weight:400;color:var(--accent)}
.temperature{top:260px}.temperature h1{font-size:245px;line-height:.88}
sup{font:500 .40em Georgia,serif;vertical-align:top;margin-left:14px;letter-spacing:-.055em}
.result .title{top:130px}
.desc{font-size:35px;line-height:1.18;margin-top:39px;max-width:500px}
.detail .title{top:217px}
.detail .food{width:900px;opacity:.36;object-position:53% 45%}
.detail .shade{background:linear-gradient(90deg,#f6eedc 42%,#f6eedc55 77%,#f6eedc00 95%),linear-gradient(0deg,#f6eedc 1%,transparent 28%)}
.links .title{top:229px}.links h1{font-size:150px}
.detail h1{font-size:111px}
.dinner .title{top:150px}
.dinner h1{font-size:178px}
.prompt{position:absolute;top:461px;left:89px;font-size:20px}
.strip{position:absolute;top:29px;left:${box?.x ?? 82}px;font-size:34px;margin:0}
.summary{position:absolute;top:93px;left:76px;right:76px}
.summary h1{font-size:89px}
.cells{display:grid;grid-template-columns:repeat(3,1fr);gap:21px;margin-top:44px}
.cells b{padding-top:19px;border-top:3px solid currentColor;font:500 75px/.96 Georgia,serif;letter-spacing:-.05em;color:#93432f}
.cells b:nth-child(2){color:#466747}.cells b:nth-child(3){color:#794b28}
.cells small{display:block;margin-top:12px;font:bold 24px/1.1 Arial,sans-serif;letter-spacing:.045em;color:var(--light)}
.under{position:absolute;top:711px;left:76px;font-size:29px}
.end .title{top:239px}
.end h1{font-size:99px}
.footer{position:absolute;left:76px;right:76px;bottom:24px;display:flex;justify-content:space-between;font:500 18px/1 Arial,sans-serif;letter-spacing:.04em}
.rolls .footer,.turkey .footer,.result .footer{font-size:23px;bottom:31px}
</style><body class="${shot.id}">
${food ? `<img alt="" class="food" src="${photoUrl(food)}"><div class="shade"></div>` : ''}
${box ? `<div class="panel" style="left:${box.x-4}px;top:${box.y-4}px;width:${box.w+8}px;height:${box.h+8}px"></div>` : ''}
${labels(shot)}
<div class="footer"><span>${shot.crop ? 'TOUCAN · REAL SESSION, EDITED FOR TIME' : 'THANKSGIVING IN TOUCAN'}</span><span>${shot.crop ? 'Made with tldraw' : ''}</span></div>
</body></html>`
}

async function segment(page, shot) {
	const duration = count(shot) / fps
	const picture = join(temp, shot.id + '.png')
	const movie = join(temp, shot.id + '.mp4')
	const [x, y, w] = shot.rect ?? []
	const box = shot.crop && { x, y, w, h: Math.round(w * shot.crop[3] / shot.crop[2] / 2) * 2 }
	if (box && (box.x + box.w > viewport.width || box.y + box.h > viewport.height)) {
		throw new Error(shot.id + ' is outside the video')
	}
	await page.setContent(artwork(shot, box))
	await page.evaluate(() => Promise.all(Array.from(document.images, (image) => image.decode())))
	await page.screenshot({ path: picture })
	const inputs = ['-loop', '1', '-framerate', String(fps), '-i', picture]
	let operation = []
	if (box) {
		const rate = shot.speed ?? 1
		const length = shot.speed ? duration * rate + .12 : .05
		inputs.push('-ss', String(shot.at), '-t', String(length), '-i', source)
		const [cx, cy, cw, ch] = shot.crop
		operation = ['-filter_complex', `[1:v]crop=${cw}:${ch}:${cx}:${cy},setpts=(PTS-STARTPTS)/${rate},fps=${fps},scale=${box.w}:${box.h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=${duration}[take];[0:v][take]overlay=${box.x}:${box.y}`]
	} else {
		operation = ['-vf', `zoompan=z='1+0.035*on/${count(shot)}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1600x900:fps=${fps}`]
	}
	await run('ffmpeg', ['-v', 'error', '-y', '-filter_complex_threads', '2', ...inputs, ...operation,
		'-frames:v', String(count(shot)), '-c:v', 'libx264', '-threads', '4', '-preset', 'fast',
		'-crf', '17', '-pix_fmt', 'yuv420p', '-an', movie])
	return movie
}

mkdirSync(destination, { recursive: true })
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
try {
	const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
	const files = []
	for (const shot of sequence) files.push(await segment(page, shot))
	const concat = join(temp, 'concat.txt')
	writeFileSync(concat, files.map((path) => `file '${path}'`).join('\n'))
	await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat, '-c', 'copy', '-movflags', '+faststart', join(destination, 'thanksgiving-dinner.mp4')])
	const poster = opening === 'conflict' ? await segment(page, result) : files[0]
	await run('ffmpeg', ['-v', 'error', '-y', '-i', poster, '-frames:v', '1', '-q:v', '2', join(destination, 'thanksgiving-feature.jpg')])
	console.log(`${opening}: ${runtime.toFixed(2)}s in ${destination}`)
} finally {
	await browser.close()
	rmSync(temp, { recursive: true, force: true })
}
