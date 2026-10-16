#!/usr/bin/env python3
"""Servidor local do mini CRM: http://127.0.0.1:4180 (porta: CRM_PORTA; dados: CRM_DIR, padrão ./data)

GET  /                 página (web/)
GET  /api/versao       {"versao": "<mtime-tamanho>"}  (polling leve)
GET  /api/estado       {versao, etapas, negocios}
GET  /api/painel       {agora, etapas, motivos, categorias, leads}  (só leitura; filtros e contas no cliente)
POST /api/mover        {slug, etapa, motivo?, em?}
POST /api/editar       {slug, campos: {"proposta.valor": 500, ...}}
POST /api/mensagem     {slug, de, quando, texto, anexo?, fonte?}
POST /api/mensagem/apagar {slug, id}
POST /api/nota         {slug, texto, quando?}
POST /api/novo         {slug, nome, cidade?, nicho?, etapa?}
POST /api/cobranca     {slug, quando, motivo, texto?}
POST /api/cobranca/feita   {slug, id}
POST /api/cobranca/adiar   {slug, id, quando}      quando: "amanha", "+3", "20/10 10:00"
POST /api/cobranca/editar  {slug, id, campos: {quando?, motivo?, texto_sugerido?}}
POST /api/cobranca/apagar  {slug, id}
POST /api/contato          {nome, whatsapp, negocio?, papel?, nota?}
POST /api/contato/editar   {id, campos: {nome?, papel?, whatsapp?, nota?, negocio?}}
POST /api/contato/apagar   {id}
POST /api/enviada          {slug, fase, desfazer?}   fase: m1 m2 m2a m3 fu (grava a msg e move o funil)

/api/estado traz, por negócio, "fases": {fase: {texto, origem}} lidas ao vivo do roteiro.md da prévia, e
"fila"/"fila_msg2" (slugs em ordem). A versão muda também quando um roteiro muda.

Lembrete: enquanto o servidor está de pé, a cada minuto (CRM_CHECAR_S) cria as sugestões automáticas e dispara
uma notificação do sistema (macOS via osascript; em outro sistema só imprime no log) por cobrança vencida (marca notificada_em; só entre 08:00 e 18:00).
CRM_SEM_LEMBRETE=1 desliga o lembrete (servidor de teste numa cópia com CRM_DIR).

Lê o crm.json do disco a cada pedido, então o que a CLI grava aparece na página.
"""
import datetime as dt
import glob
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import crm  # noqa: E402

WEB = os.path.join(AQUI, "web")
HOST, PORTA = "127.0.0.1", int(os.environ.get("CRM_PORTA", "4180"))
CHECAR_S = float(os.environ.get("CRM_CHECAR_S", "60"))


def notificar(titulo, texto):
    """Notificação do macOS. Texto vai por argv (sem montar AppleScript com dado do arquivo).
    Sem osascript (Linux, Windows): só imprime no log."""
    if not shutil.which("osascript"):
        print(f"lembrete: {titulo}: {texto}", flush=True)
        return
    script = ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run"]
    try:
        subprocess.run(["osascript", *script, titulo, texto], timeout=10, check=False, capture_output=True)
    except (OSError, subprocess.SubprocessError) as e:
        print(f"notificação falhou: {e}", flush=True)


def checar_cobrancas():
    """Uma rodada: sugestões automáticas + notificação única de cada cobrança vencida (08:00 a 18:00)."""
    t = crm.agora_dt()
    avisar = []
    with crm.trava():
        d = crm.carregar()
        mudou = crm.sincronizar(d)
        if 8 <= t.hour < 18:
            agora = t.strftime(crm.FMT)
            for n in d["negocios"].values():
                for c in n["cobrancas"]:
                    if not c["feita"] and not c.get("notificada_em") and c["quando"] <= agora:
                        c["notificada_em"] = agora
                        avisar.append((n["nome"], c))
                        mudou = True
        if mudou:
            crm.gravar(d)
    for nome, c in avisar:
        notificar(f"Cobrar: {nome}", c["motivo"])
        print(f"{t:%Y-%m-%d %H:%M} notificado {nome} {c['id']}", flush=True)
    return len(avisar)


def vigiar():
    while True:
        try:
            checar_cobrancas()
        except Exception as e:  # o lembrete nunca derruba o servidor
            print(f"checagem falhou: {e!r}", flush=True)
        time.sleep(CHECAR_S)


def versao():
    with crm.trava():
        slugs = list(crm.carregar()["negocios"]) if os.path.exists(crm.DADOS) else []
    return crm.versao_arquivo() + "-" + crm.versao_roteiros(slugs)


def estado():
    with crm.trava():
        d = crm.carregar()
        v = crm.versao_arquivo()
    for n in d["negocios"].values():
        n["fases"] = crm.textos_fases(n)
    return {"versao": v + "-" + crm.versao_roteiros(d["negocios"]), "etapas": [{"id": i, "nome": n} for i, n in crm.ETAPAS],
            "negocios": list(d["negocios"].values()), "contatos": crm.todos_contatos(d),
            "fases": [{"id": i, "nome": n, "sub": s} for i, n, s in crm.FASES],
            "fila": [n["slug"] for n in crm.fila_envio(d)], "fila_msg2": [n["slug"] for n in crm.fila_msg2(d)],
            "fila_sem_numero": len(crm.fila_sem_numero(d))}


# ---------- Painel (só leitura) ----------
# Fontes opcionais do bloco "tempo real" (caminhos vêm só do ambiente, nada da query string). Vazio = bloco desligado.
#   CRM_AGENTES_GLOB: glob de journals JSONL de um harness de agente (linhas {type: started|result, key, label, phase,
#                     agentId}; ao lado, agent-<id>.meta.json e agent-<id>.jsonl dão início e última atividade).
#   CRM_LOG_MD:       arquivo markdown de log do dia a dia; entram as linhas "- dd/mm hh:mm texto".
#   CRM_IG_ESTADO:    JSON do freio do Instagram ({frio_ate, n}), ex.: <IG_FREIO_DIR>/ig-freio.json do ig-get.py.
JOURNALS = os.environ.get("CRM_AGENTES_GLOB", "")
LOG_MD = os.environ.get("CRM_LOG_MD", "")
IG_JSON = os.environ.get("CRM_IG_ESTADO", "")
JANELA_WF_S = 2 * 3600

# Nicho é texto livre no CRM. Regra: primeira palavra-chave que aparecer no texto (minúsculo) decide a categoria.
# Ordem importa ("festa inteira: bolo..." é festa, não doce). Edite à vontade; o que não bater vira "Outros".
NICHO_REGRAS = [
    ("Noiva e moda", ["noiva", "vestido", "debutante", "moda", "lingerie", "bordado"]),
    ("Festa e evento", ["festa inteira", "buffet", "evento", "festa", "pula-pula", "decoração"]),
    ("Doce e bolo", ["confeit", "bolo", "doce", "biscuit", "brigadeiro", "padaria"]),
    ("Beleza e estética", ["beleza", "estética", "barbearia", "tatuagem", "piercing", "cabel", "unha"]),
    ("Saúde", ["saúde", "clínica", "nutri", "acupuntura", "pilates", "academia", "fono", "odonto", "fisio", "ótica", "veterin"]),
    ("Comida e delivery", ["pizzaria", "restaurante", "hamburgueria", "marmita", "lanche", "açaí", "delivery"]),
    ("Loja e presentes", ["cesta", "presente", "floricultura", "celular", "materiais", "pet", "loja"]),
    ("Serviços", ["contabilidade", "fotografia", "serralheria", "escola", "hospedagem", "chalé", "advoca", "imobili"]),
]
ORDEM_ETAPA = {e: i for i, (e, _) in enumerate(crm.ETAPAS)}
AVANCO = ["previa", "abordado", "respondeu", "link", "proposta", "negociando", "ganho"]
RE_LOG = re.compile(r"^- (\d{2})/(\d{2}) (\d{2}):(\d{2}) (.*)")
RE_AUTO = re.compile(r"resposta autom", re.I)
NEGAM = [  # id, rótulo, ordem no gráfico
    ("sem_m1", "Sem resposta à Msg 1"),
    ("sem_m2", "Sem resposta à Msg 2"),
    ("rec_m1", "Recusou na Msg 1"),
    ("rec_m2", "Recusou após a Msg 2"),
    ("sumiu_link", "Sumiu após o link"),
    ("rec_link", "Recusou após o link"),
    ("rec_preco", "Recusou após preço/proposta"),
    ("sumiu_prop", "Sumiu após proposta"),
]


def nicho_cat(txt):
    t = (txt or "").lower()
    for cat, chaves in NICHO_REGRAS:
        if any(k in t for k in chaves):
            return cat
    return "Outros"


def _idade(seg):
    seg = max(0, int(seg))
    if seg < 60:
        return f"{seg}s"
    if seg < 3600:
        return f"{seg // 60} min"
    return f"{seg // 3600}h{(seg % 3600) // 60:02d}"


def painel_workflows(agora):
    out = []
    for jp in (glob.glob(os.path.expanduser(JOURNALS)) if JOURNALS else []):
        try:
            mt = os.path.getmtime(jp)
        except OSError:
            continue
        if agora - mt > JANELA_WF_S:
            continue
        abertos, fechados, total = {}, set(), 0
        try:
            with open(jp, encoding="utf-8") as f:
                for ln in f:
                    try:
                        o = json.loads(ln)
                    except ValueError:
                        continue
                    if o.get("type") == "started" and o.get("key"):
                        abertos[o["key"]] = o
                        total += 1
                    elif o.get("type") == "result" and o.get("key"):
                        fechados.add(o["key"])
        except OSError:
            continue
        pasta = os.path.dirname(jp)
        ag = []
        for k, o in abertos.items():
            if k in fechados:
                continue
            aid = str(o.get("agentId") or "")
            ini = ult = None
            if re.fullmatch(r"[a-z0-9]{6,40}", aid):
                for nome, campo in ((f"agent-{aid}.meta.json", "ini"), (f"agent-{aid}.jsonl", "ult")):
                    try:
                        t = os.path.getmtime(os.path.join(pasta, nome))
                    except OSError:
                        continue
                    if campo == "ini":
                        ini = t
                    else:
                        ult = t
            ag.append({"label": str(o.get("label") or ""), "fase": str(o.get("phase") or ""),
                       "ha": _idade(agora - ini) if ini else "", "ini": ini or 0,
                       "parado": bool(ult and agora - ult > 600), "ultimo": _idade(agora - ult) if ult else ""})
        ag.sort(key=lambda a: a["ini"], reverse=True)
        out.append({"id": os.path.basename(pasta), "mod": mt, "mod_ha": _idade(agora - mt),
                    "ativos": ag, "feitos": len(fechados & set(abertos)), "total": total})
    out.sort(key=lambda w: (not w["ativos"], -w["mod"]))
    return out


def painel_log(n=8):
    if not LOG_MD:
        return []
    try:
        with open(os.path.expanduser(LOG_MD), encoding="utf-8") as f:
            linhas = f.read().splitlines()
    except OSError:
        return []
    achadas = []
    for i, ln in enumerate(linhas):
        m = RE_LOG.match(ln)
        if m:
            dd, mm, hh, mi, txt = m.groups()
            achadas.append(((mm, dd, hh, mi, i), f"{dd}/{mm}", f"{hh}:{mi}", txt.replace("**", "").strip()))
    achadas.sort(key=lambda x: x[0])
    return [{"dia": d, "hora": h, "texto": t} for _, d, h, t in reversed(achadas[-n:])]


def painel_ig(agora):
    if not IG_JSON:
        return {"estado": "sem dado"}
    try:
        with open(os.path.expanduser(IG_JSON), encoding="utf-8") as f:
            o = json.load(f)
        frio = float(o.get("frio_ate") or 0)
    except (OSError, ValueError, TypeError, AttributeError):
        return {"estado": "sem dado"}
    r = {"n": o.get("n"), "estado": "livre"}
    if frio > agora:
        r["estado"] = "pausa"
        r["ate"] = time.strftime("%H:%M", time.localtime(frio))
        r["falta"] = _idade(frio - agora)
    return r


def _fase_msg(m, por_id):
    """Fase de uma mensagem nossa: pelo envio marcado, senão pelo texto."""
    if m.get("id") in por_id:
        f = por_id[m["id"]]
        return {"m1": 1, "m2": 2, "m2a": 2, "m3": 3, "fu": 3}.get(f, 1)
    t = (m.get("texto") or "").lower()
    if "r$" in t or "proposta" in t or (m.get("anexo") or "").lower().endswith(".pdf"):
        return 4
    if "http" in t:
        return 3
    if re.search(r"\baqui é (o|a) ", t) or "msg 2" in t:  # Msg 2 se apresenta ("aqui é o Fulano")
        return 2
    return 1


def _respondeu(n):
    return any(m.get("de") == "eles" and not RE_AUTO.search(m.get("texto") or "") for m in n.get("mensagens", []))


def _chegou(n, etapa):
    """Já passou por essa etapa (atual, histórico de eventos ou dado gravado)."""
    alvo = ORDEM_ETAPA[etapa]
    if n["etapa"] in AVANCO and ORDEM_ETAPA[n["etapa"]] >= alvo:
        return True
    nome = dict(crm.ETAPAS)
    alvos = [nome[e] for e in AVANCO[AVANCO.index(etapa):]]
    for ev in n.get("eventos", []):
        t = ev.get("texto") or ""
        if any(f"→ {a}" in t or t.startswith(f"Criado em {a}") for a in alvos):
            return True
    if etapa == "link" and "m3" in (n.get("envios") or {}):
        return True
    if etapa == "proposta" and (n.get("proposta") or {}).get("enviada_em"):
        return True
    return False


def _testado(n):
    if n["etapa"] == "previa":
        return False
    if n["etapa"] == "retomar":
        return bool(n.get("mensagens") or n.get("envios"))
    return True


def onde_negou(n):
    """Classifica um perdido pela fase mais longe que nossas mensagens chegaram e se houve resposta."""
    nomes = dict(crm.ETAPAS)
    t_perda, antes, mot_ev = "9999", "", ""
    for ev in n.get("eventos", []):
        t = ev.get("texto") or ""
        if f"→ {nomes['perdido']}" in t:
            t_perda, antes = ev.get("quando") or "9999", t.split("→")[0].strip()
            mot_ev = t.split("→", 1)[1]
            break
    por_id = {v.get("msg"): f for f, v in (n.get("envios") or {}).items() if isinstance(v, dict)}
    msgs = [m for m in n.get("mensagens", []) if (m.get("quando") or "") <= t_perda]
    nossas = [m for m in msgs if m.get("de") == "eu"]
    fase = max([_fase_msg(m, por_id) for m in nossas] or [0])
    inv = {v: k for k, v in nomes.items()}
    e_antes = inv.get(antes, "")
    if e_antes in ("proposta", "negociando"):
        fase = max(fase, 4)
    elif e_antes == "link":
        fase = max(fase, 3)
    mot = ((n.get("motivo_perda") or "") + " " + mot_ev).lower()
    if re.search(r"orçament|preço|valor|caro", mot):
        fase = max(fase, 4)
    elif re.search(r"msg ?2", mot):
        fase = max(fase, 2)
    elif "link" in mot:
        fase = max(fase, 3)
    ult_nossa = max((m.get("quando") or "" for m in nossas), default="")
    # resposta conta mesmo gravada depois do evento de perda (print registrado com atraso)
    resp = [m for m in n.get("mensagens", []) if m.get("de") == "eles" and not RE_AUTO.search(m.get("texto") or "")]
    recusou = bool(resp) or bool(re.search(r"recus|não|sem interesse|encerr|fechou|já está|contrato|orçament", mot))
    if fase <= 1:
        k = "rec_m1" if recusou else "sem_m1"
    elif fase == 2:
        k = "rec_m2" if recusou else "sem_m2"
    elif fase == 3:
        k = "rec_link" if any((m.get("quando") or "") >= ult_nossa for m in resp) or (recusou and not nossas) else "sumiu_link"
    else:
        k = "rec_preco" if recusou else "sumiu_prop"
    return k


CIDADES = [(nome.strip(), [p.strip().lower() for p in pre.split("|") if p.strip()])
           for nome, _, pre in (x.partition("=") for x in os.environ.get("CRM_CIDADES", "").split(";") if "=" in x)]


def cidade_norm(c):
    """Agrupa grafias da mesma cidade. CRM_CIDADES (opcional): "Sigla=prefixo1|prefixo2;Outra=prefixo"."""
    t = (c or "").strip().lower()
    if not t:
        return "Sem cidade"
    for nome, prefixos in CIDADES:
        if any(t.startswith(p) for p in prefixos):
            return nome
    return (c or "").strip()


def _primeiro_evento(n, alvos):
    ts = [ev.get("quando") or "" for ev in n.get("eventos", [])
          if any(f"→ {a}" in (ev.get("texto") or "") for a in alvos)]
    return min([t for t in ts if t], default="")


def datas_lead(n):
    """Quando o lead chegou em cada marco (AAAA-MM-DD HH:MM ou ""): Msg 1, resposta, link, proposta."""
    nomes = dict(crm.ETAPAS)
    env = n.get("envios") or {}
    por_id = {v.get("msg"): f for f, v in env.items() if isinstance(v, dict)}
    msgs = sorted(n.get("mensagens", []), key=lambda m: m.get("quando") or "")
    nossas = [m for m in msgs if m.get("de") == "eu" and m.get("quando")]
    resp = [m for m in msgs if m.get("de") == "eles" and m.get("quando") and not RE_AUTO.search(m.get("texto") or "")]
    def env_q(f):
        v = env.get(f)
        return v.get("quando") or "" if isinstance(v, dict) else ""
    def msg_fase(minimo):
        return next((m["quando"] for m in nossas if _fase_msg(m, por_id) >= minimo), "")
    def menor(*xs):
        return min([x for x in xs if x], default="")
    d = {
        "abordado": menor(env_q("m1"), nossas[0]["quando"] if nossas else "", _primeiro_evento(n, [nomes["abordado"]])),
        "respondeu": menor(resp[0]["quando"] if resp else "", _primeiro_evento(n, [nomes["respondeu"]])),
        "link": menor(env_q("m3"), _primeiro_evento(n, [nomes["link"]]), msg_fase(3)),
        "proposta": menor(_primeiro_evento(n, [nomes["proposta"], nomes["negociando"], nomes["ganho"]]),
                          (n.get("proposta") or {}).get("enviada_em") or "", msg_fase(4)),
    }
    if not d["abordado"] and _testado(n):  # abordado antes do CRM: usa a 1ª mensagem que houver
        d["abordado"] = msgs[0]["quando"] if msgs and msgs[0].get("quando") else ""
    return d


def lead_painel(n):
    test = _testado(n)
    resp = test and (_respondeu(n) or n["etapa"] in ("respondeu", "proposta", "negociando", "ganho")
                     or any("→ Respondeu" in (ev.get("texto") or "") for ev in n.get("eventos", [])))
    link = test and _chegou(n, "link")
    prop = test and _chegou(n, "proposta")
    alc = {"negociando": 5, "ganho": 6}.get(n["etapa"]) or (4 if prop else 3 if link else 2 if resp else 1 if test else 0)
    evs = sorted(n.get("eventos", []), key=lambda e: e.get("quando") or "")
    ult = evs[-1] if evs else {}
    return {"slug": n["slug"], "nome": n["nome"], "nicho": n.get("nicho") or "", "cat": nicho_cat(n.get("nicho")),
            "cidade": cidade_norm(n.get("cidade")), "etapa": n["etapa"], "etapa_desde": n.get("etapa_desde") or "",
            "testado": test, "respondeu": bool(resp), "link": bool(link), "proposta": bool(prop),
            "ganho": n["etapa"] == "ganho", "valor": float((n.get("proposta") or {}).get("valor") or 0),
            "alcance": alc, "negou": onde_negou(n) if n["etapa"] == "perdido" else "",
            "abriu": (lambda r: {"n": r["n"], "visitantes": r["visitantes"], "ultimo": r["ultimo"][:16], "gerada": r["gerada"]})(crm.resumo_acessos(n)),
            "datas": datas_lead(n), "ultimo": {"quando": ult.get("quando") or "", "texto": (ult.get("texto") or "")[:160]}}


def painel_aberturas(ns, n=8):
    """Últimas aberturas reais da prévia (sem IP: só hash curto no CRM)."""
    ev = [{"slug": x["slug"], "nome": x["nome"], "quando": a["q"][:16], "disp": a.get("d") or ""}
          for x in ns for a in (x.get("acessos") or []) if a.get("t") == "abriu"]
    return sorted(ev, key=lambda e: e["quando"], reverse=True)[:n]


def painel():
    agora = time.time()
    with crm.trava():
        d = crm.carregar()
    ns = list(d["negocios"].values())
    recebidas = []
    for n in ns:
        for m in n.get("mensagens", []):
            if m.get("de") == "eles":
                recebidas.append({"slug": n["slug"], "nome": n["nome"], "quando": m.get("quando") or "",
                                  "texto": (m.get("texto") or "")[:220], "auto": bool(RE_AUTO.search(m.get("texto") or ""))})
    recebidas.sort(key=lambda r: r["quando"], reverse=True)
    return {
        "gerado_em": time.strftime("%H:%M:%S"),
        "agora": {"workflows": painel_workflows(agora), "log": painel_log(), "recebidas": recebidas[:40],
                  "instagram": painel_ig(agora), "aberturas": painel_aberturas(ns),
                  "fontes": {"agentes": bool(JOURNALS), "log": bool(LOG_MD), "instagram": bool(IG_JSON)}},
        "etapas": [{"id": e, "nome": nm} for e, nm in crm.ETAPAS],
        "motivos": [{"id": k, "nome": nm} for k, nm in NEGAM],
        "categorias": [c for c, _ in NICHO_REGRAS] + ["Outros"],
        "leads": [lead_painel(n) for n in ns],
    }


class H(BaseHTTPRequestHandler):
    server_version = "crm/1"

    def log_message(self, fmt, *a):
        if os.environ.get("CRM_LOG"):
            super().log_message(fmt, *a)

    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/versao":
            return self._json({"versao": versao()})
        if p == "/api/estado":
            return self._json(estado())
        if p == "/api/painel":
            return self._json(painel())
        if p == "/":
            p = "/index.html"
        raiz = os.path.realpath(WEB)
        arq = os.path.realpath(os.path.join(raiz, urllib.parse.unquote(p).lstrip("/")))
        if not arq.startswith(raiz + os.sep) or not os.path.isfile(arq):
            return self._json({"erro": "não encontrado"}, 404)
        with open(arq, "rb") as f:
            b = f.read()
        tipo = mimetypes.guess_type(arq)[0] or "application/octet-stream"
        if tipo.startswith("text/") or tipo.endswith("javascript"):
            tipo += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_POST(self):
        p = self.path.split("?")[0]
        try:
            corpo = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            emp = tarde = False
            with crm.editando() as d:
                slug = corpo.get("slug", "")
                if p == "/api/mover":
                    crm.op_move(d, slug, corpo.get("etapa"), corpo.get("motivo"), corpo.get("em"))
                elif p == "/api/editar":
                    for k, v in (corpo.get("campos") or {}).items():
                        crm.op_set(d, slug, k, v)
                elif p == "/api/mensagem":
                    crm.op_msg(d, slug, corpo.get("de"), corpo.get("quando"), corpo.get("texto", ""),
                               corpo.get("anexo", ""), corpo.get("fonte") or "manual")
                elif p == "/api/mensagem/apagar":
                    crm.op_msg_apagar(d, slug, corpo.get("id"))
                elif p == "/api/nota":
                    crm.op_nota(d, slug, corpo.get("texto", ""), corpo.get("quando"), bool(corpo.get("envio")))
                elif p == "/api/cobranca":
                    _, emp = crm.op_cobrar(d, slug, corpo.get("quando"), corpo.get("motivo", ""), corpo.get("texto", ""))
                elif p == "/api/cobranca/feita":
                    crm.op_feita(d, slug, corpo.get("id"))
                elif p == "/api/cobranca/adiar":
                    _, emp = crm.op_adiar(d, slug, corpo.get("id"), corpo.get("quando"))
                elif p == "/api/cobranca/editar":
                    _, emp = crm.op_cobranca_editar(d, slug, corpo.get("id"), corpo.get("campos"))
                elif p == "/api/cobranca/apagar":
                    crm.op_cobranca_apagar(d, slug, corpo.get("id"))
                elif p == "/api/contato":
                    crm.op_contato_novo(d, corpo.get("nome", ""), corpo.get("whatsapp", ""), corpo.get("negocio", ""),
                                        corpo.get("papel", ""), corpo.get("nota", ""))
                elif p == "/api/contato/editar":
                    crm.op_contato_editar(d, corpo.get("id"), corpo.get("campos"))
                elif p == "/api/contato/apagar":
                    crm.op_contato_apagar(d, corpo.get("id"))
                elif p == "/api/enviada":
                    if corpo.get("desfazer"):
                        crm.op_desfazer_envio(d, slug, corpo.get("fase"))
                    else:
                        crm.op_enviada(d, slug, corpo.get("fase"))
                        tarde = crm.agora_dt().hour >= 18
                elif p == "/api/novo":
                    crm.op_add(d, slug, nome=corpo.get("nome") or slug, cidade=corpo.get("cidade", ""),
                               nicho=corpo.get("nicho", ""), etapa=corpo.get("etapa") or "previa")
                else:
                    raise crm.ErroCRM("rota não existe")
        except crm.ErroCRM as e:
            return self._json({"erro": str(e)}, 400)
        except (ValueError, KeyError) as e:
            return self._json({"erro": f"pedido inválido: {e}"}, 400)
        r = estado()
        if emp:
            r["aviso"] = "Passou das 18h ou caiu no domingo: ficou pro próximo dia às 10:00"
        if tarde:
            r["aviso"] = "Marcada. Depois das 18h, melhor mandar amanhã"
        return self._json(r)


def main():
    srv = ThreadingHTTPServer((HOST, PORTA), H)
    print(f"CRM em http://{HOST}:{PORTA}", flush=True)
    if not os.environ.get("CRM_SEM_LEMBRETE"):
        threading.Thread(target=vigiar, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
