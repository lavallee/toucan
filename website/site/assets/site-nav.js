// Group Artoo’s generated links as soon as the header is parsed.
(() => {
  const links = document.querySelector('.site-nav .nav-links')
  if (!links) return
  const toggle = document.querySelector('.site-nav .nav-toggle')
  links.id = 'docs-navigation'
  toggle.setAttribute('aria-controls', links.id)
  const sections = [
    ['Examples', ['use-cases', 'explore', 'gallery']],
    ['Reference', ['features', 'agents', 'extending']],
    ['Design', ['how-it-works', 'habits']],
  ]
  for (const [label, pages] of sections) {
    const menu = document.createElement('details')
    menu.className = 'docs-menu'
    menu.name = 'docs-navigation'
    const summary = document.createElement('summary')
    summary.textContent = label
    const panel = document.createElement('div')
    for (const page of pages) {
      const link = links.querySelector(`a[href="${page}.html"]`)
      if (link) panel.append(link)
    }
    if (!panel.childElementCount) continue
    menu.append(summary, panel)
    links.append(menu)
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.open) { event.preventDefault(); menu.open = false; summary.focus() }
    })
  }
  links.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && links.classList.contains('open') && !event.defaultPrevented) {
      toggle.click()
      toggle.focus()
    }
  })
  document.addEventListener('click', (event) => {
    for (const menu of links.querySelectorAll('details[open]')) {
      if (!menu.contains(event.target)) menu.open = false
    }
  })
})()
