#!/usr/bin/env python3
"""Busca no Instagram com freio GLOBAL (vale pra todos os agentes da máquina ao mesmo tempo).

Uso: ig-get.py <url> [saida]
  - url: só instagram.com (perfil, post, embed). Imagens do CDN (cdninstagram/fbcdn) baixe direto, sem este script.
  - imprime "STATUS <código>" e o caminho salvo (ou o conteúdo no stdout se não passar saída).

Regras: 1 requisição por vez na máquina (trava de arquivo), intervalo mínimo entre requisições, sem cookie/login.
Se vier 429, redirect pra login, página de desafio ou página sem conteúdo, grava um resfriamento para TODOS e
sai com código 3 ("IG EM RESFRIAMENTO"): o agente segue sem Instagram em vez de insistir.

Ambiente:
  IG_INTERVALO=20        segundos mínimos entre requisições
  IG_RESFRIAMENTO=1200   segundos de resfriamento após bloqueio
  IG_FREIO_DIR=<tmp>     pasta do estado e da trava (padrão: pasta temporária do sistema)
  IG_NAVEGADOR=1         usa ig-pw.mjs (Chrome headless sem login, precisa de node + playwright-core)
"""
import fcntl
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

PASTA = os.environ.get("IG_FREIO_DIR") or tempfile.gettempdir()
ESTADO = os.path.join(PASTA, "ig-freio.json")
TRAVA = os.path.join(PASTA, "ig-freio.lock")
INTERVALO = float(os.environ.get("IG_INTERVALO", "20"))
RESFRIA = float(os.environ.get("IG_RESFRIAMENTO", str(20 * 60)))
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
MARCAS = ("seguidores", "followers", "curtida", "likes", "publicações", "posts")


def via_urllib(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            corpo = r.read()
            return r.status, corpo, r.geturl(), any(m in corpo.decode("utf-8", "replace").lower() for m in MARCAS)
    except urllib.error.HTTPError as e:
        return e.code, b"", url, False


def via_navegador(url):
    js = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ig-pw.mjs")
    pr = subprocess.run(["node", js, url], capture_output=True, timeout=90)
    corpo = pr.stdout
    d = json.loads(corpo.decode("utf-8", "replace") or "{}")
    txt = (d.get("text", "") + " " + d.get("meta", "")).lower()
    return d.get("status", -1), corpo, d.get("final", url), any(m in txt for m in MARCAS) or bool(d.get("imgs"))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    url = sys.argv[1]
    saida = sys.argv[2] if len(sys.argv) > 2 else None
    if "instagram.com" not in url:
        sys.exit("só URL do instagram.com")
    os.makedirs(PASTA, exist_ok=True)
    with open(TRAVA, "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            st = json.load(open(ESTADO))
        except Exception:
            st = {"ultimo": 0, "frio_ate": 0, "n": 0}
        agora = time.time()
        if st["frio_ate"] > agora:
            print(f"IG EM RESFRIAMENTO por mais {int(st['frio_ate'] - agora)} s: siga sem Instagram")
            sys.exit(3)
        espera = st["ultimo"] + INTERVALO - agora
        if espera > 0:
            time.sleep(espera)
        try:
            codigo, corpo, final, tem_dado = (via_navegador if os.environ.get("IG_NAVEGADOR") else via_urllib)(url)
        except Exception as e:  # rede, node ausente, JSON inválido
            codigo, corpo, final, tem_dado = -1, b"", url, False
            print(f"ERRO {e}")
        bloqueio = codigo == 429 or "accounts/login" in final or "challenge" in final or (codigo == 200 and not tem_dado)
        st["ultimo"] = time.time()
        st["n"] = st.get("n", 0) + 1
        if bloqueio:
            st["frio_ate"] = time.time() + RESFRIA
        json.dump(st, open(ESTADO, "w"))

    print(f"STATUS {codigo}")
    if bloqueio:
        print(f"IG BLOQUEOU: resfriamento global de {int(RESFRIA // 60)} min gravado; siga sem Instagram")
        sys.exit(3)
    if saida:
        with open(saida, "wb") as f:
            f.write(corpo)
        print(saida)
    else:
        sys.stdout.write(corpo.decode("utf-8", "replace"))


if __name__ == "__main__":
    main()
