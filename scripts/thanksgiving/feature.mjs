// Edit a clean two-turn screen capture. Usage: node scripts/thanksgiving/feature.mjs SOURCE.mp4 SELECTS.json OUTPUT_DIR
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'

const run = promisify(execFile)
const [recording, selects, output] = process.argv.slice(2)
if (!recording || !selects || !output) throw new Error('Pass SOURCE.mp4 SELECTS.json OUTPUT_DIR')
const source = resolve(recording)
const directory = resolve(output)
const { shots, poster } = JSON.parse(readFileSync(selects, 'utf8'))
const temp = mkdtempSync(join(tmpdir(), 'toucan-canvas-film-'))
const viewport = { width: 1600, height: 1100 }
const fps = 30
const frame = { x: 32, y: 24, w: 1536, h: 960 }
const escapeLabel = (label) => label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function matte({ label, caption }) {
	return `<!doctype html><html lang="en"><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;color:#ffeadd;background:#15312a;width:1600px;height:1100px;font-family:Arial,sans-serif}
.window{position:absolute;left:31px;top:23px;width:1538px;height:962px;border:1px solid #739084;background:#f5f6f8;box-shadow:0 12px 60px #081a1479}
.caption{position:absolute;left:37px;right:37px;top:1008px;min-height:65px;display:flex;align-items:center;gap:24px;margin:0;font-weight:600;font-size:44px;letter-spacing:-.025em}
.label{border-right:1px solid #789586;padding-right:24px;color:#ffbc84;font:bold 25px/1 Arial,sans-serif;letter-spacing:.065em;white-space:nowrap}
</style><body><div class="window"></div><p class="caption"><span class="label">${escapeLabel(label)}</span><span>${escapeLabel(caption)}</span></p></body></html>`
}

async function segment(page, shot, index) {
	const picture = join(temp, index + '.png')
	const movie = join(temp, index + '.mp4')
	const count = Math.round(shot.duration * fps)
	const rate = shot.rate ?? 1

	if (!(shot.at >= 0 && count > 0 && rate > 0)) throw new Error('Invalid source timing for shot ' + index)
	await page.setContent(matte(shot))
	await page.screenshot({ path: picture })
	const track = `[1:v]setpts=(PTS-STARTPTS)/${rate},fps=${fps},tpad=stop_mode=clone:stop_duration=0.2`
	let views = `${track},scale=${frame.w}:${frame.h}:flags=lanczos[app]`
	let composite = `[0:v][app]overlay=${frame.x}:${frame.y}`
	if (shot.focus) {
		const [x, y, w, h] = shot.focus
		if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1600 || y + h > 1000) {
			throw new Error('Invalid focus region for shot ' + index)
		}
		views = `${track},split[wide][detail];[wide]scale=${frame.w}:${frame.h}:flags=lanczos,drawbox=color=0x15312a@0.31:t=fill[app];[detail]crop=${w}:${h}:${x}:${y},scale=1040:-2:flags=lanczos,pad=iw+10:ih+10:5:5:color=0x15312a[focus]`
		composite += '[wideMat];[wideMat][focus]overlay=489:948-h'
	}
	if (shot.highlight) {
		const [x, y, w, h] = shot.highlight
		composite += `,drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=0x347452@0.8:t=4`
	}
	await run('ffmpeg', ['-v', 'error', '-y', '-filter_complex_threads', '2',
		'-loop', '1', '-framerate', String(fps), '-i', picture,
		'-ss', String(shot.at), '-t', String(count / fps * rate + .10), '-i', source,
		'-filter_complex', views + ';' + composite,
		'-frames:v', String(count), '-c:v', 'libx264', '-threads', '4', '-preset', 'fast', '-crf', '17',
		'-pix_fmt', 'yuv420p', '-an', movie])
	return movie
}

mkdirSync(directory, { recursive: true })
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
try {
	const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
	const paths = []
	for (const [index, shot] of shots.entries()) paths.push(await segment(page, shot, index))
	const concat = join(temp, 'concat.txt')
	writeFileSync(concat, paths.map((path) => `file '${path}'`).join('\n'))
	const film = join(directory, 'thanksgiving-dinner.mp4')
	await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat, '-c', 'copy', '-movflags', '+faststart', film])
	const posterShot = poster ? await segment(page, { ...poster, duration: .1 }, 'poster') : film
	await run('ffmpeg', ['-v', 'error', '-y', '-i', posterShot, '-frames:v', '1', '-q:v', '2', join(directory, 'thanksgiving-feature.jpg')])
} finally {
	await browser.close()
	rmSync(temp, { recursive: true, force: true })
}
