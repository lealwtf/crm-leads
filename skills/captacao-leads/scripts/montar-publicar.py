#!/usr/bin/env python3
"""Gera <previas>/<slug>/_publicar.html: a prévia num HTML só, pronta para hospedagem que recebe 1 arquivo.

Uso: montar-publicar.py <slug> [--previas=<pasta>] [--fontes=<query do Google Fonts>]

O que faz, a partir de index.html:
  - fontes locais (@font-face, <link rel="preload" ... fontes/...>) saem; entra 1 <link> do Google Fonts com a query
    de --fontes ou de <previas>/<slug>/_raw/fontes.txt (ex.: family=Fraunces:wght@400..700&family=Figtree:wght@400..700).
    Sem query: a página fica com o que já traz (fonte do sistema ou <link> próprio).
  - imagens em img/ e marca/ (src, href, url(...)) viram data URI;
  - favicon.png e apple-touch-icon.png ficam inline (apple-touch encolhido com ImageMagick, se houver, para caber
    em < 7500 caracteres base64).
Falha (rc 1) se sobrar referência local a img/, marca/ ou fontes/.
og-vN.jpg e robots.txt NÃO entram no HTML: publique os dois junto, como arquivos (o og:image precisa de URL própria).

Configuração: --previas=<pasta> ou PREVIAS_DIR (padrão ./previas). ImageMagick (comando magick) é opcional."""
import base64, os, re, shutil, subprocess, sys, tempfile

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opts = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
if len(args) != 1:
    sys.exit(__doc__)
slug = args[0]
if not re.fullmatch(r'[a-z0-9_-]+', slug):
    sys.exit('slug inválido (só [a-z0-9_-])')
PREVIAS = os.path.abspath(opts.get('previas') or os.environ.get('PREVIAS_DIR') or 'previas')
D = os.path.join(PREVIAS, slug)
if not os.path.isfile(f'{D}/index.html'):
    sys.exit(f'não existe: {D}/index.html')

fontes = opts.get('fontes', '')
if not fontes and os.path.isfile(f'{D}/_raw/fontes.txt'):
    fontes = open(f'{D}/_raw/fontes.txt', encoding='utf-8').read().strip()
if fontes and not re.fullmatch(r'[A-Za-z0-9+:;@.,=&_-]+', fontes):
    sys.exit('query de fontes inválida (só o trecho depois de css2?, sem espaço)')

h = open(f'{D}/index.html', encoding='utf-8').read()
MIME = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'webp': 'image/webp', 'svg': 'image/svg+xml'}


def dentro(p):
    f = os.path.realpath(os.path.join(D, p))
    if os.path.commonpath([os.path.realpath(D), f]) != os.path.realpath(D) or not os.path.isfile(f):
        sys.exit(f'referência fora da pasta ou ausente: {p}')
    return f


def uri(p):
    return f'data:{MIME[p.rsplit(".", 1)[1].lower()]};base64,' + base64.b64encode(open(dentro(p), 'rb').read()).decode()


def icone_pequeno(p):
    f = dentro(p)
    if shutil.which('magick'):
        for px, cores in ((180, 64), (180, 32), (152, 32), (128, 16), (128, 8)):
            with tempfile.TemporaryDirectory() as t:
                o = f'{t}/a.png'
                subprocess.run(['magick', f, '-resize', f'{px}x{px}', '-colors', str(cores), '-strip', f'PNG8:{o}'], check=True)
                b = base64.b64encode(open(o, 'rb').read()).decode()
            if len(b) < 7500:
                return 'data:image/png;base64,' + b
    b = base64.b64encode(open(f, 'rb').read()).decode()
    if len(b) < 7500:
        return 'data:image/png;base64,' + b
    sys.exit('apple-touch-icon grande demais para ficar inline (instale ImageMagick ou reduza o PNG)')


h = re.sub(r'<link rel="preload"[^>]*fontes/[^>]*>\n?', '', h)
h = re.sub(r'@font-face\s*\{[^}]*\}\s*', '', h)
if fontes:
    link = ('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
            f'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?{fontes}&display=swap">')
    h = h.replace('</head>', link + '</head>', 1)
h = re.sub(r'(<link rel="icon"[^>]*?)href="favicon.png"', lambda m: m.group(1) + 'href="' + uri('favicon.png') + '"', h)
h = re.sub(r'(<link rel="apple-touch-icon"[^>]*?)href="apple-touch-icon.png"', lambda m: m.group(1) + 'href="' + icone_pequeno('apple-touch-icon.png') + '"', h)
h = re.sub(r'(href|src)="((?:img|marca)/[^"]+\.(?:png|jpe?g|webp|svg))"', lambda m: f'{m.group(1)}="{uri(m.group(2))}"', h)
h = re.sub(r'url\(["\']?((?:img|marca)/[^)"\']+)["\']?\)', lambda m: f'url({uri(m.group(1))})', h)
sobra = re.findall(r'(?:src|href)="((?:img|marca|fontes)/[^"]+)"|url\(((?:img|marca|fontes)/[^)]+)\)', h)
if sobra:
    sys.exit(f'sobrou referência local: {sobra[:3]}')
open(f'{D}/_publicar.html', 'w', encoding='utf-8').write(h)
print(slug, len(h) // 1024, 'KB', f'{D}/_publicar.html')
