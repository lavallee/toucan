// Loop silent demos in view. Keep a viewer's manual pause when they return.
const demos = [...document.querySelectorAll('video[data-demo]')]
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const inView = new Set()
const manuallyPaused = new WeakSet()
const automaticPauses = new WeakSet()
function syncDemo(video) {
  if (!inView.has(video) || document.hidden || reducedMotion.matches) {
    if (!video.paused) {
      automaticPauses.add(video)
      video.pause()
    }
  } else if (!manuallyPaused.has(video) && video.paused) {
    video.play().catch(() => {})
  }
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.intersectionRatio >= 0.2) inView.add(entry.target)
    else inView.delete(entry.target)
    syncDemo(entry.target)
  }
}, { threshold: [0, 0.2] })
for (const video of demos) {
  const bar = document.createElement('div')
  bar.className = 'demo-controls'
  const playback = document.createElement('button')
  playback.type = 'button'
  const labelPlayback = () => {
    playback.textContent = video.paused ? 'Play demo' : 'Pause demo'
  }
  labelPlayback()
  playback.addEventListener('click', () => {
    if (video.paused) video.play().catch(labelPlayback)
    else video.pause()
  })
  video.addEventListener('play', labelPlayback)
  video.addEventListener('pause', labelPlayback)

  const controls = document.createElement('button')
  controls.type = 'button'
  controls.textContent = 'Player controls'
  controls.setAttribute('aria-pressed', 'false')
  controls.addEventListener('click', () => {
    video.controls = !video.controls
    controls.setAttribute('aria-pressed', String(video.controls))
  })
  bar.append(playback, controls)
  video.after(bar)
  video.addEventListener('pause', () => {
    if (!automaticPauses.delete(video)) manuallyPaused.add(video)
  })
  video.addEventListener('play', () => manuallyPaused.delete(video))
  observer.observe(video)
}
document.addEventListener('visibilitychange', () => demos.forEach(syncDemo))
reducedMotion.addEventListener('change', () => demos.forEach(syncDemo))
