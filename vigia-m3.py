#!/usr/bin/env python3
"""Vigia do CRM: imprime 1 linha por negócio que ganhou Msg 3 (link) marcada como enviada
e ainda não tem proposta (proposta.pdf vazio). Estado em <CRM_DIR>/.m3-vistos.json pra não repetir.
Uso: python3 vigia-m3.py  (fica rodando; Ctrl+C para)."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crm  # noqa: E402  (respeita CRM_DIR / CRM_DADOS)
DADOS, VISTOS = crm.DADOS, os.path.join(os.path.dirname(crm.DADOS), '.m3-vistos.json')
try:
    vistos = set(json.load(open(VISTOS)))
except Exception:
    vistos = set()
while True:
    try:
        neg = json.load(open(DADOS))['negocios']
        for s, n in neg.items():
            m3 = (n.get('envios') or {}).get('m3')
            if m3 and s not in vistos and not (n.get('proposta') or {}).get('pdf'):
                print(f"MSG3 {s} | {n.get('nome')} | {n.get('cidade')} | {n.get('nicho')} | enviada {m3.get('quando') if isinstance(m3, dict) else m3}", flush=True)
                vistos.add(s)
                json.dump(sorted(vistos), open(VISTOS, 'w'))
    except Exception as e:
        print(f'ERRO vigia-m3: {e}', flush=True); time.sleep(30)
    time.sleep(5)
