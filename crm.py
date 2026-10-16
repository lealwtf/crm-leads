#!/usr/bin/env python3
"""Mini CRM de leads. Fonte única: <CRM_DIR>/crm.json (padrão ./data). Só stdlib.

Uso rápido (saída curta de propósito):
  crm.py add <slug> --nome "X" [--cidade --nicho --etapa --instagram --whatsapp --contato --papel --tags a,b]
  crm.py set <slug> <campo> <valor>        campo pode ser aninhado: proposta.valor, previa.url
  crm.py contato <slug> --nome X [--papel dono --whatsapp 5500000000000 --fonte print]
  crm.py contato-novo --nome X --whatsapp 5500000000000 [--negocio slug --papel dono --nota "..."]
  crm.py contatos [--busca texto]          lista todos (dos negócios e avulsos), com id
  crm.py contato-set <id> <campo> <valor>  campo: nome, papel, whatsapp, nota, negocio ("" = avulso)
  crm.py move <slug> <etapa> [--motivo "..."] [--em 2026-10-20]
  crm.py msg <slug> --de eu|eles --quando "2026-10-13 10:39" --texto "..." [--anexo X] [--fonte print|whatsapp-tela|manual]
  crm.py nota <slug> "texto" [--quando "2026-10-13 10:40"]
  crm.py show <slug> [--msgs 10]
  crm.py list [--etapa respondeu]
  crm.py import-json arquivo.json
  crm.py rm <slug>
  crm.py cobrar <slug> --em "2026-10-20 09:00" --motivo "..." [--texto "..."]
  crm.py feita <slug> [<id>]               sem id: a cobrança aberta mais antiga
  crm.py adiar <slug> <id> --em "amanha" | "+3" | "20/10 10:00"
  crm.py hoje                              responder + cobranças vencidas/de hoje + prazos
  crm.py enviada <slug> <fase> [--quando "13/10 14:01"] [--desfazer]   fase: m1 m2 m2a m3 fu
  crm.py fila                              quem falta a Msg 1 + quem falta a Msg 2
  crm.py textos <slug>                     textos das fases (roteiro.md ao vivo)
Ambiente: CRM_DIR (pasta dos dados, padrão ./data), CRM_DADOS (arquivo, sobrepõe CRM_DIR),
  CRM_PREVIAS (pasta das prévias com roteiro.md, opcional), CRM_HOJE (data simulada pra teste:
  "2026-10-20" ou "2026-10-20 09:30").
"""
import argparse
import contextlib
import copy
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import shutil
import sys
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
# Pasta de dados: CRM_DIR (padrão <repo>/data). CRM_DADOS aponta direto pro arquivo (tem prioridade).
PASTA = os.path.abspath(os.environ.get("CRM_DIR") or os.path.join(AQUI, "data"))
DADOS = os.path.abspath(os.environ.get("CRM_DADOS") or os.path.join(PASTA, "crm.json"))
# Opcional: pasta das prévias (<CRM_PREVIAS>/<slug>/roteiro.md traz os textos das mensagens). Padrão <repo>/previas.
PREVIAS = os.path.abspath(os.environ.get("CRM_PREVIAS") or os.path.join(AQUI, "previas"))
MAX_BACKUPS = 30

ETAPAS = [
    ("previa", "Prévia pronta"),
    ("abordado", "Abordado (msg 1/2)"),
    ("respondeu", "Respondeu"),
    ("link", "Link enviado"),
    ("proposta", "Proposta enviada"),
    ("negociando", "Negociando"),
    ("ganho", "Fechado (ganho)"),
    ("perdido", "Perdido"),
    ("retomar", "Retomar depois"),
]
ETAPA_IDS = [e[0] for e in ETAPAS]
ETAPA_NOME = dict(ETAPAS)
FONTES = ("print", "whatsapp-tela", "manual", "marcado")  # marcado = "Marcar enviada" (fila/painel)
PAPEIS = ("dono", "atendente", "sócio", "outro")


class ErroCRM(Exception):
    pass


# ---------- tempo ----------

def agora_dt():
    """Agora local. CRM_HOJE simula a data (teste): 'AAAA-MM-DD' (meio-dia) ou 'AAAA-MM-DD HH:MM'."""
    h = os.environ.get("CRM_HOJE", "").strip()
    if h:
        for fmt, meio in (("%Y-%m-%d %H:%M", False), ("%Y-%m-%d", True)):
            try:
                t = dt.datetime.strptime(h, fmt)
                return t.replace(hour=12) if meio else t
            except ValueError:
                pass
        raise ErroCRM(f"CRM_HOJE inválido: {h!r}")
    return dt.datetime.now().replace(second=0, microsecond=0)


def agora():
    return agora_dt().strftime("%Y-%m-%d %H:%M")


def norm_quando(s):
    """Aceita 'YYYY-MM-DD HH:MM', 'YYYY-MM-DDTHH:MM' ou 'DD/MM HH:MM' (ano atual)."""
    if not s:
        return agora()
    s = s.strip().replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s, fmt).strftime("%Y-%m-%d %H:%M")
        except ValueError:
            pass
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})(?:/(\d{4}))?\s+(\d{1,2}):(\d{2})", s)
    if m:
        d, mo, a, h, mi = m.groups()
        a = int(a) if a else dt.date.today().year
        return dt.datetime(a, int(mo), int(d), int(h), int(mi)).strftime("%Y-%m-%d %H:%M")
    raise ErroCRM(f"quando inválido: {s!r} (use 'AAAA-MM-DD HH:MM')")


def norm_data(s):
    if not s:
        return ""
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return dt.datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})", s)
    if m:
        return dt.date(dt.date.today().year, int(m.group(2)), int(m.group(1))).isoformat()
    raise ErroCRM(f"data inválida: {s!r} (use AAAA-MM-DD)")


# ---------- modelo ----------

def negocio_vazio(slug):
    t = agora()
    return {
        "slug": slug,
        "nome": slug,
        "cidade": "",
        "nicho": "",
        "contatos": [],
        "instagram": "",
        "previa": {"url": "", "appId": "", "publicada": False, "og": ""},
        "proposta": {"valor": None, "forma": "", "pdf": "", "enviada_em": ""},
        "etapa": "previa",
        "etapa_desde": t,
        "etapa_desde_fonte": "criacao",  # movimento | criacao | estimado | desconhecido (só os 2 primeiros são exatos)
        "proximo_passo": "",
        "proximo_em": "",
        "motivo_perda": "",
        "tags": [],
        "criado_em": t,
        "atualizado_em": t,
        "mensagens": [],
        "eventos": [],
        "cobrancas": [],
        "envios": {},  # fase -> {quando, msg, etapa_antes, ...} (Marcar enviada)
        "textos": {},  # fase -> texto que substitui o do roteiro (opcional)
        "acessos": [],  # aberturas da prévia, gravadas por op_acessos: {q, t: abriu|previa_gerada, d: celular|desktop, v: hash curto do visitante}
    }


def normalizar(n):
    """Garante todas as chaves (dado antigo ou importado)."""
    base = negocio_vazio(n.get("slug", ""))
    for k, v in base.items():
        if k in ("etapa_desde", "etapa_desde_fonte"):
            continue  # preenchido abaixo a partir dos eventos, não com "agora"
        if k not in n:
            n[k] = copy.deepcopy(v)
        elif isinstance(v, dict) and isinstance(n[k], dict):
            for k2, v2 in v.items():
                n[k].setdefault(k2, v2)
    if n["etapa"] not in ETAPA_IDS:
        n["etapa"] = "previa"
    n["mensagens"].sort(key=lambda m: m.get("quando", ""))
    for c in n["cobrancas"]:
        for k, v in (("texto_sugerido", ""), ("feita", False), ("feita_em", ""), ("auto", False), ("notificada_em", "")):
            c.setdefault(k, v)
    n["cobrancas"].sort(key=lambda c: c.get("quando", ""))
    for i, c in enumerate(n["contatos"]):
        _norm_contato(c, f"{n['slug']}|{i}")
    if not n.get("etapa_desde_fonte"):
        # migração aditiva: dado antigo não sabe de onde veio etapa_desde. A importação gravou a hora dela
        # ("Criado em <etapa>" com atividade anterior); esse valor é trocado por uma estimativa a partir do histórico.
        valor, fonte = _backfill_etapa_desde(n)
        atual = n.get("etapa_desde") or ""
        if not atual or atual == _importado_em(n) or atual == valor:
            n["etapa_desde"], n["etapa_desde_fonte"] = valor, fonte
        else:
            n["etapa_desde_fonte"] = "desconhecido"
    elif not n.get("etapa_desde"):
        n["etapa_desde"], n["etapa_desde_fonte"] = _backfill_etapa_desde(n)
    return n


def _importado_em(n):
    """Hora do evento 'Criado em <etapa>' quando ele é de importação (já havia mensagem ou evento antes dele)."""
    cri = next((e["quando"] for e in n["eventos"] if e.get("texto", "").startswith("Criado em ")), "")
    if not cri:
        return ""
    antes = any(e.get("quando", "") < cri for e in n["eventos"]) or any(m.get("quando", "") < cri for m in n["mensagens"])
    return cri if antes else ""


def _backfill_etapa_desde(n):
    """(quando entrou na etapa atual, fonte). Exato: último movimento pra ela ou criação nela sem histórico anterior.
    Importado: estimativa pelo histórico (proposta enviada, primeiro envio, primeira resposta, evento da etapa)."""
    nome = ETAPA_NOME[n["etapa"]]
    for e in reversed(n["eventos"]):
        t = e.get("texto", "")
        if "→" in t and t.split("→", 1)[1].strip().startswith(nome):
            return e["quando"], "movimento"
    imp = _importado_em(n)
    if not imp:
        for e in reversed(n["eventos"]):
            if e.get("texto", "").startswith(f"Criado em {nome}"):
                return e["quando"], "criacao"
        if not n["eventos"] and not n["mensagens"]:
            return n.get("criado_em") or agora(), "criacao"
    reais = [e for e in n["eventos"] if not (imp and e.get("quando") == imp and re.match(r"(Criado em|Proposta:)", e.get("texto", "")))]
    msgs = sorted(m["quando"] for m in n["mensagens"] if m.get("quando"))
    eu = sorted(m["quando"] for m in n["mensagens"] if m.get("de") == "eu" and m.get("quando"))
    eles = sorted(m["quando"] for m in n["mensagens"] if m.get("de") == "eles" and m.get("quando"))
    env = n["proposta"].get("enviada_em") or ""
    env = env + " 00:00" if len(env) == 10 else env

    def ev(rx, ultimo=True):
        xs = sorted(e["quando"] for e in reais if re.search(rx, e.get("texto", ""), re.I))
        return (xs[-1] if ultimo else xs[0]) if xs else ""

    et = n["etapa"]
    if et == "proposta":
        c = env or ev(r"proposta|R\$")
    elif et == "negociando":
        c = next((q for q in eles if not env or q >= env), "") or env or (msgs[0] if msgs else "")
    elif et == "abordado":
        c = (eu[0] if eu else "") or ev(r"msg|abordad|enviad", ultimo=False)
    elif et == "link":
        c = ev(r"link")
    elif et == "respondeu":
        c = (eles[0] if eles else "") or ev(r"respond")
    elif et == "previa":
        c = ev(r"pr[eé]via", ultimo=False)
    else:  # ganho, perdido, retomar: o último fato registrado
        c = ev(r".")
    if not c:
        c = max([e["quando"] for e in reais] + msgs, default="")
    if not c:
        return n.get("criado_em") or agora(), "desconhecido"
    return c, "estimado"


def _norm_contato(c, semente):
    for k in ("nome", "papel", "whatsapp", "fonte", "nota"):
        c.setdefault(k, "")
    if not c.get("id"):
        # determinístico: o mesmo contato tem o mesmo id entre leituras até a próxima gravação persistir
        c["id"] = "k" + hashlib.sha1(f"{semente}|{c['nome']}|{c['whatsapp']}".encode()).hexdigest()[:7]
    return c


def estado_vazio():
    return {"versao": 1, "negocios": {}, "contatos_avulsos": []}


# ---------- arquivo ----------

@contextlib.contextmanager
def trava():
    os.makedirs(os.path.dirname(DADOS), exist_ok=True)
    with open(DADOS + ".lock", "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def carregar():
    if not os.path.exists(DADOS):
        return estado_vazio()
    with open(DADOS, encoding="utf-8") as f:
        d = json.load(f)
    d.setdefault("versao", 1)
    d.setdefault("negocios", {})
    d.setdefault("contatos_avulsos", [])
    for n in d["negocios"].values():
        normalizar(n)
    for i, c in enumerate(d["contatos_avulsos"]):
        _norm_contato(c, f"avulso|{i}")
    return d


def _backup():
    if not os.path.exists(DADOS):
        return
    pasta = os.path.join(os.path.dirname(DADOS), "backups")
    os.makedirs(pasta, exist_ok=True)
    nome = "crm-" + dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".json"
    shutil.copy2(DADOS, os.path.join(pasta, nome))
    todos = sorted(x for x in os.listdir(pasta) if x.startswith("crm-") and x.endswith(".json"))
    for velho in todos[:-MAX_BACKUPS]:
        os.remove(os.path.join(pasta, velho))


def gravar(d):
    _backup()
    tmp = DADOS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, DADOS)


def versao_arquivo():
    try:
        st = os.stat(DADOS)
        return f"{st.st_mtime_ns}-{st.st_size}"
    except FileNotFoundError:
        return "0"


@contextlib.contextmanager
def editando():
    """Leitura-modificação-escrita sob trava. Uso: with editando() as d: ..."""
    with trava():
        d = carregar()
        yield d
        sincronizar(d)
        gravar(d)


def pegar(d, slug):
    n = d["negocios"].get(slug)
    if not n:
        raise ErroCRM(f"negócio não existe: {slug}")
    return n


def tocar(n):
    n["atualizado_em"] = agora()


def evento(n, texto, quando=None, envio=False):
    e = {"quando": norm_quando(quando) if quando else agora(), "texto": texto}
    if envio:
        e["envio"] = True  # eu (operador) mandei algo nesse momento (a bola passa pra eles)
    n["eventos"].append(e)
    n["eventos"].sort(key=lambda e: e["quando"])


def resumo_acessos(n):
    """Aberturas reais da prévia: {n, visitantes, ultimo (AAAA-MM-DD HH:MM:SS), gerada (miniatura do WhatsApp)}."""
    ac = n.get("acessos") or []
    ab = [a for a in ac if a.get("t") == "abriu"]
    return {"n": len(ab), "visitantes": len({a.get("v") for a in ab}), "ultimo": max((a["q"] for a in ab), default=""),
            "gerada": sum(1 for a in ac if a.get("t") == "previa_gerada")}


def op_acessos(d, slug, regs):
    """Funde acessos lidos do log de acesso da prévia (idempotente; chamada por um script seu, ex.: lendo o log do servidor web). Mesmo visitante+tipo a menos de 5 min do anterior = mesma abertura.
    Cada abertura nova vira um evento 'Abriu a prévia'. Devolve {novos, total_abriu, ultimo}."""
    n = pegar(d, slug)
    ac = n.setdefault("acessos", [])
    tem = {(a["q"], a["t"], a["v"]) for a in ac}
    novos = []
    for r in sorted(regs, key=lambda r: r["q"]):
        if (r["q"], r["t"], r["v"]) in tem:
            continue
        t = dt.datetime.strptime(r["q"], "%Y-%m-%d %H:%M:%S")
        if any(a["t"] == r["t"] and a["v"] == r["v"] and abs((dt.datetime.strptime(a["q"], "%Y-%m-%d %H:%M:%S") - t).total_seconds()) < 300
               for a in ac):
            continue
        reg = {k: r[k] for k in ("q", "t", "d", "v")}
        ac.append(reg); novos.append(reg); tem.add((r["q"], r["t"], r["v"]))
        if r["t"] == "abriu":
            evento(n, f"Abriu a prévia ({r['d']})", quando=r["q"][:16])
    ac.sort(key=lambda a: a["q"])
    if novos:
        tocar(n)
    rs = resumo_acessos(n)
    return {"novos": novos, "total_abriu": rs["n"], "ultimo": rs["ultimo"]}


# ---------- operações (usadas pela CLI e pelo servidor) ----------

def op_add(d, slug, **campos):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug or ""):
        raise ErroCRM("slug inválido (use minúsculas, números e hífen)")
    if slug in d["negocios"]:
        raise ErroCRM(f"já existe: {slug}")
    n = negocio_vazio(slug)
    contato = campos.pop("contato", None)
    papel = campos.pop("papel", None) or "dono"
    whatsapp = campos.pop("whatsapp", None)
    tags = campos.pop("tags", None)
    for k, v in campos.items():
        if v not in (None, ""):
            n[k] = v
    if n["etapa"] not in ETAPA_IDS:
        raise ErroCRM(f"etapa inválida: {n['etapa']} ({', '.join(ETAPA_IDS)})")
    if tags:
        n["tags"] = [t.strip() for t in tags.split(",") if t.strip()] if isinstance(tags, str) else list(tags)
    if contato or whatsapp:
        n["contatos"].append(_novo_contato(contato or "", whatsapp, papel))
    evento(n, f"Criado em {ETAPA_NOME[n['etapa']]}")
    d["negocios"][slug] = n
    return n


def so_digitos(s):
    return re.sub(r"\D", "", s or "")


def _converter(caminho, valor):
    if caminho == "proposta.valor":
        if valor in (None, ""):
            return None
        v = str(valor).replace("R$", "").replace(" ", "")
        if "," in v:
            v = v.replace(".", "").replace(",", ".")
        try:
            f = float(v)
        except ValueError:
            raise ErroCRM(f"valor inválido: {valor!r}")
        return int(f) if f.is_integer() else f
    if caminho == "previa.publicada":
        return valor if isinstance(valor, bool) else str(valor).lower() in ("1", "true", "sim", "s", "yes")
    if caminho == "tags":
        return valor if isinstance(valor, list) else [t.strip() for t in str(valor).split(",") if t.strip()]
    if caminho.startswith("textos."):
        return str(valor or "").strip()
    if caminho in ("proximo_em", "proposta.enviada_em"):
        return norm_data(valor) if valor else ""
    if caminho == "contatos":
        if not isinstance(valor, list):
            raise ErroCRM("contatos precisa ser lista")
        return [_norm_contato({"id": c.get("id", ""), "nome": c.get("nome", ""), "papel": c.get("papel", ""),
                               "whatsapp": so_digitos(c.get("whatsapp", "")), "fonte": c.get("fonte", ""),
                               "nota": c.get("nota", "")}, os.urandom(4).hex()) for c in valor]
    return "" if valor is None else valor


EDITAVEIS = {
    "nome", "cidade", "nicho", "instagram", "proximo_passo", "proximo_em", "motivo_perda", "tags", "contatos",
    "previa.url", "previa.appId", "previa.publicada", "previa.og",
    "proposta.valor", "proposta.forma", "proposta.pdf", "proposta.enviada_em",
    "textos.m1", "textos.m2", "textos.m2a", "textos.m3", "textos.fu",
}


def op_set(d, slug, caminho, valor):
    n = pegar(d, slug)
    if caminho == "etapa":
        return op_move(d, slug, valor)
    if caminho not in EDITAVEIS:
        raise ErroCRM(f"campo não editável: {caminho} (use: {', '.join(sorted(EDITAVEIS))})")
    v = _converter(caminho, valor)
    alvo = n
    partes = caminho.split(".")
    for p in partes[:-1]:
        alvo = alvo[p]
    antes = alvo.get(partes[-1])
    alvo[partes[-1]] = v
    if caminho == "proposta.valor" and antes != v and v is not None:
        evento(n, f"Proposta: R$ {formatar_valor(v)}")
    tocar(n)
    return n


def op_move(d, slug, etapa, motivo=None, em=None):
    n = pegar(d, slug)
    if etapa not in ETAPA_IDS:
        raise ErroCRM(f"etapa inválida: {etapa} ({', '.join(ETAPA_IDS)})")
    if motivo:
        n["motivo_perda"] = motivo
    if em:
        n["proximo_em"] = norm_data(em)
    if n["etapa"] != etapa:
        txt = f"{ETAPA_NOME[n['etapa']]} → {ETAPA_NOME[etapa]}"
        if etapa == "perdido" and n["motivo_perda"]:
            txt += f" ({n['motivo_perda']})"
        if etapa == "retomar" and n["proximo_em"]:
            txt += f" em {n['proximo_em']}"
        n["etapa"] = etapa
        n["etapa_desde"] = agora()
        n["etapa_desde_fonte"] = "movimento"
        n["etapa_seq"] = time.time()  # desempate com segundos: etapa_desde só tem minuto
        evento(n, txt)
    tocar(n)
    return n


def id_msg(de, quando, texto, extra=""):
    return "m" + hashlib.sha1(f"{de}|{quando}|{texto}|{extra}".encode()).hexdigest()[:10]


def op_msg(d, slug, de, quando, texto, anexo="", fonte="manual", forcar=False):
    n = pegar(d, slug)
    if de not in ("eu", "eles"):
        raise ErroCRM("--de precisa ser eu ou eles")
    if fonte not in FONTES:
        raise ErroCRM(f"--fonte precisa ser {'|'.join(FONTES)}")
    texto = (texto or "").strip()
    if not texto and not anexo:
        raise ErroCRM("mensagem vazia")
    q = norm_quando(quando)
    mid = id_msg(de, q, texto, anexo or "")
    if any(m["id"] == mid for m in n["mensagens"]):
        if not forcar:
            return n, None
        mid = id_msg(de, q, texto, f"{anexo}|{len(n['mensagens'])}")
    m = {"id": mid, "de": de, "quando": q, "texto": texto, "anexo": anexo or "", "fonte": fonte}
    n["mensagens"].append(m)
    n["mensagens"].sort(key=lambda x: x["quando"])
    tocar(n)
    return n, m


def op_msg_apagar(d, slug, mid):
    n = pegar(d, slug)
    antes = len(n["mensagens"])
    n["mensagens"] = [m for m in n["mensagens"] if m["id"] != mid]
    if len(n["mensagens"]) == antes:
        raise ErroCRM(f"mensagem não existe: {mid}")
    tocar(n)
    return n


def op_nota(d, slug, texto, quando=None, envio=False):
    n = pegar(d, slug)
    if not (texto or "").strip():
        raise ErroCRM("nota vazia")
    evento(n, texto.strip(), quando, envio)
    tocar(n)
    return n


def op_import(d, dados, so_novos=False):
    lista = dados.get("negocios", dados) if isinstance(dados, dict) else dados
    if isinstance(lista, dict):
        lista = list(lista.values())
    novos = atualizados = 0
    for item in lista:
        slug = item.get("slug")
        if not slug:
            raise ErroCRM("item sem slug no import")
        if slug in d["negocios"] and so_novos:
            continue
        if slug in d["negocios"]:
            atual = d["negocios"][slug]
            msgs = {m["id"]: m for m in atual["mensagens"]}
            for m in item.pop("mensagens", []) or []:
                q = norm_quando(m.get("quando"))
                m = {"id": m.get("id") or id_msg(m["de"], q, m.get("texto", ""), m.get("anexo", "")), "de": m["de"],
                     "quando": q, "texto": m.get("texto", ""), "anexo": m.get("anexo", ""), "fonte": m.get("fonte", "manual")}
                msgs.setdefault(m["id"], m)
            for k, v in item.items():
                if isinstance(v, dict) and isinstance(atual.get(k), dict):
                    atual[k].update(v)
                elif k == "eventos":
                    atual["eventos"].extend(e for e in v if e not in atual["eventos"])
                else:
                    atual[k] = v
            atual["mensagens"] = list(msgs.values())
            normalizar(atual)
            tocar(atual)
            atualizados += 1
        else:
            n = negocio_vazio(slug)
            for k, v in item.items():
                if isinstance(v, dict) and isinstance(n.get(k), dict):
                    n[k].update(v)
                else:
                    n[k] = v
            for m in n["mensagens"]:
                m["quando"] = norm_quando(m.get("quando"))
                m.setdefault("id", id_msg(m["de"], m["quando"], m.get("texto", ""), m.get("anexo", "")))
                m.setdefault("anexo", "")
                m.setdefault("fonte", "manual")
            if "etapa_desde" not in item:  # importado: a hora de agora não é quando entrou na etapa
                n.pop("etapa_desde_fonte", None)
                n["etapa_desde"] = ""
            normalizar(n)
            d["negocios"][slug] = n
            novos += 1
    return novos, atualizados


# ---------- mensagens por fase (roteiro da prévia) + Marcar enviada ----------
# Texto de cada fase vem ao vivo de previas/<slug>/roteiro.md (ou previas/_interno/<slug>/), seção "## Mensagens".
# n["textos"][fase] substitui o do roteiro. Marcar enviada grava a mensagem (lado eu, fonte "marcado") e move o funil
# pra frente (nunca pra trás). Desfazer volta tudo.

FASES = [("m1", "Msg 1", "saudação"), ("m2", "Msg 2", "licença"), ("m2a", "Msg 2 atendente", "se cair em atendente"),
         ("m3", "Msg 3", "link"), ("fu", "Follow-up", "se não respondeu")]
FASE_IDS = [f[0] for f in FASES]
FASE_NOME = {f[0]: f[1] for f in FASES}
FASE_ETAPA = {"m1": "abordado", "m2": "abordado", "m2a": "abordado", "m3": "link"}
FASE_ALIAS = {"1": "m1", "msg1": "m1", "2": "m2", "msg2": "m2", "2a": "m2a", "atendente": "m2a", "msg2a": "m2a",
              "3": "m3", "msg3": "m3", "link": "m3", "followup": "fu", "follow-up": "fu"}
FU_PADRAO = "Oi! Uma dúvida pra deixar do jeito de vocês: o que você quer que apareça primeiro na página, os produtos ou as fotos do espaço?"  # D+1: algo útil/escolha fácil, sem cobrar resposta


def saudacao(t=None):
    t = t or agora_dt()
    return ("Bom dia" if t.hour < 12 else "Boa tarde") + ", tudo bem?"


def _so_citacao(linhas):
    """Mesma regra de ferramentas/gerar-disparo.py: subtítulo encerra, só as linhas com '>' quando houver,
    sem nota interna ('Se não abrir...', linha entre parênteses)."""
    corte = next((i for i, l in enumerate(linhas) if l.strip().startswith("#")), len(linhas))
    linhas = linhas[:corte]
    cit = [l for l in linhas if l.strip().startswith(">")]
    if cit:
        linhas = cit
    linhas = [l for l in linhas if not l.strip().startswith("#") and not l.strip().lower().startswith("se não abrir")]
    txt = [l.strip()[1:].strip() if l.strip().startswith(">") else l.strip() for l in linhas]
    # '(Junto: "É uma proposta...")' é texto que vai na mesma mensagem, não nota interna
    txt = [re.sub(r'^\(junto:\s*["“](.+?)["”]\)$', r"\1", t, flags=re.I) for t in txt]
    txt = "\n".join(t for t in txt if t and not (t.startswith("(") and t.endswith(")")))
    return txt.strip().strip('"').strip()


def mensagens_roteiro(md):
    """{'m2','m2a','m3','fu'} da seção ## Mensagens (formatos '### 2.', '**Msg 2**', 'Msg 2:')."""
    m = re.search(r"^## Mensagens.*?\n(.*?)(?=^## |\Z)", md, flags=re.S | re.M)
    corpo = m.group(1) if m else ""
    marca = re.compile(r"^(###\s*|\*\*\s*)?(Msg\s*)?([123])\b[^\n]*", re.I)
    blocos, atual = [], None
    for ln in corpo.splitlines():
        mm = marca.match(ln.strip())
        if mm and (ln.startswith("#") or ln.startswith("**") or ln.lower().startswith("msg")):
            atual = [ln.strip(), []]
            blocos.append(atual)
            resto = re.sub(r"^(###\s*|\*\*)?.*?(\*\*|:)\s*", "", ln.strip(), count=1) if (":" in ln or ln.count("**") >= 2) else ""
            if resto and not resto.startswith("("):
                atual[1].append(resto)
        elif atual is not None:
            atual[1].append(ln)
    out = {"m2": "", "m2a": "", "m3": "", "fu": ""}
    for rot, linhas in blocos:
        n = re.search(r"([123])", rot).group(1)
        k = "m2a" if "atendente" in rot.lower() else {"2": "m2", "3": "m3"}.get(n)
        if k and not out[k]:
            out[k] = _so_citacao(linhas)
    f = re.search(r"^(?:###\s*|\*\*\s*)(?:Msg\s*)?follow[^\n]*\n(.*?)(?=^###|^\*\*|^## |\Z)", corpo, flags=re.S | re.M | re.I)
    if f:
        out["fu"] = _so_citacao(f.group(1).splitlines())
    return out


def caminho_roteiro(slug):
    for p in (os.path.join(PREVIAS, slug, "roteiro.md"), os.path.join(PREVIAS, "_interno", slug, "roteiro.md")):
        if os.path.isfile(p):
            return p
    return ""


def versao_roteiros(slugs):
    """Muda quando algum roteiro muda (a página relê os textos)."""
    h = hashlib.sha1()
    for s in sorted(slugs):
        p = caminho_roteiro(s)
        if p:
            st = os.stat(p)
            h.update(f"{s}{st.st_mtime_ns}{st.st_size}".encode())
    return h.hexdigest()[:8]


def textos_fases(n, t=None):
    """{fase: {texto, origem}} origem: roteiro | editado | padrao | "" (sem texto)."""
    p = caminho_roteiro(n["slug"])
    rot = {}
    if p:
        with open(p, encoding="utf-8") as f:
            rot = mensagens_roteiro(f.read())
    url = (n.get("previa") or {}).get("url") or ""
    base = {"m1": (saudacao(t), "padrao"), "m2": (rot.get("m2", ""), "roteiro"), "m2a": (rot.get("m2a", ""), "roteiro"),
            "m3": (rot.get("m3") or url, "roteiro" if rot.get("m3") else "padrao"),
            "fu": (rot.get("fu") or FU_PADRAO, "roteiro" if rot.get("fu") else "padrao")}
    out = {}
    for k in FASE_IDS:
        ov = (n.get("textos") or {}).get(k) or ""
        txt, orig = (ov, "editado") if ov else base[k]
        out[k] = {"texto": txt, "origem": orig if txt else ""}
    return out


def norm_fase(f):
    f = (f or "").strip().lower()
    f = FASE_ALIAS.get(f, f)
    if f not in FASE_IDS:
        raise ErroCRM(f"fase inválida: {f!r} (use {', '.join(FASE_IDS)})")
    return f


def op_enviada(d, slug, fase, quando=None):
    """Marca a fase como enviada: mensagem no histórico, funil pra frente, follow-up resolve a cobrança aberta."""
    n = pegar(d, slug)
    fase = norm_fase(fase)
    if fase in n["envios"]:
        raise ErroCRM(f"{FASE_NOME[fase]} já está marcada como enviada em {n['envios'][fase]['quando']}")
    q = norm_quando(quando) if quando else agora()
    texto = textos_fases(n, dt.datetime.strptime(q, FMT))[fase]["texto"]
    if not texto:
        raise ErroCRM(f"{FASE_NOME[fase]} sem texto no roteiro de {slug}")
    _, m = op_msg(d, slug, "eu", q, texto, fonte="marcado", forcar=True)
    reg = {"quando": q, "msg": m["id"], "etapa_antes": n["etapa"], "etapa_desde_antes": n["etapa_desde"],
           "etapa_desde_fonte_antes": n["etapa_desde_fonte"], "etapa_seq_antes": n.get("etapa_seq", 0),
           "moveu": False, "cobranca": ""}
    alvo = FASE_ETAPA.get(fase)
    if alvo and n["etapa"] in ETAPA_IDS[:ETAPA_IDS.index(alvo)]:
        op_move(d, slug, alvo)
        reg["moveu"] = True
        reg["evento"] = n["eventos"][-1] if n["eventos"] else None
        if reg["evento"] and not reg["evento"]["texto"].endswith(ETAPA_NOME[alvo]):
            reg["evento"] = next((e for e in reversed(n["eventos"]) if e["texto"].endswith(ETAPA_NOME[alvo])), None)
    if fase == "fu":
        abertas = [c for c in n["cobrancas"] if not c["feita"]]
        if abertas:
            c = min(abertas, key=lambda c: c["quando"])
            op_feita(d, slug, c["id"])
            reg["cobranca"] = c["id"]
            reg["evento_cob"] = next((e for e in reversed(n["eventos"]) if e["texto"] == f"Cobrança feita: {c['motivo']}"), None)
    n["envios"][fase] = reg
    tocar(n)
    return n, reg


def op_desfazer_envio(d, slug, fase):
    n = pegar(d, slug)
    fase = norm_fase(fase)
    reg = n["envios"].pop(fase, None)
    if not reg:
        raise ErroCRM(f"{FASE_NOME[fase]} não está marcada em {slug}")
    n["mensagens"] = [m for m in n["mensagens"] if m["id"] != reg.get("msg")]
    if reg.get("moveu") and n["etapa"] == FASE_ETAPA.get(fase):
        n["etapa"] = reg["etapa_antes"]
        n["etapa_desde"] = reg["etapa_desde_antes"]
        n["etapa_desde_fonte"] = reg["etapa_desde_fonte_antes"]
        n["etapa_seq"] = reg.get("etapa_seq_antes", 0)
        ev = reg.get("evento")
        if ev in n["eventos"]:
            n["eventos"].remove(ev)
    if reg.get("cobranca"):
        for c in n["cobrancas"]:
            if c["id"] == reg["cobranca"] and c["feita"]:
                c["feita"], c["feita_em"] = False, ""
                c.pop("resolvida", None)
        if reg.get("evento_cob") in n["eventos"]:
            n["eventos"].remove(reg["evento_cob"])
    # cobrança automática nascida deste envio (base = quando dele) e que deixou de valer some junto,
    # sem virar "feita" fantasma; a que o envio tinha resolvido e volta a valer reabre
    valem = {(r["regra"], r["base"]) for r in regras_auto(n)}
    n["cobrancas"] = [c for c in n["cobrancas"]
                      if not (c.get("auto") and c.get("base") == reg["quando"] and (c.get("regra"), c.get("base")) not in valem)]
    for c in n["cobrancas"]:
        if (c.get("auto") and c["feita"] and c.get("resolvida") in ("mensagem nova", "não vale mais")
                and c.get("feita_em", "") >= reg["quando"] and (c.get("regra"), c.get("base")) in valem):
            c["feita"], c["feita_em"] = False, ""
            c.pop("resolvida", None)
    tocar(n)
    return n


def fila_envio(d):
    """Quem falta prospectar: Prévia pronta e Msg 1 não marcada. Prévia publicada primeiro, depois a mais nova."""
    ns = [n for n in d["negocios"].values() if n["etapa"] == "previa" and "m1" not in n["envios"] and tem_whatsapp(n)]
    ns.sort(key=lambda n: n["criado_em"], reverse=True)
    ns.sort(key=lambda n: not n["previa"].get("publicada"))
    return ns


def tem_whatsapp(n):
    return any(so_digitos(c.get("whatsapp")) for c in n.get("contatos", []))


def fila_sem_numero(d):
    """Na vez da Msg 1, mas sem WhatsApp: fora da fila e da contagem, só avisados numa linha."""
    return [n for n in d["negocios"].values() if n["etapa"] == "previa" and "m1" not in n["envios"] and not tem_whatsapp(n)]


def fila_msg2(d):
    """Já receberam a Msg 1 marcada e ainda não a Msg 2 (nem a versão atendente). Mais novo enviado primeiro."""
    ns = [n for n in d["negocios"].values() if "m1" in n["envios"] and not ({"m2", "m2a"} & set(n["envios"]))
          and n["etapa"] in ("previa", "abordado", "respondeu")]
    return sorted(ns, key=lambda n: n["envios"]["m1"]["quando"], reverse=True)  # mais novo enviado primeiro


# ---------- contatos (pessoas) ----------
# Ficam dentro do negócio (n["contatos"]) ou, sem negócio, em d["contatos_avulsos"]. Cada um tem id estável.

CAMPOS_CONTATO = ("nome", "papel", "whatsapp", "nota", "negocio")


def _novo_contato(nome, whatsapp="", papel="", nota="", fonte="manual"):
    return {"id": "k" + os.urandom(4).hex()[:7], "nome": (nome or "").strip(), "papel": papel or "",
            "whatsapp": so_digitos(whatsapp), "nota": (nota or "").strip(), "fonte": fonte or "manual"}


def todos_contatos(d):
    """Lista plana: cada contato com 'negocio' (slug ou "") e 'negocio_nome'."""
    out = []
    for n in d["negocios"].values():
        for c in n["contatos"]:
            out.append({**c, "negocio": n["slug"], "negocio_nome": n["nome"], "etapa": n["etapa"]})
    for c in d["contatos_avulsos"]:
        out.append({**c, "negocio": "", "negocio_nome": "", "etapa": ""})
    return sorted(out, key=lambda c: (c["nome"] or "~").lower())


def _achar_contato(d, cid):
    for n in d["negocios"].values():
        for c in n["contatos"]:
            if c["id"] == cid:
                return c, n["contatos"], n
    for c in d["contatos_avulsos"]:
        if c["id"] == cid:
            return c, d["contatos_avulsos"], None
    raise ErroCRM(f"contato não existe: {cid}")


def op_contato_novo(d, nome, whatsapp="", negocio="", papel="", nota="", fonte="manual", exigir_whatsapp=True):
    if not (nome or "").strip():
        raise ErroCRM("informe o nome")
    if exigir_whatsapp and not so_digitos(whatsapp):
        raise ErroCRM("informe o WhatsApp")
    c = _novo_contato(nome, whatsapp, papel, nota, fonte)
    if negocio:
        n = pegar(d, negocio)
        n["contatos"].append(c)
        tocar(n)
    else:
        d["contatos_avulsos"].append(c)
    return c


def op_contato_editar(d, cid, campos):
    c, lista, n = _achar_contato(d, cid)
    for k, v in (campos or {}).items():
        if k not in CAMPOS_CONTATO:
            raise ErroCRM(f"campo de contato não editável: {k} (use: {', '.join(CAMPOS_CONTATO)})")
        if k == "negocio":
            destino = pegar(d, v)["contatos"] if v else d["contatos_avulsos"]
            if destino is not lista:
                lista.remove(c)
                destino.append(c)
                if v:
                    tocar(pegar(d, v))
                lista = destino
        elif k == "whatsapp":
            c[k] = so_digitos(v)
        else:
            c[k] = (v or "").strip()
    if not c["nome"]:
        raise ErroCRM("contato sem nome")
    if n:
        tocar(n)
    return c


def op_contato_apagar(d, cid):
    c, lista, n = _achar_contato(d, cid)
    lista.remove(c)
    if n:
        tocar(n)


# ---------- cobrança / follow-up ----------
# Regra: nada de mensagem depois das 18h nem domingo. Cobrança marcada fora disso vai pro próximo dia às 10:00.

SEM_ACAO = ("ganho", "perdido", "retomar")
FMT = "%Y-%m-%d %H:%M"


def ajustar_horario(t):
    """Devolve (datetime, empurrou). Depois das 18:00 ou domingo -> próximo dia 10:00; antes das 08:00 -> 10:00."""
    orig = t
    for _ in range(10):
        if t.weekday() == 6 or (t.hour, t.minute) > (18, 0):
            t = (t + dt.timedelta(days=1)).replace(hour=10, minute=0)
        elif t.hour < 8:
            t = t.replace(hour=10, minute=0)
        else:
            break
    return t, t != orig


def ler_quando_cobranca(s):
    """'2026-10-20 09:00', '20/10 9:00', '2026-10-20' ou '20/10' (09:00), 'amanha' ou '+3' (10:00)."""
    s = (s or "").strip()
    if not s:
        raise ErroCRM("informe --em (ex.: '2026-10-20 09:00', '20/10', 'amanha', '+3')")
    base = agora_dt()
    sl = s.lower()
    m = re.fullmatch(r"\+(\d{1,3})\s*d?", sl)
    if sl in ("amanha", "amanhã") or m:
        t = (base + dt.timedelta(days=int(m.group(1)) if m else 1)).replace(hour=10, minute=0)
    elif re.fullmatch(r"\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}(/\d{4})?", s):
        t = dt.datetime.strptime(norm_data(s), "%Y-%m-%d").replace(hour=9)
    else:
        t = dt.datetime.strptime(norm_quando(s), FMT)
    return ajustar_horario(t)


def pegar_cobranca(n, cid=None):
    if cid:
        for c in n["cobrancas"]:
            if c["id"] == cid:
                return c
        raise ErroCRM(f"cobrança não existe: {cid} ({', '.join(c['id'] for c in n['cobrancas']) or 'nenhuma'})")
    abertas = [c for c in n["cobrancas"] if not c["feita"]]
    if not abertas:
        raise ErroCRM(f"{n['slug']} não tem cobrança aberta")
    return min(abertas, key=lambda c: c["quando"])


def _nova_cobranca(n, quando, motivo, texto="", auto=False, **extra):
    i = 1
    ids = {c["id"] for c in n["cobrancas"]}
    while f"c{i}" in ids:
        i += 1
    c = {"id": extra.pop("id", None) or f"c{i}", "quando": quando, "motivo": motivo, "texto_sugerido": texto, "feita": False,
         "feita_em": "", "auto": auto, "criada_em": agora(), "notificada_em": ""}
    c.update(extra)
    n["cobrancas"].append(c)
    n["cobrancas"].sort(key=lambda x: x["quando"])
    return c


def op_cobrar(d, slug, quando, motivo, texto=""):
    n = pegar(d, slug)
    if not (motivo or "").strip():
        raise ErroCRM("informe --motivo")
    t, empurrou = ler_quando_cobranca(quando)
    c = _nova_cobranca(n, t.strftime(FMT), motivo.strip(), (texto or "").strip())
    tocar(n)
    return c, empurrou


def op_feita(d, slug, cid=None):
    n = pegar(d, slug)
    c = pegar_cobranca(n, cid)
    c["feita"], c["feita_em"] = True, agora()
    evento(n, f"Cobrança feita: {c['motivo']}")
    tocar(n)
    return c


def op_adiar(d, slug, cid, quando):
    n = pegar(d, slug)
    c = pegar_cobranca(n, cid)
    t, empurrou = ler_quando_cobranca(quando)
    c["quando"], c["feita"], c["feita_em"], c["notificada_em"] = t.strftime(FMT), False, "", ""
    n["cobrancas"].sort(key=lambda x: x["quando"])
    tocar(n)
    return c, empurrou


def op_cobranca_editar(d, slug, cid, campos):
    n = pegar(d, slug)
    c = pegar_cobranca(n, cid)
    empurrou = False
    for k, v in (campos or {}).items():
        if k == "quando":
            t, empurrou = ler_quando_cobranca(v)
            c["quando"], c["notificada_em"] = t.strftime(FMT), ""
        elif k in ("motivo", "texto_sugerido"):
            c[k] = (v or "").strip()
        else:
            raise ErroCRM(f"campo de cobrança não editável: {k}")
    n["cobrancas"].sort(key=lambda x: x["quando"])
    tocar(n)
    return c, empurrou


def op_cobranca_apagar(d, slug, cid):
    n = pegar(d, slug)
    pegar_cobranca(n, cid)
    n["cobrancas"] = [c for c in n["cobrancas"] if c["id"] != cid]
    tocar(n)


# Linha do tempo igual à da página: mensagens + envios meus registrados no log (eventos).
def eh_envio(e):
    t = e.get("texto", "")
    return e.get("envio") is True or bool(re.search(r"\benviad[oa]s?\b", t, re.I) and not re.search(r"não confirmado", t, re.I)
                                           and not re.match(r"(Criado em|Proposta:|Cobrança)", t))


def linha_do_tempo(n):
    itens = [(m["quando"], 0, m["de"], m.get("texto", "")) for m in n["mensagens"]]
    itens += [(e["quando"], 1, "eu", e["texto"]) for e in n["eventos"] if eh_envio(e)]
    return sorted(itens)


def aguarda_meu(n):
    lt = linha_do_tempo(n)
    return bool(lt) and lt[-1][2] == "eles" and n["etapa"] not in SEM_ACAO


def _dia(q, dias, hora=10):
    t = dt.datetime.strptime(q[:10], "%Y-%m-%d") + dt.timedelta(days=dias)
    return ajustar_horario(t.replace(hour=hora))[0].strftime(FMT)


def regras_auto(n):
    """Sugestões automáticas que valem AGORA pro negócio. Chave (regra, base) não se repete."""
    lt = linha_do_tempo(n)
    ult = lt[-1] if lt else None
    meu = ult and ult[2] == "eu"
    envios_meus = sum(1 for x in lt if x[2] == "eu")
    ddmm = lambda q: f"{q[8:10]}/{q[5:7]}"
    out = []
    if n["etapa"] == "abordado" and meu and envios_meus >= 2:
        out.append({"regra": "msg2", "base": ult[0], "quando": _dia(ult[0], 2),
                    "motivo": f"Msg 2 sem resposta desde {ddmm(ult[0])}", "texto": ""})
    elif n["etapa"] == "link" and meu:
        out.append({"regra": "link", "base": ult[0], "quando": _dia(ult[0], 1),
                    "motivo": f"Link enviado {ddmm(ult[0])}, sem resposta (D+1)",
                    "texto": FU_PADRAO})
    elif n["etapa"] == "proposta" and meu:
        out.append({"regra": "proposta", "base": ult[0], "quando": _dia(ult[0], 3),
                    "motivo": f"Proposta enviada {ddmm(ult[0])}, sem resposta",
                    "texto": "Oi, tudo bem? Conseguiu ver a proposta? Qualquer dúvida me chama."})
    elif n["etapa"] == "retomar" and n["proximo_em"]:
        out.append({"regra": "retomar", "base": n["proximo_em"], "quando": _dia(n["proximo_em"], 0, 9),
                    "motivo": n["proximo_passo"] or "Retomar (data combinada)", "texto": ""})
    return out


def sincronizar(d):
    """Cria as sugestões automáticas que faltam e resolve as que deixaram de valer. Devolve True se mudou algo."""
    mudou = False
    for n in d["negocios"].values():
        valem = {(r["regra"], r["base"]): r for r in regras_auto(n)}
        manual_aberta = any(not c["feita"] and not c["auto"] for c in n["cobrancas"])
        lt = linha_do_tempo(n)
        for c in n["cobrancas"]:
            if c["auto"] and not c["feita"] and (manual_aberta or (c.get("regra"), c.get("base")) not in valem):
                novo = lt and lt[-1][0] > c.get("base", "")
                c["feita"], c["feita_em"] = True, agora()
                c["resolvida"] = "cobrança manual" if manual_aberta else "mensagem nova" if novo else "não vale mais"
                mudou = True
        if manual_aberta:
            continue
        ja = {(c.get("regra"), c.get("base")) for c in n["cobrancas"] if c["auto"]}
        for k, r in valem.items():
            if k in ja:
                continue
            cid = "a" + hashlib.sha1(f"{n['slug']}|{k[0]}|{k[1]}".encode()).hexdigest()[:6]
            _nova_cobranca(n, r["quando"], r["motivo"], r["texto"], True, id=cid, regra=r["regra"], base=r["base"])
            mudou = True
    return mudou


def cobrancas_devidas(d, ate=None):
    """[(negócio, cobrança)] abertas com data <= hoje (vencidas e de hoje), mais antiga primeiro."""
    hoje = (ate or agora_dt()).strftime("%Y-%m-%d")
    out = [(n, c) for n in d["negocios"].values() for c in n["cobrancas"] if not c["feita"] and c["quando"][:10] <= hoje]
    return sorted(out, key=lambda x: x[1]["quando"])


def _idade(q, agora_t):
    m = int((agora_t - dt.datetime.strptime(q[:16], FMT)).total_seconds() // 60)
    if m < 0:
        return f"às {q[11:16]}"
    if m < 60:
        return f"há {max(m, 1)} min"
    if m < 1440:
        return f"há {m // 60} h"
    return f"há {m // 1440} d"


def itens_hoje(d):
    """Lista curta em ordem de prioridade: responder >24h, cobranças vencidas, responder, cobranças de hoje, prazos."""
    t = agora_dt()
    hoje = t.strftime("%Y-%m-%d")
    itens = []
    devidas = cobrancas_devidas(d, t)
    com_cobranca = {n["slug"] for n, _ in devidas}
    for n in d["negocios"].values():
        if aguarda_meu(n):
            q, _, _, txt = linha_do_tempo(n)[-1]
            velho = (t - dt.datetime.strptime(q, FMT)).total_seconds() > 86400
            txt = " ".join(txt.split())
            itens.append((0 if velho else 2, q, "responder", n, f"{_idade(q, t)} · \"{txt[:50]}\""))
        elif (n["proximo_em"] and n["proximo_em"] <= hoje and n["etapa"] not in ("ganho", "perdido")
              and n["slug"] not in com_cobranca):
            rot = "hoje" if n["proximo_em"] == hoje else f"atrasado {n['proximo_em'][8:]}/{n['proximo_em'][5:7]}"
            itens.append((4, n["proximo_em"], "prazo", n, f"{rot} · {n['proximo_passo'][:50]}"))
    for n, c in devidas:
        venc = c["quando"][:10] < hoje
        rot = f"vencida {c['quando'][8:10]}/{c['quando'][5:7]}" if venc else f"hoje {c['quando'][11:16]}"
        itens.append((1 if venc else 3, c["quando"], f"cobrar {c['id']}", n, f"{rot} · {c['motivo'][:60]}"))
    return sorted(itens, key=lambda x: (x[0], x[1]))


def op_rm(d, slug):
    pegar(d, slug)
    del d["negocios"][slug]


# ---------- saída ----------

def formatar_valor(v):
    if v is None:
        return "-"
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return s[:-3] if s.endswith(",00") else s


def linha(n):
    ult = n["mensagens"][-1] if n["mensagens"] else None
    u = f"{ult['de']} {ult['quando'][5:]}" if ult else "sem msg"
    prox = f" | prox: {n['proximo_passo'][:40]}" + (f" ({n['proximo_em']})" if n["proximo_em"] else "") if n["proximo_passo"] or n["proximo_em"] else ""
    val = f" | R$ {formatar_valor(n['proposta']['valor'])}" if n["proposta"]["valor"] is not None else ""
    return f"{n['slug']:<28} {n['cidade'][:14]:<14} ult: {u}{val}{prox}"


def mostrar(n, nmsgs=10):
    p, pr = n["previa"], n["proposta"]
    out = [f"{n['nome']} [{n['slug']}] {ETAPA_NOME[n['etapa']]}",
           f"  {n['cidade']} | {n['nicho']} | IG {n['instagram'] or '-'} | tags {','.join(n['tags']) or '-'}"]
    for c in n["contatos"]:
        out.append(f"  contato: {c['nome']} ({c['papel']}) {c['whatsapp']} [{c['id']}]" + (f" {c['nota']}" if c.get("nota") else ""))
    if p["url"] or p["appId"]:
        out.append(f"  prévia: {p['url']} app={p['appId'] or '-'} pub={'sim' if p['publicada'] else 'não'}")
    ra = resumo_acessos(n)
    if ra["n"] or ra["gerada"]:
        out.append(f"  acessos: abriu {ra['n']}x ({ra['visitantes']} visitante(s)), último {ra['ultimo'][5:16] or '-'}; miniatura do WhatsApp {ra['gerada']}x")
    if pr["valor"] is not None or pr["forma"]:
        out.append(f"  proposta: R$ {formatar_valor(pr['valor'])} {pr['forma']} enviada {pr['enviada_em'] or '-'}")
    if n["proximo_passo"] or n["proximo_em"]:
        out.append(f"  próximo: {n['proximo_passo']} {n['proximo_em']}")
    if n["motivo_perda"]:
        out.append(f"  motivo: {n['motivo_perda']}")
    msgs = n["mensagens"][-nmsgs:] if nmsgs else []
    if msgs:
        out.append(f"  msgs ({len(n['mensagens'])}, últimas {len(msgs)}):")
        for m in msgs:
            t = m["texto"].replace("\n", " ")
            t = t if len(t) <= 90 else t[:87] + "..."
            anx = f" [{m['anexo']}]" if m["anexo"] else ""
            out.append(f"    {m['quando'][5:]} {m['de']:<4} {t}{anx}")
    for c in n["cobrancas"]:
        if not c["feita"]:
            out.append(f"  cobrar {c['id']}: {c['quando'][8:10]}/{c['quando'][5:7]} {c['quando'][11:16]} {c['motivo']}" + (" (auto)" if c["auto"] else ""))
    if n["eventos"]:
        e = n["eventos"][-1]
        out.append(f"  último evento: {e['quando'][5:]} {e['texto']}")
    aprox = "" if n.get("etapa_desde_fonte") in ("movimento", "criacao") else " (estimado pelo histórico)"
    out.append(f"  na etapa desde {n['etapa_desde']}{aprox}")
    return "\n".join(out)


# ---------- CLI ----------

def main(argv=None):
    ap = argparse.ArgumentParser(prog="crm.py", description="Mini CRM de leads")
    sp = ap.add_subparsers(dest="cmd", required=True)

    a = sp.add_parser("add")
    a.add_argument("slug")
    for c in ("nome", "cidade", "nicho", "etapa", "instagram", "whatsapp", "contato", "papel", "tags", "proximo_passo"):
        a.add_argument("--" + c.replace("_", "-"), dest=c)
    a.add_argument("--from-json", dest="from_json", help="arquivo JSON com os campos (nome, cidade, nicho, instagram, whatsapp, tags, etapa, nota opcional); texto de terceiros fora do shell")

    s = sp.add_parser("set")
    s.add_argument("slug"); s.add_argument("campo"); s.add_argument("valor", nargs="?", default="")
    s.add_argument("--from-file", dest="from_file", help="lê o valor de um arquivo de texto (UTF-8), em vez de argumento")

    c = sp.add_parser("contato")
    c.add_argument("slug"); c.add_argument("--nome", required=True)
    c.add_argument("--papel", default="dono"); c.add_argument("--whatsapp", default=""); c.add_argument("--fonte", default="manual")

    cn = sp.add_parser("contato-novo", help="cadastra uma pessoa (com ou sem negócio)")
    cn.add_argument("--nome", required=True); cn.add_argument("--whatsapp", required=True)
    cn.add_argument("--negocio", default=""); cn.add_argument("--papel", default="")
    cn.add_argument("--nota", default=""); cn.add_argument("--fonte", default="manual")

    cl = sp.add_parser("contatos", help="lista os contatos")
    cl.add_argument("--busca", default="")

    cs = sp.add_parser("contato-set")
    cs.add_argument("id"); cs.add_argument("campo", choices=CAMPOS_CONTATO); cs.add_argument("valor", nargs="?", default="")

    m = sp.add_parser("move")
    m.add_argument("slug"); m.add_argument("etapa", choices=ETAPA_IDS)
    m.add_argument("--motivo"); m.add_argument("--em")

    g = sp.add_parser("msg")
    g.add_argument("slug"); g.add_argument("--de", required=True, choices=("eu", "eles"))
    g.add_argument("--quando", required=True); g.add_argument("--texto", default="")
    g.add_argument("--anexo", default=""); g.add_argument("--fonte", default="manual", choices=FONTES)
    g.add_argument("--forcar", action="store_true", help="grava mesmo se idêntica a uma existente")

    nt = sp.add_parser("nota")
    nt.add_argument("slug"); nt.add_argument("texto"); nt.add_argument("--quando")
    nt.add_argument("--envio", action="store_true", help="a nota registra um envio meu (passa a bola pra eles)")

    sh = sp.add_parser("show")
    sh.add_argument("slug"); sh.add_argument("--msgs", type=int, default=10)

    ls = sp.add_parser("list")
    ls.add_argument("--etapa", choices=ETAPA_IDS)

    im = sp.add_parser("import-json")
    im.add_argument("arquivo")
    im.add_argument("--so-novos", action="store_true", help="ignora slug que já existe (não sobrescreve nada)")

    en = sp.add_parser("enviada", help="marca uma fase de mensagem como enviada (move o funil)")
    en.add_argument("slug"); en.add_argument("fase", help="m1 m2 m2a m3 fu")
    en.add_argument("--quando"); en.add_argument("--desfazer", action="store_true")

    sp.add_parser("fila", help="fila de envio: Msg 1 a mandar e Msg 2 a mandar")

    tx = sp.add_parser("textos", help="textos das fases do negócio")
    tx.add_argument("slug")

    rm = sp.add_parser("rm")
    rm.add_argument("slug")

    cb = sp.add_parser("cobrar", help="lembrete de cobrança/follow-up")
    cb.add_argument("slug"); cb.add_argument("--em", required=True); cb.add_argument("--motivo", required=True)
    cb.add_argument("--texto", default="", help="mensagem sugerida pra mandar")

    ft = sp.add_parser("feita")
    ft.add_argument("slug"); ft.add_argument("id", nargs="?")

    ad = sp.add_parser("adiar")
    ad.add_argument("slug"); ad.add_argument("id"); ad.add_argument("--em", required=True)

    sp.add_parser("hoje", help="o que fazer hoje, em ordem de prioridade")

    args = ap.parse_args(argv)
    try:
        if args.cmd == "hoje":
            with trava():
                d = carregar()
                if sincronizar(d):
                    gravar(d)
            t = agora_dt()
            itens = itens_hoje(d)
            sem = ("seg", "ter", "qua", "qui", "sex", "sáb", "dom")[t.weekday()]
            print(f"hoje {t:%d/%m} ({sem}) · {len(itens) or 'nada'}" + (" pra fazer" if itens else " pra fazer"))
            for _, _, tipo, n, txt in itens:
                print(f"  {tipo:<14} {n['slug']:<22} {txt}")
            return 0
        if args.cmd in ("show", "list", "contatos", "fila", "textos"):
            d = carregar()
            if args.cmd == "fila":
                f1, f2 = fila_envio(d), fila_msg2(d)
                print(f"Msg 1 a mandar ({len(f1)})")
                for i, n in enumerate(f1, 1):
                    ct = next((c["whatsapp"] for c in n["contatos"] if c["whatsapp"]), "") or "sem WhatsApp"
                    pub = "" if n["previa"].get("publicada") else " (prévia não publicada)"
                    print(f"  {i:>2}. {n['slug']:<22} {n['cidade'][:12]:<12} {n['nicho'][:20]:<20} {ct}{pub}")
                print(f"Msg 2 a mandar ({len(f2)})")
                for n in f2:
                    print(f"      {n['slug']:<22} Msg 1 em {n['envios']['m1']['quando'][5:]}")
                return 0
            if args.cmd == "textos":
                n = pegar(d, args.slug)
                for k, t in textos_fases(n).items():
                    env = n["envios"].get(k)
                    print(f"[{k}] {FASE_NOME[k]} ({t['origem'] or 'sem texto'})" + (f" enviada {env['quando']}" if env else ""))
                    print("    " + (t["texto"] or "-").replace("\n", "\n    "))
                return 0
            if args.cmd == "contatos":
                termos = args.busca.lower().split()
                cs = [c for c in todos_contatos(d)
                      if all(t in " ".join((c["nome"], c["papel"], c["whatsapp"], c["negocio"], c["nota"])).lower() for t in termos)]
                for c in cs:
                    print(f"  {c['id']:<9} {c['nome'][:24]:<24} {c['papel'][:10]:<10} {c['whatsapp']:<14} {c['negocio'] or '(avulso)'}"
                          + (f" · {c['nota'][:40]}" if c["nota"] else ""))
                print(f"{len(cs)} contato(s)")
                return 0
            if args.cmd == "show":
                print(mostrar(pegar(d, args.slug), args.msgs))
            else:
                for eid, nome in ETAPAS:
                    if args.etapa and eid != args.etapa:
                        continue
                    ns = sorted((n for n in d["negocios"].values() if n["etapa"] == eid),
                                key=lambda n: (n["etapa_desde"], n.get("etapa_seq", 0), n["atualizado_em"]), reverse=True)  # mais novo na etapa primeiro
                    if not ns and not args.etapa:
                        continue
                    tot = sum(n["proposta"]["valor"] or 0 for n in ns)
                    print(f"== {nome} ({len(ns)})" + (f" R$ {formatar_valor(tot)}" if tot else ""))
                    for n in ns:
                        print("  " + linha(n))
                if not d["negocios"]:
                    print("vazio")
            return 0
        with editando() as d:
            if args.cmd == "add":
                campos = {k: getattr(args, k) for k in ("nome", "cidade", "nicho", "etapa", "instagram", "whatsapp",
                                                         "contato", "papel", "tags", "proximo_passo")}
                nota_json = None
                if args.from_json:
                    js = json.load(open(args.from_json, encoding="utf-8"))
                    if not isinstance(js, dict):
                        raise ErroCRM("--from-json: esperado um objeto JSON")
                    for k in campos:
                        if k in js and js[k] not in (None, ""):
                            v = js[k]
                            campos[k] = ",".join(map(str, v)) if isinstance(v, list) else str(v)
                    nota_json = js.get("nota")
                if not campos["etapa"]:
                    campos["etapa"] = "previa"
                n = op_add(d, args.slug, **campos)
                if nota_json:
                    op_nota(d, args.slug, str(nota_json), None, False)
                print(f"ok add {n['slug']} ({ETAPA_NOME[n['etapa']]})")
            elif args.cmd == "set":
                valor = open(args.from_file, encoding="utf-8").read().rstrip("\n") if args.from_file else args.valor
                n = op_set(d, args.slug, args.campo, valor)
                print(f"ok set {args.slug} {args.campo}")
            elif args.cmd == "contato":
                c = op_contato_novo(d, args.nome, args.whatsapp, args.slug, args.papel, "", args.fonte, exigir_whatsapp=False)
                print(f"ok contato {args.slug} {args.nome} [{c['id']}]")
            elif args.cmd == "contato-novo":
                c = op_contato_novo(d, args.nome, args.whatsapp, args.negocio, args.papel, args.nota, args.fonte)
                print(f"ok contato-novo {c['id']} {c['nome']}" + (f" em {args.negocio}" if args.negocio else " (avulso)"))
            elif args.cmd == "contato-set":
                c = op_contato_editar(d, args.id, {args.campo: args.valor})
                print(f"ok contato-set {c['id']} {args.campo}")
            elif args.cmd == "move":
                n = op_move(d, args.slug, args.etapa, args.motivo, args.em)
                print(f"ok move {args.slug} -> {ETAPA_NOME[n['etapa']]}")
            elif args.cmd == "msg":
                n, msg = op_msg(d, args.slug, args.de, args.quando, args.texto, args.anexo, args.fonte, args.forcar)
                print(f"ok msg {args.slug} {msg['id']} ({len(n['mensagens'])} no histórico)" if msg
                      else f"igual já existe, ignorada ({args.slug}); use --forcar se for repetida de verdade")
            elif args.cmd == "nota":
                op_nota(d, args.slug, args.texto, args.quando, args.envio)
                print(f"ok nota {args.slug}")
            elif args.cmd == "import-json":
                with open(args.arquivo, encoding="utf-8") as f:
                    novos, atu = op_import(d, json.load(f), args.so_novos)
                print(f"ok import {novos} novos, {atu} atualizados")
            elif args.cmd == "enviada":
                if args.desfazer:
                    n = op_desfazer_envio(d, args.slug, args.fase)
                    print(f"ok desfeito {args.slug} {norm_fase(args.fase)} ({ETAPA_NOME[n['etapa']]})")
                else:
                    n, reg = op_enviada(d, args.slug, args.fase, args.quando)
                    print(f"ok enviada {args.slug} {norm_fase(args.fase)} {reg['quando'][5:]} ({ETAPA_NOME[n['etapa']]})"
                          + (" resolveu cobrança " + reg["cobranca"] if reg["cobranca"] else ""))
            elif args.cmd == "rm":
                op_rm(d, args.slug)
                print(f"ok rm {args.slug}")
            elif args.cmd in ("cobrar", "adiar"):
                if args.cmd == "cobrar":
                    c, emp = op_cobrar(d, args.slug, args.em, args.motivo, args.texto)
                else:
                    c, emp = op_adiar(d, args.slug, args.id, args.em)
                q = c["quando"]
                print(f"ok {args.cmd} {args.slug} {c['id']} {q[8:10]}/{q[5:7]} {q[11:16]}"
                      + (" (empurrada: nada depois das 18h nem domingo)" if emp else ""))
            elif args.cmd == "feita":
                c = op_feita(d, args.slug, args.id)
                print(f"ok feita {args.slug} {c['id']}")
    except ErroCRM as e:
        print(f"erro: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
