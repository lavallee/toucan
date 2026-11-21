// Recut the real 1600×1000 two-turn capture. Usage: node scripts/thanksgiving/social.mjs SOURCE.mp4
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'

const run = promisify(execFile)
const publicAssets = fileURLToPath(new URL('../../website/site/assets/use-cases/', import.meta.url))
const socialExports = fileURLToPath(new URL('../../website/work/thanksgiving-social/', import.meta.url))
const [input, selectedFormat] = process.argv.slice(2)
if (!input) throw new Error('Pass the original recording. See website/work/artifact-brief.md.')
const source = resolve(input)
const temp = mkdtempSync(join(tmpdir(), 'toucan-meal-feature-'))
const fps = 30

// Source times belong to the archived take. The two edits keep the before/after canvas states.
const shots = [
	{ id: 'hook', seconds: 1.9, at: 24.6, crop: [48, 270, 1504, 230], where: [[892, 732, 90], [840, 1120, 100], [1050, 638, 106]], mark: 'THANKSGIVING IN TOUCAN', title: 'Five recipes.<br><em>One oven.</em>' },
	{ id: 'links', seconds: 1.7, at: 17.5, crop: [1298, 98, 280, 428], where: [[484, 474, 483], [480, 820, 460], [418, 128, 1051]], mark: 'ROUND 1  /  YOU', title: 'Start with<br><em>five links.</em>' },
	{ id: 'menu', seconds: 2.15, at: 18.57, speed: .75, crop: [18, 86, 1180, 680], where: [[900, 580, 90], [840, 835, 100], [915, 185, 617]], mark: 'ROUND 1  /  CODEX', title: 'Codex builds<br><em>the menu.</em>' },
	{ id: 'detail', seconds: 2.4, at: 28.71, crop: [802, 98, 428, 767], where: [[422, 350, 551], [406, 774, 534], [407, 82, 1010]], mark: 'ZOOM INTO A RECIPE', title: 'Ingredients.<br>Prep.<br><em>Original link.</em>' },
	{ id: 'dinner', seconds: 2.1, at: 31.45, speed: 1.31, crop: [878, 821, 710, 174], where: [[900, 733, 90], [840, 1000, 100], [840, 574, 690]], mark: 'ROUND 2  /  YOU', title: 'Dinner at<br><em>6:00.</em>' },
	{ id: 'timeline', seconds: 2.55, at: 41.88, speed: 1.11, crop: [18, 86, 1164, 753], where: [[900, 602, 90], [840, 862, 100], [906, 144, 619]], mark: 'ROUND 2  /  CODEX', title: 'Codex draws<br><em>the timeline.</em>' },
	{ id: 'oven', seconds: 2.85, at: 50, crop: [46, 294, 1460, 197], where: [[900, 734, 90], [840, 1068, 100], [878, 502, 652]], mark: 'THE OVEN', title: 'One oven.<br><em>Three settings.</em>' },
	{ id: 'logistics', seconds: 2.85, at: 50, crop: [48, 497, 1442, 297], where: [[900, 820, 90], [840, 1110, 100], [890, 526, 642]], mark: 'THE REST OF THE AFTERNOON', title: 'Prep. Finish.<br><em>Host.</em>' },
	{ id: 'close', seconds: 2.45, at: 59.1, crop: [468, 98, 672, 742], where: [[538, 447, 451], [580, 922, 236], [572, 104, 875]], mark: 'TOUCAN', title: 'Dinner<br><em>at six.</em>' },
]
const formats = [
	{ suffix: 'dinner', width: 1600, height: 900, landscape: true },
	{ suffix: 'social', width: 1080, height: 1350 },
	{ suffix: 'vertical', width: 1080, height: 1920, tall: true },
]
const frames = (shot) => Math.round(shot.seconds * fps)
const runtime = shots.reduce((sum, shot) => sum + frames(shot), 0) / fps
const imageUrl = (id) => `data:image/jpeg;base64,${readFileSync(join(publicAssets, 'thanksgiving', id + '.jpg')).toString('base64')}`
const photos = Object.fromEntries(['turkey', 'rolls', 'dressing'].map((id) => [id, imageUrl(id)]))
const even = (n) => Math.round(n / 2) * 2

function placement(shot, format) {
	const [width, top, left] = shot.where[format.landscape ? 2 : format.tall ? 1 : 0]
	const height = even(width * shot.crop[3] / shot.crop[2])
	if (left + width > format.width || top + height > format.height) {
		throw new Error(`The ${shot.id} crop exceeds the ${format.suffix} frame`)
	}
	return { width, height, left, top }
}

function editorial(shot) {
	switch (shot.id) {
		case 'hook': return '<p class="sub">Thanksgiving with a canvas agent.</p>'
		case 'links': return '<p class="sub">Drop the recipe URLs into Toucan chat.</p>'
		case 'menu': return '<p class="sub">Five recipe cards appear on the canvas.</p>'
		case 'detail': return ''
		case 'dinner': return '<p class="sub">Same menu. One new request.</p><div class="prompt-note">Typing in Toucan chat</div>'
		case 'timeline': return '<p class="sub">It plans backward from dinner.</p>'
		case 'oven': return '<div class="temperatures"><b>325<sup>°</sup><small>TURKEY · 1:10</small></b><i>→</i><b>350<sup>°</sup><small>DRESSING · 4:18</small></b><i>→</i><b>375<sup>°</sup><small>ROLLS · 5:31</small></b></div><p class="footnote">The hatched gaps give the oven time to change temperature.</p>'
		case 'logistics': return '<div class="lanes"><div><b>Prep</b><span>Assemble dressing · Proof rolls</span></div><div><b>Finish</b><span>Rest the turkey · Toss salad</span></div><div><b>Host</b><span>Welcome guests · Carve &amp; plate</span></div></div>'
		case 'close': return '<p class="sub">The whole dinner<br>on one canvas.</p>'
	}
}

function plate(shot, format, rect) {
	const photo = shot.id === 'hook' ? 'turkey' : shot.id === 'links' ? 'dressing' : shot.id === 'detail' ? 'rolls' : ''
	const { left, top, width, height } = rect
	const note = editorial(shot)
	const [primary, ...rest] = note.startsWith('<p class="sub">') ? note.split('</p>') : ['', note]
	const closeLink = shot.id === 'close' ? '<div class="cta">lavallee.github.io/toucan</div>' : ''
	return `<!doctype html><html lang="en"><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{--ink:#2e1c24;--paper:#fbefdb;--accent:#a34532;--rule:#b4876e;--muted:#66443e;margin:0;width:100vw;height:100vh;overflow:hidden;position:relative;background:var(--paper);color:var(--ink);font-family:Arial,sans-serif}
body::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 20% 10%,#fff9ec,transparent 57%),radial-gradient(#82615927 1px,transparent 1px) 0 0/17px 17px;pointer-events:none}
.dark{--ink:#fff1dc;--paper:#321c26;--accent:#ffc283;--rule:#b88875;--muted:#f0c9b5}
.dark::before{background:radial-gradient(ellipse at 14% 12%,#512936,transparent 65%),radial-gradient(#ffdeb522 1px,transparent 1px) 0 0/18px 18px}
.picture{position:absolute;object-fit:cover;right:0}
.hook .picture{width:100%;height:100%;object-position:50% 42%}
.hook .shade{position:absolute;inset:0;background:linear-gradient(90deg,#24111af7 6%,#2b1520d4 32%,#2c15204d 65%,transparent 98%),linear-gradient(0deg,#27151b 5%,transparent 39%)}
.links .picture,.detail .picture{left:0;right:auto;bottom:0;width:100%;height:56%;object-position:47% 45%;opacity:.50}
.links .shade,.detail .shade{position:absolute;inset:39% 0 0;background:linear-gradient(180deg,var(--paper),transparent 40%,var(--paper))}
.frame{position:absolute;left:${left - 3}px;top:${top - 3}px;width:${width + 6}px;height:${height + 6}px;background:#f5f6f8;box-shadow:0 12px 34px #25129f15,0 3px 12px #25121e28;border:1px solid #c8a994;border-radius:4px}
.copy{position:absolute;top:177px;left:89px;right:75px}
.mark{font:bold 23px/1 Arial,sans-serif;letter-spacing:.18em;color:var(--accent);margin:0 0 28px;white-space:nowrap}
h1{font:500 112px/.86 Georgia,'Nimbus Roman',serif;letter-spacing:-.06em;margin:0;text-wrap:balance}
em{font-weight:400;color:var(--accent)}
.sub{font:32px/1.21 Arial,sans-serif;margin:31px 0 0;color:var(--muted)}
.brand,.credit{position:absolute;bottom:51px;font-size:22px;letter-spacing:.012em;color:var(--muted)}
.brand{left:88px;font-weight:bold}
.credit{right:96px;text-align:right}
.hook .copy{top:255px}
.hook h1{font-size:139px}
.hook .sub{font-weight:bold;max-width:620px}
.links h1,.dinner h1{font-size:124px}
.links .sub,.detail .sub{max-width:300px}
.prompt-note,.cta{font: bold 24px/1.3 Arial,sans-serif;color:var(--accent)}
.prompt-note{position:absolute;left:${left}px;top:${top - 51}px}
.links .copy,.detail .copy{left:84px;right:542px;top:222px}
.links .sub{max-width:410px}
.detail h1{font-size:89px;line-height:.94}
.dinner h1{font-size:143px}
.dinner .copy{top:178px}
.dinner .prompt-note{top:${top - 59}px}
.temperatures > *[data-pending]{visibility:hidden}
.temperatures{position:absolute;top:${top - 183}px;left:${left}px;width:${width}px;display:flex;justify-content:space-between;align-items:center;gap:15px}
.temperatures b{font:500 99px/.84 Georgia,'Nimbus Roman',serif;color:#97402f;letter-spacing:-.055em;width:26%;border-bottom:3px solid currentColor;padding-bottom:14px}
.temperatures b:nth-of-type(2){color:#9e3c59}
.temperatures b:nth-of-type(3){color:#79530f}
.temperatures sup{font-size:.54em;vertical-align:top}
.temperatures small{display:block;font:bold 20px/1.1 Arial,sans-serif;letter-spacing:.08em;margin-top:13px}
.temperatures i{font:44px/1 Arial,sans-serif;color:#946556}
.footnote,.lanes{position:absolute;left:${left}px;width:${width}px;top:${top + height + 36}px;color:var(--ink)}
.footnote{font-size:29px;line-height:1.24;margin:0;max-width:700px}
.lanes{display:grid;top:${top - 263}px;gap:15px;font:34px/1.2 Arial,sans-serif}
.lanes div{display:flex;gap:16px;border-bottom:1px solid #b4876e80;padding-bottom:11px}
.lanes b{color:#7c5116;min-width:117px}
.lanes div:nth-child(2) b{color:#286157}
.lanes div:nth-child(3) b{color:#725184}
.close .copy{top:175px;right:590px}
.close h1{font-size:124px}
.close .cta{margin-top:35px;font-size:27px;display:inline-block;padding-bottom:7px;border-bottom:1px solid #c08b73}
.close .sub{max-width:375px}
.close .brand{visibility:hidden}
.close .credit{bottom:48px}
.close .frame{box-shadow:0 5px 85px #13091494;border-color:#fff1dc}
@media (max-aspect-ratio:3/4){
 .copy{top:380px;left:100px;right:130px}
 .hook .copy{top:492px}
 .hook .picture{height:1270px;object-position:51% 38%}
 .hook .shade{background:linear-gradient(90deg,#24111add 4%,#2b152088 42%,transparent 94%),linear-gradient(0deg,#27151b 27%,#27151bb3 46%,transparent 79%)}
 .brand,.credit,.close .credit{bottom:297px}
 .brand{left:101px}
 .credit{right:141px}
 .links .copy,.detail .copy{top:480px;left:98px}
 .dinner .copy{top:400px}
 .close .copy{top:342px;right:130px}
 .detail h1{font-size:92px}
 .links .picture,.detail .picture{bottom:320px}
 .links .shade,.detail .shade{inset:26% 0 13%;background:linear-gradient(180deg,var(--paper) 2%,transparent 32%,transparent 72%,var(--paper))}
}
@media (min-aspect-ratio:1/1){
 .copy{left:105px;right:900px;top:228px}
 .mark{font-size:21px}
 h1{font-size:106px}
 .hook .copy{top:195px}
 .hook .picture{width:1110px;object-position:56% 42%}
 .hook .sub{max-width:740px}
 .links .copy,.detail .copy{left:105px;right:800px;top:209px}
 .links .picture,.detail .picture{left:auto;right:0;width:830px;height:100%;opacity:.78}
 .links .shade,.detail .shade{inset:0;background:linear-gradient(90deg,var(--paper) 45%,transparent 83%),linear-gradient(0deg,var(--paper),transparent 23%)}
 .links .sub{max-width:455px}
 .detail h1{font-size:115px}
 .menu h1,.timeline h1{font-size:93px}
 .menu .copy,.timeline .copy{right:1000px;top:228px}
 .dinner .copy{top:190px}
 .dinner h1{font-size:156px}
 .oven .copy,.logistics .copy{right:985px;top:216px}
 .oven h1,.logistics h1{font-size:96px}
 .logistics .lanes{top:277px;font-size:31px}
 .brand,.credit,.close .credit{bottom:43px}
 .brand{left:106px}
 .close .copy{top:214px;right:890px}
 .close h1{font-size:151px}
}
</style><body class="${shot.id} ${['hook','dinner','close'].includes(shot.id) ? 'dark' : ''}">
${photo ? `<img class=picture alt="" src="${photos[photo]}"><div class=shade></div>` : ''}
<div class=frame></div>
<div class=copy><p class=mark>${shot.mark}</p><h1>${shot.title}</h1>${primary ? primary + '</p>' : ''}${closeLink}</div>
${rest.join('')}
<div class=brand>${['links','menu','dinner','timeline'].includes(shot.id) ? 'Real session · edited for time' : 'toucan'}</div>
<div class=credit>Made with tldraw</div>`
}

async function capturePlate(page, shot, format, rect) {
	const name = `${format.suffix}-${shot.id}`
	await page.setContent(plate(shot, format, rect))
	await page.evaluate(() => Promise.all(Array.from(document.images, (image) => image.decode())))
	if (shot.id !== 'oven') {
		const path = join(temp, `${name}.png`)
		await page.screenshot({ path })
		return ['-loop', '1', '-framerate', String(fps), '-i', path]
	}

	const states = [
		{ count: 1, hold: .30 },
		{ count: 3, hold: .33 },
		{ count: 5, hold: frames(shot) / fps },
	]
	const list = join(temp, `${name}-plates.txt`)
	const entries = []
	for (const { count, hold } of states) {
		await page.locator('.temperatures > *').evaluateAll((nodes, count) => {
			nodes.forEach((node, index) => node.toggleAttribute('data-pending', index >= count))
		}, count)
		const path = join(temp, `${name}-${count}.png`)
		await page.screenshot({ path })
		entries.push(`file '${path}'\nduration ${hold}`)
	}
	writeFileSync(list, entries.join('\n'))
	return ['-f', 'concat', '-safe', '0', '-i', list]
}

async function render(browser, format) {
	const { suffix, width, height } = format
	const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
	const segments = []
	try {
		for (const shot of shots) {
			const rect = placement(shot, format)
			const background = await capturePlate(page, shot, format, rect)
			const path = join(temp, `${suffix}-${shot.id}.mp4`)
			const [x, y, w, h] = shot.crop
			const duration = frames(shot) / fps
			const sourceDuration = shot.speed ? duration * shot.speed + .14 : .06
			const scaling = `scale=${rect.width}:${rect.height}:flags=lanczos`
			const footage = shot.speed
				? `setpts=(PTS-STARTPTS)/${shot.speed},fps=${fps},${scaling},tpad=stop_mode=clone:stop_duration=0.17`
				: `${scaling},tpad=stop_mode=clone:stop_duration=${duration + .1}`
			const camera = shot.id === 'hook'
				? `,zoompan=z='1+0.048*on/${frames(shot)}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${width}x${height}:fps=${fps}`
				: ''
			await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '2',
				...background,
				'-ss', String(shot.at), '-t', String(sourceDuration), '-i', source,
				'-filter_complex', `[0:v]fps=${fps},tpad=stop_mode=clone:stop_duration=${duration}[plate];[1:v]crop=${w}:${h}:${x}:${y},${footage}[take];[plate][take]overlay=${rect.left}:${rect.top}:repeatlast=1${camera}[out]`,
				'-map', '[out]', '-frames:v', String(frames(shot)), '-c:v', 'libx264', '-threads', '4', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p', '-an', path])
			segments.push(path)
			console.log(`${suffix} / ${shot.id}`)
		}
		const list = join(temp, `${suffix}.txt`)
		writeFileSync(list, segments.map((path) => `file '${path}'`).join('\n'))
		const output = format.landscape ? publicAssets : socialExports
		mkdirSync(output, { recursive: true })
		const target = join(output, `thanksgiving-${suffix}.mp4`)
		await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-i', scorePath, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-af', 'volume=5dB', '-movflags', '+faststart', target])
		if (format.landscape) {
			await run('ffmpeg', ['-v', 'error', '-y', '-i', target, '-frames:v', '1', '-q:v', '2', join(publicAssets, 'thanksgiving-feature.jpg')])
		}
	} finally {
		await page.close()
	}
}

// Short plucked notes and paper taps mark the cuts. The edit also reads with sound off.
function makeScore(path) {
	const sampleRate = 48000
	const samples = Math.round(runtime * sampleRate)
	const wave = new Float32Array(samples)
	const tau = 2 * Math.PI
	const hz = (note) => 440 * 2 ** ((note - 69) / 12)
	const tone = (time, note, level, decay) => {
		const first = Math.round(time * sampleRate)
		const length = Math.min(samples - first, Math.round(decay * 5 * sampleRate))
		for (let i = 0; i < length; i++) {
			const t = i / sampleRate
			const phase = tau * hz(note) * t
			const envelope = (1 - Math.exp(-t * 260)) * Math.exp(-t / decay)
			const harmonics = Math.sin(phase) + .26 * Math.sin(2 * phase) * Math.exp(-11 * t) + .09 * Math.sin(3 * phase)
			wave[first + i] += harmonics * envelope * level
		}
	}
	const phrases = [
		[0, 65, 72, 76, 74], [1.9, 58, 69, 72, 74], [3.6, 60, 76, 79, 77],
		[5.77, 65, 72, 76, 81], [8.17, 62, 69, 72, 77], [10.27, 58, 70, 74, 77],
		[15.67, 60, 72, 76, 79], [18.53, 53, 69, 72, 77],
	]
	for (const [time, bass, ...notes] of phrases) {
		tone(time, bass, .15, .55)
		notes.forEach((note, index) => tone(time + .05 + index * .33, note, .12, .30))
	}
	for (const [index, note] of [65, 69, 72].entries()) {
		tone(12.82 + index * .32, note, .19, .37)
	}
	for (const [start, count] of [[1.96, 3], [8.34, 10]]) {
		for (let index = 0; index < count; index++) tone(start + .107 * index, 103 + index % 3, .023, .018)
	}
	const pcm = Buffer.alloc(44 + samples * 2)
	pcm.write('RIFF', 0)
	pcm.writeUInt32LE(pcm.length - 8, 4)
	pcm.write('WAVEfmt ', 8)
	pcm.writeUInt32LE(16, 16)
	pcm.writeUInt16LE(1, 20)
	pcm.writeUInt16LE(1, 22)
	pcm.writeUInt32LE(sampleRate, 24)
	pcm.writeUInt32LE(sampleRate * 2, 28)
	pcm.writeUInt16LE(2, 32)
	pcm.writeUInt16LE(16, 34)
	pcm.write('data', 36)
	pcm.writeUInt32LE(samples * 2, 40)
	for (let i = 0; i < samples; i++) {
		const fade = Math.min(1, (samples - i) / (sampleRate * .5))
		pcm.writeInt16LE(Math.round(wave[i] * fade * 32767), 44 + i * 2)
	}
	writeFileSync(path, pcm)
}

const scorePath = join(temp, 'score.wav')
makeScore(scorePath)
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
try {
	const exports = selectedFormat ? formats.filter((format) => format.suffix === selectedFormat) : formats
	if (!exports.length) throw new Error(`Unknown output format: ${selectedFormat}`)
	for (const format of exports) await render(browser, format)
	console.log(`${runtime.toFixed(2)}s`)
} finally {
	await browser.close()
	rmSync(temp, { recursive: true, force: true })
}
