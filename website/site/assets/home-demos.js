const chapterLinks = [...document.querySelectorAll('.story-nav a')]
const chapters = chapterLinks.map((link) => document.getElementById(link.hash.slice(1)))
function markChapter() {
  const readingLine = window.innerHeight * 0.45
  const current = chapters.findLast((chapter) => chapter.getBoundingClientRect().top <= readingLine) || chapters[0]
  for (const link of chapterLinks) {
    if (link.hash === '#' + current.id) link.setAttribute('aria-current', 'location')
    else link.removeAttribute('aria-current')
  }
}
window.addEventListener('scroll', markChapter, { passive: true })
window.addEventListener('resize', markChapter)
markChapter()

const episodePlayer = document.querySelector('.episode-player')
episodePlayer.addEventListener('click', (event) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  const player = document.createElement('iframe')
  player.src = 'https://www.youtube-nocookie.com/embed/LEYJvdjm1U4?autoplay=1'
  player.title = 'Forging Ahead · Working with agents on a canvas'
  player.allow = 'autoplay; encrypted-media; picture-in-picture'
  player.allowFullscreen = true
  player.referrerPolicy = 'strict-origin-when-cross-origin'
  const external = document.createElement('a')
  external.href = episodePlayer.href
  external.textContent = 'Watch on YouTube ↗'
  episodePlayer.replaceWith(player, external)
  player.focus()
})
