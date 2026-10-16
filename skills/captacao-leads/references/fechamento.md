# Fase 6: fechamento

Valores abaixo são **exemplo**. Defina os seus no briefing e use sempre os mesmos.

## Quando alguém pergunta "quanto fica?" ou diz "quero"

1. **Próximo passo concreto**, nunca "o que achou?":
   "Posso começar? Me manda as fotos e a lista de serviços que eu deixo no ar essa semana."
2. **Tirar o risco**: "Você só paga a primeira parte quando aprovar a página no ar."
3. **Preço numa linha** (exemplo): R$ 500, metade pra começar e metade quando estiver no ar (2 Pix de R$ 250). Domínio pago direto pelo cliente no registro, no nome dele.
4. **Ligação curta**: "Posso te ligar 5 minutinhos pra te mostrar?"
5. **Data real** quando for verdade (temporada, data do evento do cliente). Nunca escassez inventada.

## Objeção de preço

- **Parcelamento só depois que o cliente reclamar do preço** (exemplo: 4x de R$ 125). Nunca na primeira apresentação, nem como "a gente é flexível" ou "outro jeito a gente combina".
- Depois do parcelamento oferecido, se não andar: 1 última mensagem com saída fácil e para.

## Proposta (modelo para colar no WhatsApp)

```text
Fica assim, <Nome>:
• Página da <Empresa> no ar, no endereço de vocês, com WhatsApp, endereço no mapa e <recurso do nicho>.
• Ficha do Google do negócio revisada: horário, fotos, categoria, link da página.
• 30 dias de ajuste de texto e foto depois de publicar.
Total R$ <valor>: metade pra começar e metade quando estiver no ar. O domínio fica no nome de vocês.
Pra começar preciso de: logo, 5 a 10 fotos, horário, lista de serviços/produtos e o número do WhatsApp.
```

## Pagamento e entrega

- Pix na chave da empresa; nota fiscal de serviço depois de cada parcela.
- Não prometer prazo em dias antes de receber o material.
- Na entrega: domínio do cliente, tirar `noindex` e `Disallow`, pedir um depoimento ou atestado curto e 1 indicação.

## No CRM

```bash
python3 crm.py msg <slug> --de eles --quando "..." --texto "quanto fica?" --fonte print
python3 crm.py set <slug> proposta.valor 500
python3 crm.py set <slug> proposta.forma "2x R$ 250 Pix"
python3 crm.py set <slug> proposta.enviada_em 2026-10-14
python3 crm.py move <slug> proposta
python3 crm.py cobrar <slug> --em "+3" --motivo "Sem resposta da proposta" --texto "Oi, tudo bem? Posso começar? Você só paga a primeira parte quando aprovar a página no ar."
python3 crm.py move <slug> negociando     # conversa de ajuste/forma de pagamento
python3 crm.py move <slug> ganho          # 1ª parte paga
```
