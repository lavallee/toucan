// Frame the full Toucan recording for a 4:5 feed while keeping the chat and watermark visible.
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'

const out = fileURLToPath(new URL('../../website/site/assets/use-cases/', import.meta.url))
const temp = mkdtempSync(join(tmpdir(), 'toucan-meal-social-'))
const photos = ['turkey', 'dressing', 'rolls', 'salad', 'cranberry'].map((dish) => (
	'<img alt="" src="data:image/jpeg;base64,' + readFileSync(join(out, 'thanksgiving', dish + '.jpg')).toString('base64') + '">'
)).join('')
const plate = join(temp, 'plate.png')
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
try {
	const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 })
	await page.setContent(`
<!doctype html><html lang="en"><style>
*{box-sizing:border-box}
body{margin:0;background:#321d29;color:#fff4dd;font-family:system-ui,sans-serif}
header{padding:38px 48px 26px}
h1{font:600 102px/.94 Georgia,serif;letter-spacing:-.055em;margin:8px 0 16px}
p{font-size:31px;margin:0;color:#f3b97e}
.menu{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;height:178px;margin:0 24px}
.menu img{width:100%;height:100%;object-fit:cover}
footer{position:absolute;top:1124px;left:48px;right:48px;display:flex;justify-content:space-between;align-items:end;padding-top:122px}
footer p{font-size:29px;color:#f8e8da}
footer b{font-size:35px}
</style><header><h1>Dinner at six</h1><p>Five recipes. One oven. Two rounds with an agent.</p></header>
<div class=menu>${photos}</div>
<footer><p>Build the menu, then make the oven plan.</p><b>toucan</b></footer></html>`)
	await page.locator('img').last().evaluate((image) => image.decode())
	await page.screenshot({ path: plate })
	await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', plate,
		'-i', join(out, 'thanksgiving-dinner.mp4'), '-filter_complex', '[1:v]scale=1080:676[app];[0:v][app]overlay=0:428:shortest=1',
		'-c:v', 'libx264', '-threads', '4', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
		'-an', join(out, 'thanksgiving-social.mp4')])
} finally {
	await browser.close()
	rmSync(temp, { recursive: true, force: true })
}
