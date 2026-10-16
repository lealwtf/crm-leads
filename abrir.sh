#!/bin/bash
# Sobe o servidor do CRM (se não estiver de pé) e abre no navegador.
# Uso: ./abrir.sh [--sem-abrir]    Porta: CRM_PORTA (padrão 4180). Dados: CRM_DIR (padrão ./data).
cd "$(dirname "$0")" || exit 1
PORTA="${CRM_PORTA:-4180}"
URL="http://127.0.0.1:$PORTA"
LOG="${CRM_DIR:-data}/servidor.log"
mkdir -p "$(dirname "$LOG")"
if ! curl -fs "$URL/api/versao" >/dev/null 2>&1; then
  nohup python3 servidor.py >> "$LOG" 2>&1 &
  for _ in $(seq 1 30); do
    curl -fs "$URL/api/versao" >/dev/null 2>&1 && break
    sleep 0.2
  done
fi
curl -fs "$URL/api/versao" >/dev/null 2>&1 || { echo "servidor não subiu, veja $LOG"; exit 1; }
if [ "$1" != "--sem-abrir" ]; then
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  fi
fi
echo "CRM em $URL"
