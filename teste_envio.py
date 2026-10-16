#!/usr/bin/env python3
"""Oráculo de "Marcar enviada" + Fila de envio + textos do roteiro, sempre numa CÓPIA de exemplo/crm.json
(nunca nos seus dados). Uso: python3 teste_envio.py [lote.json]"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
tmp = tempfile.mkdtemp(prefix="crm-teste-")
copia = os.path.join(tmp, "crm.json")
shutil.copy(os.path.join(AQUI, "exemplo", "crm.json"), copia)
PREVIAS = os.path.join(AQUI, "exemplo", "previas")
ENV = {**os.environ, "CRM_DIR": tmp, "CRM_PREVIAS": PREVIAS, "CRM_HOJE": "2026-10-13 14:01"}
ENV.pop("CRM_DADOS", None)
falhas = []


def cli(*a, ok=True):
    r = subprocess.run([sys.executable, os.path.join(AQUI, "crm.py"), *a], env=ENV, capture_output=True, text=True)
    if ok and r.returncode:
        falhas.append(f"crm.py {' '.join(a)}: {r.stderr.strip()}")
    return r


def neg(slug):
    return json.load(open(copia))["negocios"][slug]


def checa(cond, msg):
    print(("ok   " if cond else "FALHA ") + msg)
    if not cond:
        falhas.append(msg)


antes = json.load(open(copia))
lote = sys.argv[1] if len(sys.argv) > 1 else ""
if lote:
    cli("import-json", "--so-novos", lote)
    cli("import-json", "--so-novos", lote)
    depois = json.load(open(copia))
    novos = [x["slug"] for x in json.load(open(lote))]
    checa(all(s in depois["negocios"] for s in novos), "lote importado")
    checa(len(depois["negocios"]) == len(antes["negocios"]) + len([s for s in novos if s not in antes["negocios"]]),
          "importar 2x não duplica")
    for s, n in antes["negocios"].items():
        d = depois["negocios"][s]
        if d["mensagens"] != n["mensagens"] or d["cobrancas"] != n["cobrancas"] or d["nome"] != n["nome"]:
            falhas.append(f"import mexeu em {s}")
    fila = cli("fila").stdout
    checa(all(s in fila for s in novos), "fila mostra os do lote")
    previa = [s for s, n in depois["negocios"].items() if n["etapa"] == "previa"]
    checa(all(s in fila.split("Msg 2 a mandar")[0] for s in previa), f"fila mostra quem mais está em Prévia ({len(previa)})")

d0 = json.load(open(copia))["negocios"]
alvo = next((s for s, n in d0.items() if n["etapa"] == "previa" and any(c["whatsapp"] for c in n["contatos"])), None)
if not alvo:
    # ninguém em Prévia com WhatsApp: clona na CÓPIA um negócio com roteiro, zerado em Prévia
    tudo = json.load(open(copia))
    base = tudo["negocios"]["doceriaaurora"]
    for nome in ("teste-fila", "outro-teste"):
        c = json.loads(json.dumps(base))
        c.update(slug=nome, nome=nome, etapa="previa", etapa_desde="2026-10-01 10:00", etapa_desde_fonte="movimento",
                 envios={}, mensagens=[], eventos=[], cobrancas=[], proximo_passo="", proximo_em="",
                 textos={"m2": "Msg 2 de teste", "m3": "Msg 3 de teste"})
        c.pop("etapa_seq", None)
        tudo["negocios"][nome] = c
    json.dump(tudo, open(copia, "w"), ensure_ascii=False)
    d0 = tudo["negocios"]
    alvo = "teste-fila"
n0 = neg(alvo)
cli("enviada", alvo, "m1")
n1 = neg(alvo)
checa(n1["etapa"] == "abordado", f"Msg 1 em {alvo} move Prévia -> Abordado")
m = n1["mensagens"][-1]
checa(m["de"] == "eu" and m["fonte"] == "marcado" and m["texto"] == "Boa tarde, tudo bem?" and m["quando"] == "2026-10-13 14:01",
      "Msg 1 gravada no histórico (eu, marcado, 'Boa tarde' às 14:01)")
r = subprocess.run([sys.executable, "-c", "import crm,datetime as d;print(crm.saudacao(d.datetime(2026,10,13,9,0)))"],
                   cwd=AQUI, capture_output=True, text=True)
checa(r.stdout.strip() == "Bom dia, tudo bem?", "antes das 12h: 'Bom dia, tudo bem?'")
checa(alvo not in cli("fila").stdout.split("Msg 2 a mandar")[0], "depois da Msg 1 sai da fila")
checa(alvo in cli("fila").stdout.split("Msg 2 a mandar")[1], "e entra em 'Msg 2 a mandar'")
cli("enviada", alvo, "m1", ok=False)
checa(len(neg(alvo)["mensagens"]) == len(n1["mensagens"]), "marcar de novo não duplica")
cli("enviada", alvo, "m2")
checa(alvo not in cli("fila").stdout.split("Msg 2 a mandar")[1], "Msg 2 marcada sai de 'Msg 2 a mandar'")
cli("enviada", alvo, "m3")
checa(neg(alvo)["etapa"] == "link", "Msg 3 move pra Link enviado")
checa(any(c["auto"] and c.get("regra") == "link" for c in neg(alvo)["cobrancas"]), "Msg 3 cria a cobrança automática do link")
cli("enviada", alvo, "m3", "--desfazer")
checa(neg(alvo)["etapa"] == "abordado" and len(neg(alvo)["mensagens"]) == len(n1["mensagens"]) + 1, "desfazer Msg 3 volta pra Abordado e tira a mensagem")
cli("enviada", alvo, "m2", "--desfazer")
cli("enviada", alvo, "m1", "--desfazer")
n2 = neg(alvo)
checa(n2["etapa"] == "previa" and n2["etapa_desde"] == n0["etapa_desde"] and n2["mensagens"] == n0["mensagens"]
      and n2["eventos"] == n0["eventos"] and not n2["envios"], "desfazer tudo volta ao estado original")
checa(n2["cobrancas"] == n0["cobrancas"], "desfazer não deixa cobrança automática fantasma")
outro = next((s for s, n in d0.items() if s != alvo and n["etapa"] == "previa"), None)
if outro:
    cli("enviada", alvo, "m1")
    cli("enviada", outro, "m1")
    a1, a2 = neg(alvo), neg(outro)
    checa(a1["etapa_desde"] == a2["etapa_desde"] and a2.get("etapa_seq", 0) > a1.get("etapa_seq", 0),
          "dois envios no mesmo minuto: o último fica no topo de Abordado (etapa_seq)")
    cli("enviada", outro, "m1", "--desfazer")
    cli("enviada", alvo, "m1", "--desfazer")

prop = next(s for s, n in d0.items() if n["etapa"] == "proposta")
fase = next(f for f in ("m1", "m2", "m2a") if f not in (neg(prop).get("envios") or {}))
if fase != "m1":
    cli("set", prop, f"textos.{fase}", "texto de teste")
p0 = neg(prop)
cli("enviada", prop, fase)
checa(neg(prop)["etapa"] == "proposta" and len(neg(prop)["mensagens"]) == len(p0["mensagens"]) + 1,
      f"{fase} em {prop} (Proposta) não move pra trás, só registra")
cli("enviada", prop, fase, "--desfazer")
checa(neg(prop)["mensagens"] == p0["mensagens"] and neg(prop)["etapa"] == "proposta", "desfazer em Proposta")

cli("cobrar", prop, "--em", "2026-10-14 10:00", "--motivo", "teste fu")
cid = [c for c in neg(prop)["cobrancas"] if c["motivo"] == "teste fu"][0]["id"]
abertas = sorted([c for c in neg(prop)["cobrancas"] if not c["feita"]], key=lambda c: c["quando"])
cli("enviada", prop, "fu")
alvo_c = abertas[0]["id"]
checa(next(c for c in neg(prop)["cobrancas"] if c["id"] == alvo_c)["feita"], "Follow-up resolve a cobrança aberta")
cli("enviada", prop, "fu", "--desfazer")
checa(not next(c for c in neg(prop)["cobrancas"] if c["id"] == alvo_c)["feita"], "desfazer Follow-up reabre a cobrança")

# segundo lead em Prévia (clonado na cópia) pro teste de etapa_seq
tudo = json.load(open(copia))
if not any(s != alvo and n["etapa"] == "previa" for s, n in tudo["negocios"].items()):
    c = json.loads(json.dumps(tudo["negocios"][alvo]))
    c.update(slug="outro-teste", nome="outro-teste")
    tudo["negocios"]["outro-teste"] = c
    json.dump(tudo, open(copia, "w"), ensure_ascii=False)
    cli("enviada", alvo, "m1")
    cli("enviada", "outro-teste", "m1")
    a1, a2 = neg(alvo), neg("outro-teste")
    checa(a1["etapa_desde"] == a2["etapa_desde"] and a2.get("etapa_seq", 0) > a1.get("etapa_seq", 0),
          "dois envios no mesmo minuto: o último fica no topo de Abordado (etapa_seq)")
    cli("enviada", "outro-teste", "m1", "--desfazer")
    cli("enviada", alvo, "m1", "--desfazer")

COM_ROTEIRO = sorted(os.listdir(PREVIAS))
sys.path.insert(0, AQUI)
os.environ.update(CRM_DIR=tmp, CRM_PREVIAS=PREVIAS)
os.environ.pop("CRM_DADOS", None)
import crm  # noqa: E402

dados = crm.carregar()
for s in COM_ROTEIRO:
    n = dados["negocios"][s]
    t = crm.textos_fases(n)
    tudo = "\n".join(v["texto"] for v in t.values())
    ruim = [x for x in ("Se não abrir", "se não abrir", "###", "Follow-up", "Antes de enviar") if x in tudo]
    checa(not ruim and t["m2"]["texto"] and t["m3"]["texto"] and n["previa"]["url"] in t["m3"]["texto"],
          f"textos de {s}: m2/m3 limpos" + (f" (achou {ruim})" if ruim else ""))
fd = crm.textos_fases(dados["negocios"]["doceriaaurora"])
checa("Follow" not in fd["m3"]["texto"] and "só quem tem o link vê" in fd["m3"]["texto"],
      "doceriaaurora: Msg 3 traz o (Junto: ...) e não o Follow-up")
checa(fd["fu"]["origem"] == "roteiro" and fd["fu"]["texto"].startswith("Oi, pra facilitar"), "Follow-up vem do roteiro")
pv = crm.textos_fases(dados["negocios"]["pousadavaleazul"])
checa(pv["m2"]["origem"] == "editado", "texto editado no negócio (textos.m2) vence o roteiro")
checa(crm.textos_fases(dados["negocios"]["ateliefiodeouro"])["fu"]["origem"] == "padrao", "sem roteiro: Follow-up padrão")

shutil.rmtree(tmp)
print(f"\n{'OK' if not falhas else 'FALHOU'}: {len(falhas)} falha(s)")
for f in falhas:
    print("  " + f)
sys.exit(1 if falhas else 0)
