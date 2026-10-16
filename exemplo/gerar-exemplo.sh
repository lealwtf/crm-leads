#!/bin/bash
# Regera exemplo/crm.json (4 leads fictícios) usando só a CLI. Serve também de exemplo de uso.
# Uso: ./exemplo/gerar-exemplo.sh
set -u
cd "$(dirname "$0")/.." || exit 1
T=$(mktemp -d)
export CRM_DIR=$T CRM_PREVIAS=$PWD/exemplo/previas
c() { python3 crm.py "$@" >/dev/null || echo "ERRO: $*"; }
H() { export CRM_HOJE="$1"; }

H "2026-10-01 10:00"
c add doceriaaurora --nome "Doceria Aurora" --cidade "Cidade Exemplo" --nicho confeitaria --instagram doceria.aurora.exemplo --whatsapp 5500000000001 --contato "Contato da bio" --papel outro --tags exemplo,encomenda
c set doceriaaurora previa.url https://doceriaaurora.example.com
c set doceriaaurora previa.publicada true
c add pousadavaleazul --nome "Pousada Vale Azul" --cidade "Serra Exemplo" --nicho pousada --instagram pousada.valeazul.exemplo --whatsapp 5500000000003 --contato "Dona (fictícia)" --papel dono --tags exemplo
c set pousadavaleazul previa.url https://pousadavaleazul.example.com
c set pousadavaleazul previa.publicada true
c set pousadavaleazul textos.m2 "Aqui é o Fulano, faço sites aqui na região. Montei uma prévia de página pra Pousada Vale Azul, com os quartos, o café da manhã e um botão que já pede a reserva com as datas no WhatsApp. Posso te mandar o link?"
c set pousadavaleazul textos.m3 "Tá aqui: https://pousadavaleazul.example.com É uma proposta, não aparece no Google, só quem tem o link vê."
c add ateliefiodeouro --nome "Ateliê Fio de Ouro" --cidade "Cidade Exemplo" --nicho costura --instagram atelie.fiodeouro.exemplo --whatsapp 5500000000004 --papel dono --tags exemplo
H "2026-10-02 10:00"
c add studiolirio --nome "Studio Lírio" --cidade "Cidade Exemplo" --nicho sobrancelha --instagram studio.lirio.exemplo --whatsapp 5500000000002 --contato "Recepção" --papel atendente --tags exemplo
c set studiolirio previa.url https://studiolirio.example.com
c set studiolirio previa.publicada true

# Pousada: Msg 1, Msg 2, resposta, link, pedido de preço, proposta, cobrança
H "2026-10-05 10:15"; c enviada pousadavaleazul m1
H "2026-10-05 10:17"; c enviada pousadavaleazul m2
c msg pousadavaleazul --de eles --quando "2026-10-05 11:02" --texto "Oi! Pode mandar sim" --fonte print
H "2026-10-05 11:05"; c enviada pousadavaleazul m3
c msg pousadavaleazul --de eles --quando "2026-10-06 09:40" --texto "Gostei bastante. Quanto fica?" --fonte print
c msg pousadavaleazul --de eu --quando "2026-10-06 10:05" --texto "Fica R\$ 500: metade pra começar e metade quando estiver no ar. Posso começar? Me manda as fotos dos quartos que eu deixo no ar essa semana." --fonte print
H "2026-10-06 10:06"
c set pousadavaleazul proposta.valor 500
c set pousadavaleazul proposta.forma "2x R\$ 250 Pix"
c set pousadavaleazul proposta.enviada_em 2026-10-06
c move pousadavaleazul proposta
c cobrar pousadavaleazul --em "2026-10-09 10:00" --motivo "Sem resposta da proposta" --texto "Oi, tudo bem? Posso começar? Você só paga a primeira parte quando aprovar a página no ar."
c set pousadavaleazul proximo_passo "Esperar as fotos dos quartos"

# Studio: caiu na recepção, Msg 2 atendente, cobrança pra segunda
H "2026-10-06 15:00"; c enviada studiolirio m1
H "2026-10-06 15:01"; c enviada studiolirio m2a
c msg studiolirio --de eles --quando "2026-10-06 15:20" --texto "A dona volta segunda, pode chamar ela então" --fonte print
H "2026-10-06 15:25"
c nota studiolirio "Recepção pediu pra falar com a dona na segunda"
c cobrar studiolirio --em "2026-10-12 10:00" --motivo "Dona volta segunda" --texto "Oi, tudo bem? A recepção me disse que você voltava hoje. Montei uma prévia de página pro Studio Lírio, posso te mandar o link?"

# Ateliê: "não é não", perdido
H "2026-10-03 11:00"; c enviada ateliefiodeouro m1
H "2026-10-03 11:30"; c msg ateliefiodeouro --de eles --quando "2026-10-03 11:28" --texto "Não temos interesse, obrigada" --fonte print
H "2026-10-03 11:35"; c msg ateliefiodeouro --de eu --quando "2026-10-03 11:34" --texto "Imagina, obrigado pelo retorno! Bom trabalho." --fonte print
c move ateliefiodeouro perdido --motivo "Disse que não tem interesse"

# Aberturas da prévia (fictícias): no uso real quem grava é um script seu que lê o log de acesso (crm.op_acessos)
H "2026-10-05 11:20"
python3 -c '
import crm
regs = [{"q": "2026-10-05 11:06:10", "t": "previa_gerada", "d": "celular", "v": "a1b2c3"},
        {"q": "2026-10-05 11:09:42", "t": "abriu", "d": "celular", "v": "a1b2c3"},
        {"q": "2026-10-06 09:31:05", "t": "abriu", "d": "desktop", "v": "d4e5f6"}]
with crm.trava():
    d = crm.carregar()
    crm.op_acessos(d, "pousadavaleazul", regs)
    crm.gravar(d)
' || echo "ERRO: acessos"

cp "$T/crm.json" exemplo/crm.json
rm -rf "$T"
echo "exemplo/crm.json regerado"
