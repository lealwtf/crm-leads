#!/usr/bin/env python3
"""Injeta Open Graph + Twitter card no <head> de <previas>/<slug>/index.html e grava robots.txt de prévia.

Uso: aplicar-og.py <slug> <og.json> [--previas=<pasta>]

og.json (texto do negócio fica em arquivo, nunca em argumento de shell):
  {"url": "https://<slug>.seudominio.com.br/", "titulo": "Nome | o que faz, Cidade",
   "descricao": "1 frase com fato lido", "alt": "descrição da foto", "imagem": "og-v2.jpg", "site_name": "Nome"}

- Idempotente: tira as meta og:* e twitter:* que já existirem e põe o bloco novo. Backup da 1ª versão em _og-antes.html.
- imagem precisa ser og.jpg ou og-vN.jpg (nome versionado fura o cache do WhatsApp; querystring não resolve)
  e existir na pasta; avisa se não for 1200x630 ou se tiver 64 KB ou mais.
- robots.txt: libera só os robôs de prévia de link (WhatsApp, Facebook) e bloqueia o resto, enquanto for prévia.

Configuração: --previas=<pasta> ou PREVIAS_DIR (padrão ./previas)."""
import html, json, os, re, shutil, struct, sys

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opts = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
if len(args) != 2:
    sys.exit(__doc__)
slug, arq = args
if not re.fullmatch(r'[a-z0-9_-]+', slug):
    sys.exit('slug inválido (só [a-z0-9_-])')
PREVIAS = os.path.abspath(opts.get('previas') or os.environ.get('PREVIAS_DIR') or 'previas')
D = os.path.join(PREVIAS, slug)
idx = f'{D}/index.html'
if not os.path.isfile(idx):
    sys.exit(f'não existe: {idx}')
c = json.load(open(arq, encoding='utf-8'))
for k in ('url', 'titulo', 'descricao', 'alt', 'imagem'):
    if not isinstance(c.get(k), str) or not c[k].strip():
        sys.exit(f'og.json sem "{k}"')
url = c['url'] if c['url'].endswith('/') else c['url'] + '/'
if not re.fullmatch(r'https://[a-z0-9.-]+/', url):
    sys.exit('url precisa ser https://<host>/ (sem caminho)')
if not re.fullmatch(r'og(-v\d+)?\.jpe?g', c['imagem']):
    sys.exit('imagem precisa ser og.jpg ou og-vN.jpg')
fimg = f'{D}/{c["imagem"]}'
if not os.path.isfile(fimg):
    sys.exit(f'não existe: {fimg}')

b = open(fimg, 'rb').read()
w = h = 0
i = 2
while b[:2] == b'\xff\xd8' and i + 9 < len(b):
    if b[i] != 0xff:
        i += 1
        continue
    m = b[i + 1]
    if 0xc0 <= m <= 0xcf and m not in (0xc4, 0xc8, 0xcc):
        h, w = struct.unpack('>HH', b[i + 5:i + 9])
        break
    i += 2 + struct.unpack('>H', b[i + 2:i + 4])[0]
if (w, h) != (1200, 630):
    print(f'aviso: {c["imagem"]} tem {w}x{h}, o esperado é 1200x630')
if len(b) >= 64 * 1024:
    print(f'aviso: {c["imagem"]} tem {len(b) // 1024} KB, o esperado é < 64 KB')

img = url + c['imagem']
site = c.get('site_name') or c['titulo'].split(' | ')[0]
meta = [('property', 'og:type', 'website'), ('property', 'og:site_name', site), ('property', 'og:locale', 'pt_BR'),
        ('property', 'og:title', c['titulo']), ('property', 'og:description', c['descricao']), ('property', 'og:url', url),
        ('property', 'og:image', img), ('property', 'og:image:secure_url', img), ('property', 'og:image:type', 'image/jpeg'),
        ('property', 'og:image:width', '1200'), ('property', 'og:image:height', '630'), ('property', 'og:image:alt', c['alt']),
        ('name', 'twitter:card', 'summary_large_image'), ('name', 'twitter:title', c['titulo']),
        ('name', 'twitter:description', c['descricao']), ('name', 'twitter:image', img)]
bloco = '\n' + '\n'.join(f'<meta {k}="{n}" content="{html.escape(v)}">' for k, n, v in meta) + '\n'

s = open(idx, encoding='utf-8').read()
if '</head>' not in s:
    sys.exit('index.html sem </head>')
if not os.path.exists(f'{D}/_og-antes.html'):
    shutil.copy(idx, f'{D}/_og-antes.html')
s = re.sub(r'<meta\s+(?:property|name)="(?:og|twitter):[^"]*"[^>]*>\n?', '', s)
open(idx, 'w', encoding='utf-8').write(s.replace('</head>', bloco + '</head>', 1))
open(f'{D}/robots.txt', 'w').write('User-agent: facebookexternalhit\nUser-agent: Facebot\nUser-agent: WhatsApp\nAllow: /\n\nUser-agent: *\nDisallow: /\n')
print('ok', slug, img)
