#!/bin/bash
# Lembrete do dia: mostra `crm.py hoje` e (no macOS) manda 1 notificação com a contagem.
# Uso: ./lembrete.sh   (rode no início do dia; não envia nada pra ninguém)
cd "$(dirname "$0")" || exit 1
saida=$(python3 crm.py hoje) || exit 1
echo "$saida"
n=$(printf '%s\n' "$saida" | tail -n +2 | grep -c .)
if [ "$n" -gt 0 ] && command -v osascript >/dev/null 2>&1; then
  osascript -e 'on run argv' -e 'display notification (item 2 of argv) with title (item 1 of argv)' -e 'end run' \
    "CRM: $n pra fazer hoje" "$(printf '%s\n' "$saida" | sed -n 2,4p | cut -c17-38 | tr -s ' ' | paste -sd, -)"
fi
