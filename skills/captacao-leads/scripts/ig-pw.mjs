// Abre 1 URL do Instagram em Chrome headless SEM login (contexto anônimo novo) e imprime JSON com o que a página mostra.
// Não chame direto: use ig-get.py com IG_NAVEGADOR=1, que aplica o freio global (1 por vez, intervalo, resfriamento).
// Precisa de playwright-core resolvível (npm i playwright-core) ou PLAYWRIGHT_CORE=/caminho/playwright-core/index.mjs,
// e de um Chrome instalado (IG_CANAL=chrome, padrão) ou Chromium do Playwright (IG_CANAL=chromium).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core')

const url = process.argv[2]
const canal = process.env.IG_CANAL || 'chrome'
const b = await chromium.launch(canal === 'chromium' ? { headless: true } : { channel: canal, headless: true })
const out = { url }
try {
  const ctx = await b.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 1600 } })
  const p = await ctx.newPage()
  const r = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  out.status = r ? r.status() : 0
  await p.waitForTimeout(5000)
  Object.assign(out, await p.evaluate(() => ({
    final: location.href,
    title: document.title,
    meta: document.querySelector('meta[property="og:description"]')?.content || '',
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 2500),
    imgs: [...document.images].filter(i => i.naturalWidth > 200).map(i => i.currentSrc || i.src).slice(0, 30),
    datas: [...document.querySelectorAll('time[datetime]')].map(t => t.getAttribute('datetime')).slice(0, 20),
    posts: [...new Set([...document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')].map(a => a.href.split('?')[0]))].slice(0, 24),
    links: [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => !h.includes('instagram.com')))].slice(0, 20),
  })))
} catch (e) {
  out.erro = e.message
}
await b.close()
console.log(JSON.stringify(out))
