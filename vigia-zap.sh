#!/bin/bash
# OPCIONAL, só macOS + Google Chrome com o WhatsApp Web aberto numa aba.
# Vigia do WhatsApp Web sem tocar na página: lê só o TÍTULO da aba ("(N) WhatsApp") via JXA (osascript).
# Grupos silenciados não entram no N. Imprime 1 linha quando N sobe (9h-17h59, seg-sáb); fora disso só guarda o valor.
# Estado e log em <CRM_DIR> (padrão ./data): .vigia-zap.ant e .vigia-zap.log.
cd "$(dirname "$0")" || exit 1
command -v osascript >/dev/null 2>&1 || { echo "vigia-zap: precisa de macOS (osascript); desligado"; exit 0; }
DIR="${CRM_DIR:-data}"; mkdir -p "$DIR"
ant=$(cat "$DIR/.vigia-zap.ant" 2>/dev/null || echo 0)  # sobrevive a reinício (não avisa de novo o que já avisou)
while true; do
  # Chrome de uso normal = processo sem flags (Chrome headless de automação tem --disable-field-trial-config); o JXA mira
  # pelo PID pra não cair num Chrome headless. Lê o título de todas as abas do WhatsApp Web e usa o maior (N).
  pid=$(ps -axo pid=,command= | awk '$2=="/Applications/Google" && $0 ~ /MacOS\/Google Chrome$/ {print $1; exit}')
  t=""
  [ -n "$pid" ] && t=$(osascript -l JavaScript -e "var c=Application($pid),r=[];c.windows().forEach(function(w){w.tabs().forEach(function(x){if(x.url().indexOf('web.whatsapp.com')>=0)r.push(x.title())})});r.join('|')" 2>/dev/null)
  # Leitura vazia = caiu num Chrome headless ou a aba sumiu: não mexe no "antes", tenta de novo.
  if [ -z "$t" ]; then
    vaz=$(( ${vaz:-0} + 1 )); [ "$vaz" -eq 60 ] && echo "AVISO vigia-zap: 10 min sem achar a aba do WhatsApp Web"
    sleep 10; continue
  fi
  vaz=0
  n=$(echo "$t" | grep -oE '\(([0-9]+)\)' | tr -d '()' | sort -n | tail -1); n=${n:-0}
  h=$(date +%H); d=$(date +%u)
  if [ "$n" -gt "$ant" ] && [ "$d" -le 6 ] && [ "$h" -ge 9 ] && [ "$h" -lt 18 ]; then
    echo "ZAP $(date +%H:%M) não lidas: $n (antes $ant)"
  fi
  echo "$(date +%H:%M:%S) n=$n" >> "$DIR/.vigia-zap.log"; ant=$n; echo "$n" > "$DIR/.vigia-zap.ant"
  sleep 20
done
