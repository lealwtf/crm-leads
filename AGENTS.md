# Instruções para agentes (qualquer harness)

Este repo é um mini CRM local de leads (Python 3 stdlib). Antes de mexer em lead:

- Leia a seção **"Usando com um agente"** do `README.md`: prompts de exemplo e as regras (sempre pela CLI `python3 crm.py`, nunca editar o JSON na mão, registrar no mesmo turno, fonte de cada mensagem, nada depois das 18h, "não" é não, não mandar mensagem por conta própria).
- Fluxo de captação (busca, prévia, revisão nota 8, publicação, disparo, fechamento): `skills/captacao-leads/SKILL.md`.
- Dados ficam em `CRM_DIR` (padrão `./data`, fora do git). Teste sempre numa cópia: `python3 teste_envio.py`.
- Mudou código? Rode `python3 teste_envio.py` antes de dizer que está pronto.
- Painel (`GET /api/painel`) é só leitura. Fontes opcionais do bloco de tempo real e vigias: `README.md`, seções "Configuração" e "Vigias".
