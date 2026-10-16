#!/usr/bin/env node
// Verificador automatico de previa. Zero custo de modelo (nenhuma chamada a modelo, so navegador headless).
// Uso: node checar-previa.mjs <slug> [--json] [--wa=<digitos do WhatsApp da ficha>] [--previas=<pasta>] [--portas=8800-8899] [--demo=<regex>]
// Le <previas>/<slug>/index.html, serve local (python3 http.server numa porta livre da faixa), mede com Playwright
// (Chrome headless, 1 browser, 1 aba por vez) em 1440x900 e 390x844. Saida: lista ok/FALHA (ou JSON) e rc 0 (tudo ok) / 1 (falha) / 2 (uso).
//
// Configuracao (argumento vence variavel de ambiente):
//   --previas=<pasta>   | PREVIAS_DIR      pasta das previas (padrao: ./previas a partir de onde o comando roda)
//   --portas=A-B ou N   | CHECAR_PORTAS    faixa de portas do servidor local (padrao 8800-8899; so 127.0.0.1)
//   --demo=<regex>      | CHECAR_DEMO      texto que denuncia residuo do kit/modelo de partida (ex.: "Oi, Fulana!")
//   PLAYWRIGHT_CORE=<caminho/playwright-core/index.mjs>  quando playwright-core nao resolve (procura a partir do script e da pasta atual)
//   CHECAR_CANAL=chrome|msedge|chromium  navegador (padrao chrome instalado; chromium = o baixado pelo Playwright)
//   CHROME_PATH=<executavel>             caminho explicito do navegador (vence o canal)
// Instalacao: npm i (na raiz do clone; package.json pina playwright-core) e Google Chrome instalado (ou: npx playwright-core install chromium e CHECAR_CANAL=chromium).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (nome, env) => { const a = args.find(x => x.startsWith(`--${nome}=`)); return a ? a.slice(nome.length + 3) : (process.env[env] || ''); };
let chromium;
try {
  let alvo = process.env.PLAYWRIGHT_CORE;
  if (!alvo) {
    try { alvo = 'playwright-core'; ({ chromium } = await import(alvo)); }
    catch { const { createRequire } = await import('node:module'); alvo = pathToFileURL(createRequire(path.join(process.cwd(), 'x.js')).resolve('playwright-core')).href; }
  }
  if (!chromium) { const m = await import(alvo); chromium = m.chromium || m.default?.chromium; }
  if (!chromium) throw new Error('sem chromium');
}
catch (e) { console.error('playwright-core nao encontrado: rode "npm i" na raiz do clone do crm-leads ou defina PLAYWRIGHT_CORE=/caminho/playwright-core/index.mjs'); process.exit(2); }
const PREVIAS = path.resolve(opt('previas', 'PREVIAS_DIR') || 'previas');
const FAIXA = (() => { const s = opt('portas', 'CHECAR_PORTAS') || '8800-8899'; const m = s.match(/^(\d+)(?:-(\d+))?$/); if (!m) { console.error('faixa de portas invalida: ' + s); process.exit(2); } const a = +m[1], b = +(m[2] || m[1]); return [Math.min(a, b), Math.max(a, b)]; })();
const DEMO = (() => { const s = opt('demo', 'CHECAR_DEMO'); if (!s) return null; try { return new RegExp(s); } catch { console.error('regex --demo invalida'); process.exit(2); } })();
const JSON_OUT = args.includes('--json');
const slug = args.find(a => !a.startsWith('--'));
if (!slug) { console.error('uso: node checar-previa.mjs <slug> [--json] [--wa=55DDDNUMERO] [--previas=<pasta>] [--portas=8800-8899]'); process.exit(2); }
if (!/^[a-z0-9_-]+$/.test(slug)) { console.error('slug invalido (so [a-z0-9_-])'); process.exit(2); }
const DIR = path.join(PREVIAS, slug);
if (!fs.existsSync(path.join(DIR, 'index.html'))) { console.error('nao existe: ' + path.join(DIR, 'index.html')); process.exit(2); }

const checks = [];   // {id, ok, medida, limite}
const avisos = [];
const chk = (id, ok, medida, limite) => checks.push({ id, ok: !!ok, medida: String(medida), limite });
const aviso = (id, msg) => avisos.push(`${id}: ${msg}`);

const HOJE = new Date(); HOJE.setHours(0, 0, 0, 0);
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- servidor ----------
const portaOcupada = (porta, host) => new Promise(res => { const c = net.connect({ port: porta, host }); c.once('connect', () => { c.destroy(); res(true); }); c.once('error', () => res(false)); setTimeout(() => { c.destroy(); res(false); }, 400); });
async function subirServidor() {
  const portas = Array.from({ length: FAIXA[1] - FAIXA[0] + 1 }, (_, i) => FAIXA[0] + i).sort(() => Math.random() - 0.5);
  const esperado = fs.readFileSync(path.join(DIR, 'index.html'));
  for (const porta of portas) {
    if (await portaOcupada(porta, '127.0.0.1') || await portaOcupada(porta, '::1')) continue;   // nunca reusa servidor de outro
    const p = spawn('python3', ['-c', 'import sys,functools,http.server as h; h.ThreadingHTTPServer.request_queue_size=256; h.ThreadingHTTPServer(("127.0.0.1",int(sys.argv[1])), functools.partial(h.SimpleHTTPRequestHandler, directory=sys.argv[2])).serve_forever()', String(porta), DIR], { stdio: 'ignore' });
    let morreu = false; p.on('exit', () => { morreu = true; });
    for (let i = 0; i < 30 && !morreu; i++) {
      await sleep(100);
      if (morreu) break;
      try { const r = await fetch(`http://127.0.0.1:${porta}/index.html`); if (r.ok && Buffer.from(await r.arrayBuffer()).equals(esperado) && !morreu) return { p, porta }; } catch {}
    }
    try { p.kill('SIGKILL'); } catch {}
  }
  throw new Error(`sem porta livre ${FAIXA[0]}-${FAIXA[1]}`);
}

// ---------- imagem: dimensoes ----------
function dimImg(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}
function arquivoLocal(url) {
  if (!url) return null;
  let p; try { p = new URL(url, 'http://x/').pathname; } catch { return null; }
  const f = path.join(DIR, decodeURIComponent(p));
  return f.startsWith(DIR) && fs.existsSync(f) ? f : null;
}

// ---------- medicao dentro da pagina ----------
const MEDIR = async () => {
  const out = {};
  const vw = innerWidth, vh = innerHeight;
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const contaLinhas = rg => { const rs = [...rg.getClientRects()].filter(r => r.width > 1).sort((a, b) => a.top - b.top); const L = []; for (const r of rs) { const cy = (r.top + r.bottom) / 2; const l = L.find(x => cy >= x[0] && cy <= x[1]); if (l) { l[0] = Math.min(l[0], r.top); l[1] = Math.max(l[1], r.bottom); } else L.push([r.top, r.bottom]); } return L.length; };
  const escondido = el => !!el.closest('[aria-hidden="true"]');
  out.vw = vw;
  out.overflow = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.documentElement.clientWidth);
  // imagens
  out.imgs = [...document.images].filter(i => vis(i)).map(i => {
    const r = i.getBoundingClientRect(); const cs = getComputedStyle(i);
    const src = i.currentSrc || i.src || '';
    const nw = i.naturalWidth, nh = i.naturalHeight, cw = r.width, ch = r.height;
    let ratio = null;
    if (nw > 0 && nh > 0) {
      const sx = cw / nw, sy = ch / nh; let s;
      if (cs.objectFit === 'cover') s = Math.max(sx, sy); else if (cs.objectFit === 'contain' || cs.objectFit === 'scale-down') s = Math.min(sx, sy); else s = Math.max(sx, sy) > 0 && Math.abs(sx - sy) < 0.02 ? sx : Math.max(sx, sy);
      ratio = 1 / s;
    }
    return { src: src.split('/').pop().slice(0, 40), svg: /\.svg(\?|$)/.test(src) || src.startsWith('data:image/svg'), w: Math.round(cw), h: Math.round(ch), nw, nh, ratio, broken: i.complete && nw === 0, oculto: escondido(i) };
  });
  // secoes reais
  const temConteudo = s => vis(s) && (s.textContent.trim().length >= 20 || s.querySelector('img'));
  const secs = [...document.querySelectorAll('section')].filter(s => !s.closest('header,footer,nav') && temConteudo(s));
  const hero = [...document.querySelectorAll('header')].filter(h => !h.closest('section') && !h.querySelector('nav') && temConteudo(h) && (h.querySelector('h1') || /hero|topo/i.test(h.className + h.id)));
  const rodape = [...document.querySelectorAll('footer')].filter(f => !f.closest('section') && temConteudo(f));
  out.secoesSection = secs.length; out.secoesHero = hero.length ? 1 : 0; out.secoesRodape = rodape.length ? 1 : 0;
  out.secoes = secs.length + out.secoesHero + out.secoesRodape;
  // nav fixa/sticky
  const navs = [...document.querySelectorAll('header,nav,[role=banner],body *')].filter(e => {
    const cs = getComputedStyle(e); if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
    const r = e.getBoundingClientRect(); return r.top <= 10 && r.top > -200 && r.width >= vw * 0.6 && r.height >= 30 && r.height <= 220 && cs.visibility !== 'hidden' && cs.display !== 'none';
  });
  out.navH = navs.length ? Math.max(...navs.map(n => n.getBoundingClientRect().height)) : 0;
  const parse = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const h = document.documentElement;
  out.scrollPadTop = parse(getComputedStyle(h).scrollPaddingTop);
  out.scrollBehavior = [getComputedStyle(h).scrollBehavior, getComputedStyle(document.body).scrollBehavior];
  const ancoras = [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(x => x.length > 1);
  const alvos = [...new Set(ancoras)].map(x => { try { return document.querySelector(x); } catch { return null; } }).filter(Boolean);
  out.ancoras = alvos.length;
  out.scrollMarginAlvos = alvos.length ? Math.min(...alvos.map(a => parse(getComputedStyle(a).scrollMarginTop))) : 0;
  // carrosseis
  out.carrosseis = [...document.querySelectorAll('body *')].filter(e => {
    const cs = getComputedStyle(e); return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 4 && e.children.length >= 3 && e !== document.body && e !== h;
  }).map(e => {
    const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); const kids = [...e.children].filter(k => vis(k));
    const f = kids[0] ? kids[0].getBoundingClientRect() : null;
    return {
      sel: (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '') || e.tagName,
      snap: cs.scrollSnapType, padL: parse(cs.paddingLeft), spL: /px$/.test(cs.scrollPaddingLeft) ? parse(cs.scrollPaddingLeft) : (cs.scrollPaddingLeft === 'auto' ? 0 : parse(cs.paddingLeft)),
      gap: f ? Math.round(f.left - Math.max(r.left, 0)) : null, naBorda: f ? Math.round(f.left) : null,
    };
  });
  // texto
  out.travessao = (document.body.innerText.match(/—/g) || []).length;
  out.titulo = document.title;
  // h1 / h2
  const h1 = document.querySelector('h1');
  out.h1 = h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : null;
  out.h2s = [...document.querySelectorAll('h2')].map(e => e.textContent.replace(/\s+/g, ' ').trim());
  const linhas = el => { const rg = document.createRange(); rg.selectNodeContents(el); return contaLinhas(rg); };
  if (h1) { out.h1Linhas = linhas(h1); out.h1Balance = getComputedStyle(h1).textWrap; out.h1Fs = parse(getComputedStyle(h1).fontSize); }
  if (h1) { const r = h1.getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(h1); const rr = rg.getBoundingClientRect(); out.h1Corte = (h1.scrollWidth > h1.clientWidth + 1 || r.right > innerWidth + 1 || r.left < -1 || rr.right > innerWidth + 1 || rr.left < -1) ? `scrollW ${h1.scrollWidth} > clientW ${h1.clientWidth}, texto ${Math.round(rr.left)}..${Math.round(rr.right)} em viewport ${innerWidth}` : ''; }
  // marca quebrada
  const marca = (document.title.split(/\s[|\-–—:·]\s/)[0] || '').trim();
  out.marca = marca; out.marcaQuebra = [];
  if (marca.length >= 3) {
    const alvosM = [...document.querySelectorAll('h1,h2,h3,header a,nav a,[class*=logo],[class*=brand],[class*=marca]')].filter(vis).slice(0, 40);
    for (const el of alvosM) {
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const nodes = []; let t = '', n;
      while ((n = tw.nextNode())) { nodes.push([n, t.length]); t += n.nodeValue; }
      const idx = t.toLowerCase().indexOf(marca.toLowerCase()); if (idx < 0) continue;
      const fim = idx + marca.length; const rg = document.createRange();
      for (const [nd, off] of nodes) { if (idx >= off && idx <= off + nd.nodeValue.length) { rg.setStart(nd, idx - off); break; } }
      for (const [nd, off] of nodes) { if (fim >= off && fim <= off + nd.nodeValue.length) { rg.setEnd(nd, fim - off); } }
      if (contaLinhas(rg) > 1) out.marcaQuebra.push(el.tagName.toLowerCase() + ': "' + t.trim().slice(0, 40) + '"');
    }
  }
  // fontes (1 amostra por elemento com texto proprio)
  const fs = {};
  for (const e of document.querySelectorAll('body *')) {
    if (!vis(e)) continue; if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(e.tagName)) continue;
    if (![...e.childNodes].some(c => c.nodeType === 3 && c.nodeValue.trim().length > 1)) continue;
    const s = Math.round(parseFloat(getComputedStyle(e).fontSize) * 10) / 10; fs[s] = (fs[s] || 0) + 1;
  }
  out.fontes = fs;
  // area morta (grid / flex em linha, 1440)
  out.mortas = [];
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e); if (!(cs.display === 'grid' || cs.display === 'inline-grid' || (cs.display === 'flex' && cs.flexDirection.startsWith('row') && /^(normal|flex-start|start|stretch|left)$/.test(cs.justifyContent)))) continue;
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.position === 'fixed') continue;
    const r = e.getBoundingClientRect(); if (r.width < 500 || r.height < 160 || !vis(e) || escondido(e)) continue;
    const kids = [...e.children].filter(k => { const c = getComputedStyle(k); const rr = k.getBoundingClientRect(); return rr.width > 0 && rr.height > 0 && c.position !== 'absolute' && c.position !== 'fixed' && c.display !== 'none'; });
    if (kids.length < 2) continue;
    const pl = parse(cs.paddingLeft), pr = parse(cs.paddingRight); const cw = r.width - pl - pr; if (cw <= 0) continue;
    const iv = kids.map(k => { const rr = k.getBoundingClientRect(); return [Math.max(rr.left, r.left + pl), Math.min(rr.right, r.right - pr)]; }).sort((a, b) => a[0] - b[0]);
    let cov = 0, cur = null; for (const [a, b] of iv) { if (b <= a) continue; if (!cur) cur = [a, b]; else if (a <= cur[1]) cur[1] = Math.max(cur[1], b); else { cov += cur[1] - cur[0]; cur = [a, b]; } } if (cur) cov += cur[1] - cur[0];
    const frac = cov / cw;
    if (frac < 0.6) out.mortas.push({ sel: (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : '') || e.tagName, vazio: Math.round((1 - frac) * 100), w: Math.round(r.width) });
  }
  // foto no hero: imagem raster (img ou background-image) grande dentro da 1a dobra
  {
    const naDobra = r => r.top < vh && r.bottom > 0 && r.width >= vw * 0.4 && r.height >= 120;
    const img = [...document.images].find(i => vis(i) && !escondido(i) && i.naturalWidth > 0 && !/\.svg(\?|$)/.test(i.currentSrc || i.src) && !(i.currentSrc || i.src).startsWith('data:image/svg') && naDobra(i.getBoundingClientRect()));
    let bg = null;
    if (!img) for (const e of document.querySelectorAll('body *')) {
      const b = getComputedStyle(e).backgroundImage;
      if (!b || b === 'none' || !/url\(/.test(b) || /\.svg|image\/svg/.test(b)) continue;
      if (vis(e) && !escondido(e) && naDobra(e.getBoundingClientRect())) { bg = e; break; }
    }
    out.heroFoto = img ? `img ${(img.currentSrc || img.src).split('/').pop().slice(0, 30)} ${Math.round(img.getBoundingClientRect().width)}px` : bg ? `background ${bg.tagName.toLowerCase()}${bg.id ? '#' + bg.id : ''}` : '';
  }
  out.saltos = [];
  for (const a of alvos.slice(0, 6)) { a.scrollIntoView({ behavior: 'instant', block: 'start' }); await new Promise(r => setTimeout(r, 60)); const c = a.querySelector('h1,h2,h3,img,p,a,button'); out.saltos.push(Math.round((c || a).getBoundingClientRect().top)); }
  window.scrollTo(0, 0);
  return out;
};

// dHash das imagens grandes
const DHASH = () => {
  const res = [];
  for (const i of document.images) {
    const r = i.getBoundingClientRect(); const cs = getComputedStyle(i);
    if (r.width < 100 || r.height < 80 || cs.visibility === 'hidden' || cs.display === 'none' || i.closest('[aria-hidden="true"]') || !i.naturalWidth) continue;
    try {
      const c = document.createElement('canvas'); c.width = 9; c.height = 8; const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(i, 0, 0, 9, 8); const d = x.getImageData(0, 0, 9, 8).data; let bits = '';
      for (let y = 0; y < 8; y++) for (let k = 0; k < 8; k++) { const a = (y * 9 + k) * 4, b = (y * 9 + k + 1) * 4; bits += (d[a] * .3 + d[a + 1] * .59 + d[a + 2] * .11) > (d[b] * .3 + d[b + 1] * .59 + d[b + 2] * .11) ? '1' : '0'; }
      res.push({ src: (i.currentSrc || i.src).split('/').pop().slice(0, 40), bits });
    } catch { res.push({ src: 'taint', bits: null }); }
  }
  return res;
};

// mapa do formulario
const MAPEAR_FORM = () => {
  const cont = f => [...f.querySelectorAll('input,select,textarea')].filter(e => !['hidden', 'submit', 'button'].includes(e.type));
  let forms = [...document.querySelectorAll('form')].map(f => ({ f, n: cont(f).length })).filter(x => x.n >= 2).sort((a, b) => b.n - a.n);
  if (!forms.length) return null;
  const f = forms[0].f; const ctls = cont(f);
  window.__cp = ctls;
  window.__cpTap = i => { const e = window.__cp[i]; const l = e.closest('label') || (e.id && document.querySelector('label[for="' + e.id + '"]')); if (l) l.click(); else e.click(); };
  ctls.forEach((e, i) => e.setAttribute('data-cp', i));
  const rotulo = e => { const l = e.closest('label') || (e.id && document.querySelector('label[for="' + e.id + '"]')); return ((l && l.textContent) || e.getAttribute('aria-label') || e.placeholder || e.name || e.id || '').replace(/\s+/g, ' ').trim(); };
  const secao = f.closest('section') || f.parentElement;
  window.__cpSecao = secao;
  return {
    ctls: ctls.map((e, i) => ({
      i, tag: e.tagName.toLowerCase(), type: e.type, name: e.name || '', id: e.id || '', min: e.getAttribute('min'), max: e.getAttribute('max'),
      checked: e.checked, label: rotulo(e), value: e.value,
      opts: e.tagName === 'SELECT' ? [...e.options].map(o => ({ v: o.value, t: o.textContent.trim() })) : null,
    })),
  };
};

// leitura da mensagem
const LER_MSG = () => {
  const dec = u => { try { const x = new URL(u, location.href); const t = x.searchParams.get('text'); return t; } catch { return null; } };
  const links = [...document.querySelectorAll('a[href*="wa.me"],a[href*="api.whatsapp.com"],a[href*="whatsapp.com/send"]')].map(a => ({ a, t: dec(a.href) })).filter(x => x.t !== null);
  const sec = window.__cpSecao;
  const dentro = links.find(x => sec && sec.contains(x.a)) || links[0] || null;
  const SEL = ['[data-msg]', '.wa-balao', '#msg', '#bubble', '.bolha', '.bub', '.bubble', '#prev'];
  let bolha = null;
  for (const s of SEL) { const e = document.querySelector(s); if (e && e.textContent.trim().length > 10) { bolha = e.textContent.replace(/\s+/g, ' ').trim(); break; } }
  return { href: dentro ? dentro.t : null, bolha, todos: links.map(x => x.t) };
};

const BALAO = () => {
  const SEL = ['[data-msg]', '.wa-balao', '#msg', '#bubble', '.bolha', '.bub', '.bubble', '#prev', '.chat', '.sheet'];
  const vh = innerHeight; let melhor = null; const achados = [];
  for (const s of SEL) {
    for (const e of document.querySelectorAll(s)) {
      const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      const vis = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)); const ratio = vis / r.height;
      achados.push({ s, top: Math.round(r.top), bottom: Math.round(r.bottom), ratio });
      if (!melhor || ratio > melhor.ratio) melhor = { s, top: Math.round(r.top), bottom: Math.round(r.bottom), ratio };
    }
  }
  return { melhor, n: achados.length, vh };
};


// contraste AA, alvo >=44px, borda de controle >=3:1
const ACESS = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = c => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return d[3] === 0 ? [0, 0, 0, 0] : [d[0], d[1], d[2], d[3] / 255]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const razao = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const mix = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
  // fundo opaco efetivo; null = indeterminado (imagem/gradiente atras)
  const fundo = el => {
    const pilha = [];
    for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage !== 'none') return null; pilha.push(rgba(cs.backgroundColor)); if (pilha[pilha.length - 1][3] >= 1) break; }
    let b = [255, 255, 255, 1]; for (let i = pilha.length - 1; i >= 0; i--) b = mix(pilha[i], b); return b;
  };
  const opac = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[aria-hidden="true"]'); };
  const nome = el => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '')).slice(0, 40);
  const out = { contraste: [], alvos: [], bordas: [], nTexto: 0, nAlvos: 0, nCampos: 0, indet: 0 };
  const vistos = new Set();
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'OPTION'].includes(el.tagName.toUpperCase()) || !vis(el)) continue;
    if (!/^(select|option)$/i.test(el.tagName) && ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0)) continue;
    const cs = getComputedStyle(el);
    if (el.matches(':disabled') || el.closest('[disabled]')) continue;
    const bg = fundo(el); if (!bg) { out.indet++; continue; }
    const o = opac(el); const fg0 = rgba(cs.color); const fg = mix([fg0[0], fg0[1], fg0[2], fg0[3] * o], bg);
    const r = razao(fg, bg); const px = parseFloat(cs.fontSize); const peso = +cs.fontWeight || 400;
    const grande = px >= 24 || (px >= 18.66 && peso >= 700); const lim = grande ? 3 : 4.5;
    out.nTexto++;
    if (r < lim) { const k = nome(el) + '|' + r.toFixed(2); if (!vistos.has(k)) { vistos.add(k); out.contraste.push({ el: nome(el), r: +r.toFixed(2), lim, px }); } }
  }
  const vistosA = new Set();
  for (const el of document.querySelectorAll('a[href],button,select,textarea,summary,[role=button],input:not([type=hidden])')) {
    if (el.matches(':disabled')) continue;
    const t = (el.type || '').toLowerCase(); const caixa = t === 'radio' || t === 'checkbox';
    let alvo = el;
    if (caixa) alvo = el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]')) || el;
    if (!vis(alvo)) continue;
    const cs = getComputedStyle(alvo);
    if (el.tagName === 'A' && cs.display === 'inline' && alvo.parentElement && alvo.parentElement.textContent.trim().length > alvo.textContent.trim().length + 8) continue; // link no meio do texto
    const r = alvo.getBoundingClientRect(); out.nAlvos++;
    if (r.width < 43.5 || r.height < 43.5) { const k = nome(alvo) + Math.round(r.width) + 'x' + Math.round(r.height); if (!vistosA.has(k)) { vistosA.add(k); out.alvos.push({ el: nome(alvo), w: Math.round(r.width), h: Math.round(r.height) }); } }
  }
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=submit]):not([type=button]):not([type=range]),select,textarea')) {
    if (!vis(el) || el.matches(':disabled')) continue;
    const cs = getComputedStyle(el); const pai = el.parentElement ? fundo(el.parentElement) : [255, 255, 255, 1]; if (!pai) { out.indet++; continue; }
    out.nCampos++;
    const bw = Math.max(...['Top', 'Right', 'Bottom', 'Left'].map(l => parseFloat(cs['border' + l + 'Width']) || 0));
    const bc = bw > 0 && cs.borderTopStyle !== 'none' ? razao(mix(rgba(cs.borderTopColor), pai), pai) : 0;
    const fc = cs.backgroundImage === 'none' ? razao(mix(rgba(cs.backgroundColor), pai), pai) : 0;
    if (Math.max(bc, fc) < 3) out.bordas.push({ el: nome(el), borda: +bc.toFixed(2), fundo: +fc.toFixed(2) });
  }
  return out;
};

// ---------- formulario (1440) ----------
async function checarForm(page) {
  const mapa = await page.evaluate(MAPEAR_FORM);
  if (!mapa) { chk('form-pedido', false, 'nenhum formulario com >=2 campos', 'preencher e ler msg WhatsApp'); return; }
  const msgs = [];
  const ler = async (rot) => { await sleep(140); const m = await page.evaluate(LER_MSG); msgs.push({ rot, ...m }); return m; };
  const erros = [];
  const por = async (fn, rot) => { try { await fn(); } catch (e) { erros.push(rot + ': ' + String(e.message).split('\n')[0].slice(0, 80)); } };
  // preenche via Playwright; campo escondido (ex.: aparece so em outro tema) cai no fallback em-pagina
  const escolher = async (i, v) => { try { await page.locator(`[data-cp="${i}"]`).selectOption(v, { timeout: 1200 }); } catch { await page.evaluate(([i, v]) => { const e = window.__cp[i]; e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [i, v]); } };
  const preencher = async (i, v) => { try { await page.locator(`[data-cp="${i}"]`).fill(v, { timeout: 1200 }); } catch { await page.evaluate(([i, v]) => { const e = window.__cp[i]; const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; set.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [i, v]); } };
  const loc = i => page.locator(`[data-cp="${i}"]`);
  const tap = i => page.evaluate(i => window.__cpTap(i), i);
  const c = mapa.ctls;
  const hojeIso = iso(HOJE);
  const mesSel = c.find(x => x.tag === 'select' && x.opts.some(o => /janeiro/i.test(o.t)));
  const diaSel = c.find(x => x.tag === 'select' && x !== mesSel && (/\bdia\b/i.test(x.label + x.id) || (x.opts.filter(o => /^\d+$/.test(o.v)).length >= 28)));
  const anoSel = c.find(x => x.tag === 'select' && x !== mesSel && x !== diaSel && x.opts.some(o => /^20\d\d$/.test(o.v)));
  const dateIn = c.filter(x => x.type === 'date');

  const m0 = await ler('inicial');

  // radios: matriz de opcoes
  const grupos = {}; c.filter(x => x.type === 'radio').forEach(x => { (grupos[x.name] ||= []).push(x); });
  for (const [nome, opts] of Object.entries(grupos)) {
    for (const o of opts) {
      await por(() => tap(o.i), 'radio ' + nome);
      const m = await ler(`radio ${nome}=${o.value}`);
      const t = norm(m.href ?? m.bolha ?? '');
      const lab = norm(o.label), val = norm(o.value);
      if (!(t.includes(val) || t.includes(lab)) && m.href !== null) aviso('msg-matriz', `radio ${nome}="${o.label}": msg nao traz "${o.value || o.label}"`);
      for (const o2 of opts) {
        if (o2 === o) continue; const l2 = norm(o2.label), v2 = norm(o2.value);
        for (const k of [l2, v2]) if (k.length >= 5 && !norm(o.label + ' ' + o.value).includes(k) && t.includes(k)) erros.push(`radio ${nome}="${o.label}": msg ainda cita "${k}" (opcao anterior)`);
      }
    }
  }
  for (const opts of Object.values(grupos)) { const padrao = opts.find(o => o.checked) || opts[0]; await por(() => tap(padrao.i), 'radio padrao'); }
  // preencher o resto
  for (const x of c) {
    if (x.type === 'radio') continue;
    if (x === mesSel || x === diaSel || x === anoSel) continue;
    if (x.type === 'checkbox') { if (!x.checked) await por(() => tap(x.i), 'checkbox'); continue; }
    if (x.tag === 'select') { const o = x.opts.find(o => o.v !== ''); if (o) await por(() => escolher(x.i, o.v), 'select ' + x.label); continue; }
    if (x.type === 'date') { await por(() => preencher(x.i, iso(addDias(HOJE, 45))), 'date'); continue; }
    if (x.type === 'number') { let v = 50; if (x.min && v < +x.min) v = +x.min; if (x.max && v > +x.max) v = +x.max; await por(() => preencher(x.i, String(v)), 'number ' + x.label); continue; }
    if (['text', 'search', 'tel', 'textarea', ''].includes(x.type)) { await por(() => preencher(x.i, /nome/i.test(x.label + x.id) ? 'Maria' : 'Teste'), 'text ' + x.label); }
  }
  await ler('preenchido');

  const hoje = HOJE, Y = hoje.getFullYear();
  // datas por selects
  if (mesSel) {
    const ordem = [12, 1, 12, ...Array.from({ length: 12 }, (_, i) => i + 1)];
    if (diaSel) { const d = diaSel.opts.find(o => o.v === '28') || diaSel.opts.find(o => o.v !== ''); if (d) await por(() => loc(diaSel.i).selectOption(d.v, { timeout: 2500 }), 'dia'); }
    for (const mm of ordem) {
      const op = mesSel.opts.find(o => o.v !== '' && (+o.v === mm || norm(o.t) === norm(MESES[mm - 1])));
      if (!op) continue;
      await por(() => loc(mesSel.i).selectOption(op.v, { timeout: 2500 }), 'mes');
      const m = await ler(`mes=${mm}`); const t = m.href ?? m.bolha ?? '';
      const ano = (t.match(/\b(20\d\d)\b/) || [])[1];
      const futuro = new Date(Y, mm - 1, 28) >= hoje; const esperado = futuro ? Y : Y + 1;
      if (!ano) erros.push(`mes ${MESES[mm - 1]}: msg sem ano ("${t.slice(0, 60)}")`);
      else if (+ano !== esperado) erros.push(`mes ${MESES[mm - 1]} (dia 28): ano ${ano} na msg, esperado ${esperado}`);
    }
    if (anoSel) { const y = await page.evaluate(i => window.__cp[i].value, anoSel.i); aviso('msg-matriz', `ano no select apos matriz: ${y}`); }
  }
  // datas por input date
  for (const d of dateIn) {
    const fut = addDias(HOJE, 45);
    await por(() => preencher(d.i, iso(fut)), 'date fut');
    const m = await ler('date futuro'); const t = m.href ?? m.bolha ?? '';
    if (!t.includes(String(fut.getFullYear()))) erros.push(`input date ${iso(fut)}: msg sem ano ${fut.getFullYear()} ("${t.slice(0, 70)}")`);
    await por(() => preencher(d.i, '2025-01-01'), 'date passada');
    const mp = await ler('date passada'); const tp = mp.href ?? mp.bolha ?? '';
    if (/\b2025\b/.test(tp)) erros.push('input date 01/01/2025 aceito na msg');
    await por(() => preencher(d.i, iso(addDias(HOJE, -1))), 'date ontem');
    const mo = await ler('date ontem'); const to = mo.href ?? mo.bolha ?? '';
    const ontem = addDias(HOJE, -1); const pad = n => String(n).padStart(2, '0');
    if (to.includes(`${pad(ontem.getDate())}/${pad(ontem.getMonth() + 1)}/${ontem.getFullYear()}`) || to.includes(`${ontem.getDate()} de ${MESES[ontem.getMonth()]} de ${ontem.getFullYear()}`)) erros.push('input date de ontem aceito na msg');
    const mn = d.min;
    if (!mn) erros.push('input[type=date] sem min'); else if (mn < hojeIso) erros.push(`input[type=date] min=${mn} < hoje ${hojeIso}`);
  }
  // varredura de texto
  const vistos = new Set();
  for (const m of msgs) for (const t of [m.href, m.bolha, ...(m.todos || [])]) {
    if (!t) continue;
    for (const [re, nome] of [[/undefined/i, 'undefined'], [/ e e /i, "' e e '"], [/\bNaN\b/, 'NaN'], [/\[object/i, '[object'], [/\bnull\b/, 'null']]) {
      if (re.test(t) && !vistos.has(nome + t)) { vistos.add(nome + t); erros.push(`msg com ${nome}: "${t.slice(0, 80)}" [${m.rot}]`); }
    }
  }
  const final = msgs[msgs.length - 1];
  if (!final.href && !final.bolha) erros.push('nenhuma mensagem WhatsApp (href wa.me com text= ou balao) encontrada');
  if (final.href === null && !msgs.some(m => m.href !== null)) erros.push('sem link wa.me/api.whatsapp com text=');
  const amostra = (msgs.find(m => m.rot === 'preenchido')?.href || '').slice(0, 90);
  chk('msg-whatsapp', erros.length === 0, erros.length ? erros.slice(0, 6).join(' | ') + (erros.length > 6 ? ` (+${erros.length - 6})` : '') : `${msgs.length} estados lidos, ok. ex: "${amostra}"`,
    'tem ano; sem undefined/" e e "; ano certo (mes passado vira ano seguinte e volta); date com min>=hoje; passado nao entra na msg');
  return { temForm: true };
}

// ---------- main ----------
const { p: servidor, porta } = await subirServidor();
let browser;
try {
  const canal = process.env.CHECAR_CANAL || 'chrome';
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : canal === 'chromium' ? { headless: true } : { channel: canal, headless: true });
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const consoleErros = new Set();
  const resultados = {};
  for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, reducedMotion: 'reduce', hasTouch: vp.w < 600, isMobile: vp.w < 600 });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    page.on('console', m => { if (m.type() === 'error') consoleErros.add(`[${vp.w}] ${m.text().slice(0, 140)}`); });
    page.on('pageerror', e => consoleErros.add(`[${vp.w}] pageerror ${String(e.message).slice(0, 140)}`));
    page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(`http://127.0.0.1:${porta}`)) consoleErros.add(`[${vp.w}] HTTP ${r.status()} ${r.url().replace(`http://127.0.0.1:${porta}`, '')}`); });
    try {
      await page.goto(`http://127.0.0.1:${porta}/index.html`, { waitUntil: 'load', timeout: 20000 });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach(i => { i.loading = 'eager'; }));
      await page.evaluate(() => Promise.race([Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))), new Promise(r => setTimeout(r, 5000))]));
      await sleep(400);
      resultados[vp.w] = await page.evaluate(MEDIR);
      resultados['a' + vp.w] = await page.evaluate(ACESS);
      if (vp.w === 1440) {
        resultados.hash = await page.evaluate(DHASH);
        // convencao opcional do kit: window.P.parar() pausa a demo animada antes de mexer no formulario
        await page.evaluate(() => window.P && window.P.parar && window.P.parar()).catch(() => {});
        resultados.formOk = await checarForm(page);
        // recarrega estado limpo nao necessario
      } else {
        // balao no celular: toca no 1o chip
        await page.goto(`http://127.0.0.1:${porta}/index.html`, { waitUntil: 'load', timeout: 20000 });
        const mapa = await page.evaluate(MAPEAR_FORM);
        if (!mapa) chk('balao-celular', false, 'sem formulario', 'balao na viewport apos tocar 1o chip');
        else {
          const primeiro = mapa.ctls.find(x => x.type === 'radio' || x.type === 'checkbox');
          if (!primeiro) aviso('balao-celular', 'sem chip (radio/checkbox) no formulario; nao medido');
          else {
            // chip pode estar marcado por padrao: toca o 1o nao marcado se houver, senao o 1o
            const alvo = mapa.ctls.find(x => (x.type === 'radio' || x.type === 'checkbox') && !x.checked) || primeiro;
            const sel = await page.evaluate(i => { const e = window.__cp[i]; return e.closest('label') || e; }, alvo.i).catch(() => null);
            await page.evaluate(i => { const e = window.__cp[i]; const l = e.closest('label') || e; l.scrollIntoView({ block: 'center' }); }, alvo.i);
            await sleep(150);
            await page.evaluate(i => window.__cpTap(i), alvo.i);
            await sleep(900);
            const b = await page.evaluate(BALAO);
            if (!b.melhor) chk('balao-celular', false, 'nenhum elemento de balao encontrado ([data-msg],.wa-balao,#msg,#bubble,.bolha,.bub,.chat,#prev)', 'balao na viewport apos tocar 1o chip');
            else chk('balao-celular', b.melhor.ratio >= 0.5, `balao ${b.melhor.s} top=${b.melhor.top} bottom=${b.melhor.bottom} visivel=${Math.round(b.melhor.ratio * 100)}% (viewport ${b.vh}px)`, 'visivel >=50% na viewport 390x844 apos tocar no 1o chip');
          }
        }
      }
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  const A = resultados[1440], B = resultados[390];
  // 1 overflow
  chk('overflow-1440', A.overflow === 0, `${A.overflow}px`, '0');
  chk('overflow-390', B.overflow === 0, `${B.overflow}px`, '0');
  // 2 console
  chk('console', consoleErros.size === 0, consoleErros.size ? [...consoleErros].slice(0, 4).join(' | ') : '0 erros', '0 erros');
  // 3 nitidez
  for (const [w, R] of [[1440, A], [390, B]]) {
    const ruins = R.imgs.filter(i => !i.svg && !i.oculto && i.w >= 24 && (i.broken || (i.ratio !== null && i.ratio < 1.5)));
    const total = R.imgs.filter(i => !i.svg && !i.oculto && i.w >= 24).length;
    const min = R.imgs.filter(i => i.ratio !== null && !i.svg && i.w >= 24).reduce((m, i) => Math.min(m, i.ratio), Infinity);
    chk(`img-nitidez-${w}`, ruins.length === 0, ruins.length ? ruins.slice(0, 5).map(i => `${i.src} ${i.broken ? 'QUEBRADA' : i.ratio.toFixed(2) + 'x'} (${i.nw}px em ${i.w}px)`).join('; ') + (ruins.length > 5 ? ` (+${ruins.length - 5})` : '') : `${total} imgs, min ${isFinite(min) ? min.toFixed(2) : '-'}x`, 'cada img >=1,5x do box exibido');
  }
  // 3b contraste AA, alvo >=44px (celular), borda de controle >=3:1
  for (const w of [1440, 390]) {
    const X = resultados['a' + w];
    chk(`contraste-${w}`, X.contraste.length === 0, X.contraste.length ? X.contraste.slice(0, 5).map(c => `${c.el} ${c.r}:1 (<${c.lim}) ${c.px}px`).join('; ') + (X.contraste.length > 5 ? ` (+${X.contraste.length - 5})` : '') : `${X.nTexto} textos ok (${X.indet} sobre imagem/gradiente, nao medidos)`, 'texto >=4,5:1 (>=3:1 se grande)');
    chk(`borda-controle-${w}`, X.bordas.length === 0, X.bordas.length ? X.bordas.slice(0, 5).map(c => `${c.el} borda ${c.borda}:1 fundo ${c.fundo}:1`).join('; ') : `${X.nCampos} campos ok`, 'borda (ou fundo) do campo >=3:1 contra o entorno');
  }
  { const X = resultados.a390;
    chk('alvo-44-390', X.alvos.length === 0, X.alvos.length ? X.alvos.slice(0, 5).map(c => `${c.el} ${c.w}x${c.h}`).join('; ') + (X.alvos.length > 5 ? ` (+${X.alvos.length - 5})` : '') : `${X.nAlvos} alvos ok`, 'alvo de toque >=44x44px em 390'); }
  // 3c foto real no hero (a revisao confere se a foto e do negocio; aqui so garante que existe foto grande na 1a dobra)
  chk('hero-foto', !!A.heroFoto && !!B.heroFoto, `1440: ${A.heroFoto || 'sem foto'} | 390: ${B.heroFoto || 'sem foto'}`, 'imagem raster >=40% da largura e >=120px de altura na 1a dobra, nos dois tamanhos');
  // 4 secoes
  chk('secoes', A.secoes >= 5 && B.secoes >= 5, `1440:${A.secoes} 390:${B.secoes} (${A.secoesSection} section + hero ${A.secoesHero} + rodape ${A.secoesRodape})`, '>=5 blocos reais: <section> + hero (header) + rodape, com conteudo');
  // 5 carrossel
  const carr = [];
  for (const [w, R] of [[1440, A], [390, B]]) for (const c of R.carrosseis) {
    const p = [];
    if (!c.snap || c.snap === 'none') p.push('sem scroll-snap-type');
    if (c.padL > 0 && c.spL < c.padL - 1) p.push(`scroll-padding-left ${c.spL} < padding ${c.padL}`);
    if (c.gap !== null && c.gap < 8) p.push(`1o card colado (${c.gap}px da borda)`);
    if (p.length) carr.push(`[${w}] ${c.sel.slice(0, 30)}: ${p.join(', ')}`);
  }
  chk('carrossel', carr.length === 0, carr.length ? carr.slice(0, 4).join(' | ') : `${A.carrosseis.length}+${B.carrosseis.length} carrosseis ok`, 'scroll-snap + scroll-padding + 1o card >=8px da borda');
  // 6 scroll-padding / smooth
  const sp = [];
  for (const [w, R] of [[1440, A], [390, B]]) {
    if (R.ancoras > 0 && R.navH > 0) {
      const ok = R.scrollPadTop >= R.navH + 7 || R.scrollMarginAlvos >= R.navH + 7;
      if (!ok) sp.push(`[${w}] scroll-padding-top ${R.scrollPadTop}px < nav ${Math.round(R.navH)}px + 8 (1o conteudo do alvo apos salto a ${Math.min(...R.saltos)}px do topo)`);
    }
  }
  chk('scroll-padding', sp.length === 0, sp.length ? sp.join(' | ') : `nav ${Math.round(A.navH)}/${Math.round(B.navH)}px, padding ${A.scrollPadTop}/${B.scrollPadTop}px, ${A.ancoras} ancoras`, 'scroll-padding-top >= altura da nav + 8px (+-1px; nav fixa/sticky com ancoras)');
  const smoothSrc = /(^|[}\s,])(html|body|:root)\s*\{[^}]*scroll-behavior\s*:\s*smooth/i.test(html);
  const smooth = [...A.scrollBehavior, ...B.scrollBehavior].includes('smooth') || smoothSrc;
  chk('scroll-behavior', !smooth, smooth ? 'scroll-behavior:smooth global (html/body)' : 'nao global', 'sem scroll-behavior:smooth global');
  // 7 travessao
  chk('travessao', A.travessao === 0, `${A.travessao} no texto visivel`, '0 (—)');
  // 8 h1
  const h1p = [];
  if (!A.h1) h1p.push('sem <h1>');
  if (A.h1 && A.h2s.some(h => norm(h) === norm(A.h1))) h1p.push('h1 igual a um h2');
  for (const [w, R] of [[1440, A], [390, B]]) if (R.marcaQuebra.length) h1p.push(`[${w}] nome "${R.marca}" quebra: ${R.marcaQuebra.slice(0, 2).join('; ')}`);
  chk('h1-marca', h1p.length === 0, h1p.length ? h1p.join(' | ') : `h1="${(A.h1 || '').slice(0, 50)}" linhas ${A.h1Linhas}/${B.h1Linhas}`, 'nome da marca (title) em 1 linha; h1 != h2');
  for (const [w, R] of [[1440, A], [390, B]]) if (R.h1Linhas >= 3 && !/balance|pretty/.test(R.h1Balance || '')) aviso('h1-balance', `[${w}] h1 com ${R.h1Linhas} linhas sem text-wrap:balance`);
  // 9 area morta
  chk('area-morta', A.mortas.length === 0, A.mortas.length ? A.mortas.slice(0, 4).map(m => `${m.sel.slice(0, 30)} ${m.vazio}% vazio (${m.w}px)`).join('; ') : 'sem bloco >40% vazio', 'ocupacao horizontal >=60% em grids/flex-row a 1440');
  // 10 cena repetida
  const hs = resultados.hash.filter(h => h.bits);
  const rep = [];
  for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
    let d = 0; for (let k = 0; k < 64; k++) if (hs[i].bits[k] !== hs[j].bits[k]) d++;
    if (d <= 5) rep.push(`${hs[i].src} ~ ${hs[j].src} (d=${d})`);
  }
  chk('cena-repetida', rep.length === 0, rep.length ? rep.slice(0, 4).join('; ') : `${hs.length} imgs grandes, sem par`, 'nenhum par com dHash <=5/64');
  // 8b h1 cortado (overflow horizontal do proprio h1)
  for (const [w, R] of [[1440, A], [390, B]]) chk(`h1-corte-${w}`, !R.h1Corte, R.h1Corte || 'h1 inteiro na viewport', 'h1 sem corte lateral');
  // 8c bastidor, registro "a confirmar" x bio, passos duplicados, msg3 x pagina
  {
    const vis = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const bast = vis.match(/foto real|entra aqui|\bplaceholder\b|lorem ipsum|\bTODO\b|\bxxx+\b|\[(?:foto|nome|logo|texto)[^\]]*\]|{[a-z_]+}/i);
    chk('bastidor', !bast, bast ? `"${bast[0]}" no HTML publicado` : 'sem texto de bastidor', 'nenhum "foto real entra aqui", placeholder, {var}');
    const lerJ = f => { try { return JSON.parse(fs.readFileSync(path.join(DIR, '_raw', f), 'utf8')); } catch { return {}; } };
    const spec = lerJ('spec.json'), perf = lerJ('perfil.json');
    let m3 = ''; try { m3 = fs.readFileSync(path.join(DIR, 'msg3.txt'), 'utf8'); } catch {}
    const REG = /\b(CRN\s?-?\d?|CRFa\s?-?\d?|CRP\s?-?\d{0,2}|CRM(?:-[A-Z]{2})?|RQE|CREFITO\s?-?\d{0,2}|CRO|CRF|CREF)\s*[:\-\/]?\s*(\d[\d.\-\/]*\d|\d)/i;
    const fonte = [perf.bio, perf.biography, perf.full_name, JSON.stringify(spec.registro || {}), spec.fonte_fatos].filter(Boolean).join(' ');
    const regFonte = fonte.match(REG), regPag = vis.match(REG);
    const falta = /a confirmar|em branco/i.test(vis) || /class="falta"/.test(html);
    chk('registro-confirmar', !((regFonte || regPag) && falta), (regFonte || regPag) && falta ? `registro "${(regFonte || regPag)[0]}" ${regFonte ? 'na bio/spec' : 'na pagina'} mas pagina tem "a confirmar"/em branco` : 'ok', 'com numero na bio/spec, a pagina mostra o numero e nao "a confirmar"');
    if (falta && !regFonte && !regPag) aviso('a-confirmar', 'pagina tem "a confirmar"/em branco sem registro em nenhuma fonte: so vale para registro de conselho que nao foi achado; o revisor confere');
    const m3Branco = /deixei (?:em branco|como a confirmar)|em branco seu|a confirmar/i.test(m3);
    chk('msg3-registro', !(m3Branco && (regPag || !falta)), m3Branco && (regPag || !falta) ? `msg3 diz "em branco/a confirmar" mas ${regPag ? 'a pagina mostra "' + regPag[0] + '"' : 'a pagina nao tem campo em branco'}` : 'ok', 'msg3 so cita "em branco" se a pagina tem o campo em branco');
    const ol = (html.match(/<ol[^>]*class="[^"]*etapas[^"]*"[^>]*>[\s\S]*?<\/ol>/i) || [''])[0];
    const tit = [...ol.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map(x => norm(x[1].replace(/<[^>]+>/g, '')));
    const dupT = tit.filter((t, i) => tit.indexOf(t) !== i);
    chk('passos-duplicados', dupT.length === 0, dupT.length ? `titulo(s) repetido(s): ${[...new Set(dupT)].join('; ')}` : `${tit.length} passos distintos`, 'titulos de passo unicos');
    const frases = m3.split(/(?<=[.!?:])\s+|\n+/).map(norm).filter(f => f.length > 25);
    const dupF = frases.filter((f, i) => frases.indexOf(f) !== i);
    chk('msg3-duplicada', dupF.length === 0, dupF.length ? `frase repetida: "${dupF[0].slice(0, 60)}"` : 'sem frase repetida', 'msg3 sem frase duplicada');
  }
  // 11 og
  const meta = n => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*>`, 'i')); if (!m) return null; const c = m[0].match(/content=["']([^"']*)["']/i); return c ? c[1] : null; };
  const og = meta('og:image');
  const ogp = [];
  if (!og) ogp.push('sem og:image'); else {
    if (og.includes('?')) ogp.push(`querystring (${og.split('/').pop()})`);
    const f = arquivoLocal(og.split('?')[0]);
    if (!f) ogp.push('arquivo nao existe local'); else {
      const buf = fs.readFileSync(f); const dm = dimImg(buf);
      if (!dm || dm.w !== 1200 || dm.h !== 630) ogp.push(`dimensao ${dm ? dm.w + 'x' + dm.h : '?'}`);
      if (buf.length >= 64 * 1024) ogp.push(`${Math.round(buf.length / 1024)}KB`);
      const h = crypto.createHash('sha1').update(buf).digest('hex'); let dup = null;
      for (const s of fs.readdirSync(PREVIAS)) {
        if (s === slug) continue; const d = path.join(PREVIAS, s); let fl; try { fl = fs.readdirSync(d).filter(x => /^og.*\.(jpg|jpeg|png)$/i.test(x)); } catch { continue; }
        for (const x of fl) { const pth = path.join(d, x); try { if (fs.statSync(pth).size === buf.length && crypto.createHash('sha1').update(fs.readFileSync(pth)).digest('hex') === h) { dup = `${s}/${x}`; break; } } catch {} }
        if (dup) break;
      }
      if (dup) ogp.push(`igual ao og de ${dup}`);
      if (/\/og\.(jpg|png)$/i.test(og.split('?')[0])) aviso('og', 'og:image sem sufixo -vN (og.jpg)');
    }
    const mw = meta('og:image:width'), mh = meta('og:image:height');
    if (mw && mh && (mw !== '1200' || mh !== '630')) ogp.push(`meta width/height ${mw}x${mh}`);
  }
  chk('og-image', ogp.length === 0, ogp.length ? ogp.join('; ') : `${og.split('/').pop()} ok`, 'existe, 1200x630, <64KB, sem querystring, unico entre previas');
  // 12 favicon / apple
  const link = rels => { for (const t of html.match(/<link\b[^>]*>/gi) || []) { const r = (t.match(/\brel=["']([^"']*)["']/i) || [])[1]; if (r === undefined || !rels.includes(r.trim().toLowerCase().replace(/\s+/g, ' '))) continue; const h = t.match(/href=["']([^"']*)["']/i); if (h) return h[1]; } return null; };
  const fav = link(['icon', 'shortcut icon']), apple = link(['apple-touch-icon']);
  const fp = [];
  for (const [nome, u] of [['favicon', fav], ['apple-touch-icon', apple]]) {
    if (!u) { fp.push(`sem ${nome}`); continue; }
    const f = arquivoLocal(u.split('?')[0]); if (!f) { fp.push(`${nome} arquivo ausente (${u})`); continue; }
    const dm = dimImg(fs.readFileSync(f));
    if (nome === 'apple-touch-icon' && dm && dm.w < 180) fp.push(`apple-touch ${dm.w}px (<180)`);
    if (nome === 'favicon' && dm && dm.w < 192) aviso('favicon', `favicon ${dm.w}px (<192)`);
    if (nome === 'apple-touch-icon' && dm && dm.w < 512) aviso('apple-touch', `apple-touch ${dm.w}px (<512)`);
  }
  chk('favicon', fp.length === 0, fp.length ? fp.join('; ') : 'favicon + apple-touch existem', 'ambos existem; apple-touch >=180px');
  // 12b numero do WhatsApp (ficha) e residuos do demo do kit
  { const WA = ((args.find(x => x.startsWith('--wa=')) || '').slice(5)).replace(/\D/g, '');
    const nums = new Set(); for (const m of html.matchAll(/wa\.me\/(\d+)/g)) nums.add(m[1]); for (const m of html.matchAll(/phone=(\d+)/g)) nums.add(m[1]); for (const m of html.matchAll(/\bnumero\s*:\s*['"](\+?[\d\s()-]+)['"]/g)) nums.add(m[1].replace(/\D/g, ''));
    const wp = []; if (!nums.size) wp.push('nenhum numero de WhatsApp (wa.me / numero:) no HTML');
    for (const n of nums) { if (WA && n !== WA) wp.push(`numero ${n} != ficha ${WA}`); }
    if (DEMO && DEMO.test(html)) wp.push(`residuo do kit de partida (--demo casou "${(html.match(DEMO) || [''])[0].slice(0, 40)}")`);
    chk('whatsapp-numero', wp.length === 0, wp.length ? wp.join('; ') : `${[...nums].join(',')}${WA ? ' = ficha' : ' (sem --wa: numero nao comparado)'}`, 'numero = WhatsApp da ficha (--wa=), sem residuo do kit (--demo=)'); }
  // 13 noindex
  const rob = meta('robots');
  chk('noindex', !!rob && /noindex/i.test(rob), `robots="${rob || ''}"`, 'meta robots noindex');
  // 14 datas fixas
  let src = html.replace(/<!--[\s\S]*?-->/g, ' ');
  src = src.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, (_, a, _t, body, z) => a + body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[\s;{}),])\/\/[^\n]*/g, '$1 ') + z);
  src = src.replace(/(https?:)?\/\/[^\s"')<>]+/g, ' ').replace(/wa\.me\/\d+/g, ' ');
  const limite = addDias(HOJE, 60); const dp = [];
  const mesIdx = s => { const n = norm(s).slice(0, 3); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'].indexOf(n); };
  const vistosD = new Set(); const addD = (txt, dt, fim) => { const k = txt; if (vistosD.has(k)) return; vistosD.add(k); if (dt < limite) dp.push(`"${txt}" (< hoje+60d)`); else aviso('data-fixa', `data literal "${txt}" (>= hoje+60d)`); };
  for (const m of src.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) addD(m[0], new Date(+m[1], +m[2] - 1, +m[3]));
  for (const m of src.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/g)) addD(m[0], new Date(+m[3], +m[2] - 1, +m[1]));
  for (const m of src.matchAll(/\b(\d{1,2})\s+de\s+([a-zçã]+)(?:\s+de)?\s+(20\d\d)\b/gi)) { const mi = mesIdx(m[2]); if (mi >= 0) addD(m[0], new Date(+m[3], mi, +m[1])); }
  for (const m of src.matchAll(/\b([a-zçã]{3,9})(?:\/[a-zçã]{3,9})?\s+(?:de\s+)?(20\d\d)\b/gi)) { const mi = mesIdx(m[1]); if (mi >= 0 && !/^\d/.test(m[1])) addD(m[0], new Date(+m[2], mi + 1, 0)); }
  const anos = new Set(); for (const m of src.matchAll(/(?<![\d\-\/.#])(20\d\d)(?![\d\-\/])/g)) anos.add(+m[1]);
  for (const a of anos) { if (a < limite.getFullYear()) dp.push(`ano literal ${a} (< ${limite.getFullYear()})`); else aviso('ano-fixo', `ano literal ${a} no HTML/JS`); }
  const temDataUI = /type=["']date["']/i.test(html) || /janeiro/i.test(html);
  const calcDin = /new Date\(|Date\.now\(/.test(html);
  if (temDataUI && !calcDin) dp.push('campo de data sem new Date()/Date.now() (demo nao calculada de hoje)');
  chk('datas-fixas', dp.length === 0, dp.length ? dp.slice(0, 5).join('; ') : 'sem data/ano literal vencido; usa new Date()', 'nenhum ano/data literal < hoje+60d; datas via new Date()');
  // 15 escala (aviso)
  const escala = [12.8, 16, 20, 25, 31.25, 39, 48.8];
  const fora = Object.entries(A.fontes).map(([s, n]) => [parseFloat(s), n]).filter(([s]) => !escala.some(e => Math.abs(s - e) <= 1)).sort((a, b) => b[1] - a[1]);
  if (fora.length) aviso('escala-tipografica', `fora de 12.8/16/20/25/31.25/39/48.8 +-1px: ${fora.slice(0, 8).map(([s, n]) => `${s}px(${n})`).join(' ')}${fora.length > 8 ? ' ...' : ''}`);
} catch (e) {
  chk('execucao', false, String(e.stack || e).split('\n').slice(0, 3).join(' / '), 'rodar sem excecao');
} finally {
  try { await browser?.close(); } catch {}
  try { servidor.kill('SIGKILL'); } catch {}
}

// ---------- saida ----------
const falhas = checks.filter(c => !c.ok).map(c => ({ id: c.id, medida: c.medida, limite: c.limite }));
const res = { slug, ok_total: falhas.length === 0, falhas, avisos };
if (JSON_OUT) console.log(JSON.stringify(res, null, 1));
else {
  console.log(`== ${slug}: ${falhas.length === 0 ? 'OK' : falhas.length + ' FALHA(S)'} (${checks.length} checagens, ${avisos.length} avisos)`);
  for (const c of checks) console.log(`${c.ok ? 'ok   ' : 'FALHA'} ${c.id.padEnd(16)} ${c.medida}${c.ok ? '' : '   [limite: ' + c.limite + ']'}`);
  for (const a of avisos) console.log(`aviso ${a}`);
}
process.exit(falhas.length ? 1 : 0);
