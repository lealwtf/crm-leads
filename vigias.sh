#!/bin/bash
# Os vigias do CRM num processo só (bom pra deixar um agente ou um terminal acompanhando a saída):
#   m3   (Msg 3 enviada e sem proposta)      python3 vigia-m3.py
#   pub  (prévia publicada e sem Msg 1)      python3 vigia-pub.py
#   zap  (não lida no WhatsApp Web)          ./vigia-zap.sh, só se CRM_VIGIA_ZAP=1 (macOS + Chrome)
#   abriu (lead abriu a prévia)              CRM_ACESSOS_CMD a cada 2 min, se definido: um comando seu que lê o log de
#                                            acesso das prévias e grava via crm.op_acessos, imprimindo "ABRIU ..."
cd "$(dirname "$0")" || exit 1
DIR="${CRM_DIR:-data}"; mkdir -p "$DIR"
trap 'kill 0' EXIT
[ "${CRM_VIGIA_ZAP:-}" = "1" ] && ./vigia-zap.sh &
python3 -u vigia-m3.py &
python3 -u vigia-pub.py &
if [ -n "${CRM_ACESSOS_CMD:-}" ]; then
  (while true; do sh -c "$CRM_ACESSOS_CMD" 2>>"$DIR/.acessos-erro.log"; sleep 120; done) &
fi
wait
