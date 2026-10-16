#!/usr/bin/env python3
"""Baixa bio, link da bio e 6 a 12 fotos do grid de um perfil público do Instagram para <previas>/<slug>/.

Uso: baixar-grid.py <@perfil> <slug> [--max=12] [--posts=N] [--previas=<pasta>]
  - <previas>/<slug>/img/g01.jpg ... (maior resolução disponível: embed do perfil ~1080 px; grid do perfil ~640 px;
    --posts=N abre N embeds de post, cada um com a foto original, ao custo de 1 intervalo do freio cada)
  - <previas>/<slug>/_raw/perfil.json (bio, link da bio validado, seguidores, posts, fotos com largura e altura)
Toda requisição a instagram.com passa por ig-get.py (mesma pasta) com IG_NAVEGADOR=1: freio global, sem login.
Imagens do CDN baixam direto, sem freio. Em resfriamento: imprime "FRIO até HH:MM" e sai com rc=3, sem dormir.

Configuração: --previas=<pasta> ou PREVIAS_DIR (padrão ./previas); IG_FREIO_DIR igual ao do ig-get.py.
Precisa de node + playwright-core + Chrome (o mesmo do ig-pw.mjs).
rc: 0 ok (>= 6 fotos) | 2 poucas fotos (< 6, perfil.json gravado) | 3 frio/bloqueio | 1 erro."""
import ipaddress, json, os, re, socket, struct, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request

IGGET = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ig-get.py')
ESTADO = os.path.join(os.environ.get('IG_FREIO_DIR') or tempfile.gettempdir(), 'ig-freio.json')  # mesmo estado do ig-get.py
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'}
FORA = ('meta.com', 'meta.ai', 'facebook.com', 'threads.com', 'threads.net', 'muse.ai', 'instagram.com', 'fb.me')

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opts = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
if len(args) != 2:
    sys.exit(__doc__)
user = args[0].lstrip('@').strip().strip('/').split('/')[-1]
slug = args[1]
if not re.fullmatch(r'[A-Za-z0-9._]+', user) or not re.fullmatch(r'[a-z0-9_-]+', slug):
    sys.exit('perfil ou slug inválido')
MAXF = int(opts.get('max', 12))
NPOSTS = int(opts.get('posts', 0))
PREVIAS = os.path.abspath(opts.get('previas') or os.environ.get('PREVIAS_DIR') or 'previas')
D = os.path.join(PREVIAS, slug)
t0 = time.time()


LINK_OK = re.compile(r'^https?://[A-Za-z0-9.-]+(/[A-Za-z0-9._~/?#=%&-]*)?$')


def link_valido(u):
    """Link vindo da bio (texto de terceiros): só passa no formato estrito e com host público."""
    if not isinstance(u, str) or not LINK_OK.fullmatch(u):
        return False
    host = urllib.parse.urlsplit(u).hostname or ''
    if '.' not in host or host.startswith('.') or host.endswith('.') or '..' in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False  # IP literal não
    except ValueError:
        pass
    return True


def host_publico(host):
    try:
        for r in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(r[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
                return False
        return True
    except Exception:
        return False


class _Redir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        nu = urllib.parse.urljoin(req.full_url, newurl)
        if not (LINK_OK.fullmatch(nu) and host_publico(urllib.parse.urlsplit(nu).hostname or '')):
            raise urllib.error.URLError('redirect para destino não permitido')
        return super().redirect_request(req, fp, code, msg, headers, nu)


def checa_link(u):
    """HEAD em Python (timeout 8 s, segue redirect validado). Devolve (status|None, url_final|'')."""
    if not host_publico(urllib.parse.urlsplit(u).hostname or ''):
        return None, ''
    op = urllib.request.build_opener(_Redir)
    try:
        with op.open(urllib.request.Request(u, method='HEAD', headers=UA), timeout=8) as r:
            return r.status, r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, e.geturl() if hasattr(e, 'geturl') else u
    except Exception:
        return None, ''


def hora_frio():
    try:
        return time.strftime('%H:%M', time.localtime(json.load(open(ESTADO)).get('frio_ate', 0)))
    except Exception:
        return '??:??'


def frio(parcial=None):
    if parcial is not None:
        grava(parcial)
    print(f'FRIO até {hora_frio()}')
    sys.exit(3)


def ig(url):
    """1 requisição via ig-get.py. Devolve o dict do ig-pw ou None (frio levanta saída rc=3)."""
    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as t:
        out = t.name
    try:
        pr = subprocess.run([sys.executable, IGGET, url, out], capture_output=True, text=True, timeout=200, env={**os.environ, 'IG_NAVEGADOR': '1'})
        if pr.returncode == 3:
            return 'FRIO'
        try:
            return json.load(open(out))
        except Exception:
            return None
    finally:
        try:
            os.unlink(out)
        except OSError:
            pass


def chave(u):
    # mesmo arquivo do CDN em tamanhos diferentes tem o mesmo nome no caminho
    return os.path.basename(urllib.parse.urlparse(u).path)


def tamanho(u):
    m = re.search(r'stp=[^&]*?_[sp](\d+)x(\d+)', u)
    return int(m.group(1)) if m else 9999  # sem _sNNN = original


def dim_img(b):
    """(largura, altura) de JPEG/PNG/WebP sem dependência; (0, 0) se não reconhecer."""
    try:
        if b[:8] == b'\x89PNG\r\n\x1a\n':
            return struct.unpack('>II', b[16:24])
        if b[:4] == b'RIFF' and b[8:12] == b'WEBP':
            if b[12:16] == b'VP8X':
                return 1 + int.from_bytes(b[24:27], 'little'), 1 + int.from_bytes(b[27:30], 'little')
            if b[12:16] == b'VP8 ':
                w, h = struct.unpack('<HH', b[26:30])
                return w & 0x3fff, h & 0x3fff
        if b[:2] == b'\xff\xd8':
            i = 2
            while i + 9 < len(b):
                if b[i] != 0xff:
                    i += 1
                    continue
                m = b[i + 1]
                if 0xc0 <= m <= 0xcf and m not in (0xc4, 0xc8, 0xcc):
                    h, w = struct.unpack('>HH', b[i + 5:i + 9])
                    return w, h
                i += 2 + struct.unpack('>H', b[i + 2:i + 4])[0]
    except (struct.error, IndexError):
        pass
    return 0, 0


def grava(perfil):
    os.makedirs(f'{D}/_raw', exist_ok=True)
    perfil['seg'] = round(time.time() - t0, 1)
    json.dump(perfil, open(f'{D}/_raw/perfil.json', 'w'), ensure_ascii=False, indent=1)


try:
    if json.load(open(ESTADO)).get('frio_ate', 0) > time.time():
        frio()
except (OSError, ValueError):
    pass

perfil = {'ig': '@' + user, 'url': f'https://www.instagram.com/{user}/', 'quando': time.strftime('%Y-%m-%dT%H:%M:%S'),
          'nome': '', 'bio': '', 'meta': '', 'seguidores': None, 'n_posts': None, 'link_bio': '', 'link_bio_status': None, 'link_bio_final': '', 'links': [],
          'posts': [], 'fotos': [], 'parcial': False}
cands = {}  # chave -> url de maior resolução

# 1) perfil: bio, link da bio, 12 posts, grid em 640 px
p = ig(f'https://www.instagram.com/{user}/')
if p == 'FRIO':
    frio()
if not p or p.get('status') not in (200, None) or 'accounts/login' in (p.get('final') or ''):
    print(f'ERRO perfil: status {p and p.get("status")}')
    sys.exit(1)
meta = p.get('meta', '')
perfil['meta'] = meta
m = re.match(r'(.*?) \(@', p.get('title', ''))
perfil['nome'] = m.group(1).strip() if m else ''
m = re.search(r'([\d.,]+\s*(?:mil|K|M)?)\s*seguidores', meta)
perfil['seguidores'] = m.group(1) if m else None
m = re.search(r'([\d.,]+)\s*posts', meta)
perfil['n_posts'] = m.group(1) if m else None
txt = p.get('text', '')
m = re.search(r'\bseguindo\s+(.*?)\s+(?:Mostrar mais posts|Meta Sobre|Postagens|Publicações|Posts\b)', txt)
perfil['bio'] = (m.group(1) if m else '')[:600]
for pre in (perfil['nome'], user):
    if pre and perfil['bio'].startswith(pre):
        perfil['bio'] = perfil['bio'][len(pre):].strip()
links = list(p.get('bioLinks') or []) + [l for l in (p.get('links') or []) if not any(f in l for f in FORA)]
links += ['https://' + x for x in re.findall(r'\b((?:linktr\.ee|wa\.me|api\.whatsapp\.com|bit\.ly|linkme\.bio|beacons\.ai|[a-z0-9-]+\.(?:com\.br|com|net|art\.br|site|online))/[^\s]*)', perfil['bio'])]
vist = []
for l in links:
    if l not in vist:
        vist.append(l)
perfil['links'] = vist[:6]
perfil['link_bio'] = vist[0] if vist and link_valido(vist[0]) else ''  # inválido = descartado
if perfil['link_bio']:
    perfil['link_bio_status'], perfil['link_bio_final'] = checa_link(perfil['link_bio'])
    if perfil['link_bio_final'] and not link_valido(perfil['link_bio_final']):
        perfil['link_bio_final'] = ''
perfil['posts'] = [re.sub(r'https://www\.instagram\.com/[^/]+/(p|reel)/', r'https://www.instagram.com/\1/', u) for u in (p.get('posts') or [])]
for u in p.get('imgs') or []:
    if 'cdninstagram' in u or 'fbcdn' in u:
        k = chave(u)
        if k not in cands or tamanho(u) > tamanho(cands[k]):
            cands[k] = u
grid = list(cands)  # ordem do grid

# 2) embed do perfil: 6 mais recentes em 1080 px
e = ig(f'https://www.instagram.com/{user}/embed/')
if e == 'FRIO':
    perfil['parcial'] = True
else:
    for u in (e or {}).get('imgs') or []:
        if ('cdninstagram' in u or 'fbcdn' in u) and tamanho(u) >= 320:
            k = chave(u)
            if k not in cands or tamanho(u) > tamanho(cands[k]):
                cands[k] = u
            if k not in grid:
                grid.insert(0, k)

# 3) opcional: N embeds de post (foto original)
for post in perfil['posts'][:NPOSTS]:
    if perfil['parcial']:
        break
    code = re.search(r'/(?:p|reel)/([^/]+)/', post)
    if not code:
        continue
    r = ig(f'https://www.instagram.com/p/{code.group(1)}/embed/captioned/')
    if r == 'FRIO':
        perfil['parcial'] = True
        break
    for u in (r or {}).get('imgs') or []:
        k = chave(u)
        if k in cands and tamanho(u) > tamanho(cands[k]):
            cands[k] = u

# 4) baixa direto do CDN (sem freio), maior resolução por foto
os.makedirs(f'{D}/img', exist_ok=True)
n = 0
for k in grid:
    if n >= MAXF:
        break
    u = cands[k]
    try:
        raw = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30).read()
    except Exception as ex:
        print('falhou', k[:30], type(ex).__name__)
        continue
    if len(raw) < 8000:
        continue
    n += 1
    nome = f'g{n:02d}.jpg'
    arq = f'{D}/img/{nome}'
    open(arq, 'wb').write(raw)
    w, h = dim_img(raw)
    perfil['fotos'].append({'arquivo': f'img/{nome}', 'w': w, 'h': h, 'bytes': len(raw)})

# maior primeiro: g01 é a mais nítida (candidata ao hero)
perfil['fotos'].sort(key=lambda f: -(f['w'] * f['h']))
for i, f in enumerate(perfil['fotos'], 1):
    os.rename(f'{D}/{f["arquivo"]}', f'{D}/img/_t{i:02d}.jpg')
for i, f in enumerate(perfil['fotos'], 1):
    os.rename(f'{D}/img/_t{i:02d}.jpg', f'{D}/img/g{i:02d}.jpg')
    f['arquivo'] = f'img/g{i:02d}.jpg'
grava(perfil)
grandes = sum(1 for f in perfil['fotos'] if f['w'] >= 1000)
print(f'{slug}: {n} fotos ({grandes} com >= 1000 px), link da bio: {perfil["link_bio"] or "-"}, {perfil["seg"]} s')
print(f'{D}/_raw/perfil.json')
if perfil['parcial'] and n < 6:
    frio()
sys.exit(0 if n >= 6 else 2)
