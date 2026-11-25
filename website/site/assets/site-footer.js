// One footer for the collection. In the full-screen explorer it opens from the toolbar.
(() => {
  const footer = document.createElement('footer')
  footer.className = 'toucan-footer'
  footer.innerHTML = `
    <div class="footer-inner">
      <section><h2>Toucan</h2>
        <p>Toucan’s original code and documentation are released under the <a href="https://github.com/lavallee/toucan/blob/main/LICENSE">MIT License</a>. Dependencies are licensed separately by their respective owners, including the <a href="https://tldraw.dev/community/license">tldraw SDK</a>.</p>
        <a href="https://github.com/lavallee/toucan">Toucan on GitHub ↗</a>
      </section>
      <nav aria-label="Lyra"><h2>Lyra</h2>
        <a href="https://lyra-forge.com/">Lyra Forge · Studio</a>
        <a href="https://www.lyra-tk.com/">Lyra TK · Consulting</a>
      </nav>
      <nav aria-label="More open source"><h2>More open source</h2>
        <a href="https://lavallee.github.io/flip/">Flip · Research notebooks</a>
        <a href="https://lavallee.github.io/artoo/">Artoo · HTML publishing</a>
        <a href="https://lavallee.github.io/vizier/">Vizier · Chart design</a>
        <a href="https://lavallee.github.io/somm/">Somm · Model routing</a>
        <a href="https://lyra-forge.com/open-source/">Full project catalog ↗</a>
      </nav>
    </div>`
  const explorer = document.querySelector('.bar .maps')
  if (explorer) {
    const menu = document.createElement('details')
    menu.className = 'explorer-links'
    const toggle = document.createElement('summary')
    toggle.textContent = 'About'
    menu.append(toggle, footer)
    explorer.parentElement.append(menu)
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { menu.open = false; toggle.focus() }
    })
  } else document.body.append(footer)
})()
