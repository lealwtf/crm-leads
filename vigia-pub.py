#!/usr/bin/env python3
"""Vigia do CRM: imprime 1 linha por negócio que ficou com prévia publicada e ainda não recebeu Msg 1 (sinal pra
mandar a abordagem). Quem já foi abordado sai como PUB-ABORDADO (só informativo). Estado em <CRM_DIR>/.pub-vistos.json.
Na 1ª vez marca tudo que já está publicado como visto, sem avisar.
Uso: python3 vigia-pub.py  (fica rodando; Ctrl+C para)."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crm  # noqa: E402  (respeita CRM_DIR / CRM_DADOS)
DADOS, VISTOS = crm.DADOS, os.path.join(os.path.dirname(crm.DADOS), '.pub-vistos.json')
try:
    vistos = set(json.load(open(VISTOS)))
except Exception:
    vistos = None
while True:
    try:
        neg = json.load(open(DADOS))['negocios']
        pubs = {s: n for s, n in neg.items() if (n.get('previa') or {}).get('publicada') and n.get('etapa') not in ('perdido', 'ganho')}
        if vistos is None:
            vistos = set(pubs)
        for s, n in pubs.items():
            if s in vistos:
                continue
            env = n.get('envios') or {}
            tag = 'PUB' if not env.get('m1') else 'PUB-ABORDADO'
            print(f"{tag} {s} | {n.get('nome')} | {n.get('cidade')} | {(n.get('previa') or {}).get('url')} | envios {','.join(env) or '-'}", flush=True)
            vistos.add(s)
        json.dump(sorted(vistos), open(VISTOS, 'w'))
    except Exception as e:
        print(f'ERRO vigia-pub: {e}', flush=True); time.sleep(30)
    time.sleep(10)
