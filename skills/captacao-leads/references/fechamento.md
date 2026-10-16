# Fechamento: preço, pedido de decisão, objeções, entrega

Valores abaixo são **exemplo** (R$ 500 em 2 Pix de R$ 250). Defina os seus no briefing e use sempre os mesmos.

## O maior vazamento

Depois do "gostei" ou do "qual o valor", o erro comum é não pedir a decisão: pedir foto, número de conselho ou cardápio, ou oferecer adiar. Isso vira dever de casa e a conversa morre. **Pedido de preço não é resultado; pagamento é.**

## Depois de "gostei" ou "qual o valor": preço curto + sim e não juntos

Pergunta direta merece resposta na hora e clara.

> Fica R$ 500, pagamento único, sem mensalidade.
> São 2 Pix de R$ 250: o 1º só quando você aprovar a página pronta, o 2º quando ela estiver no ar.
> Se fizer sentido, você aprova, faz o 1º Pix e eu coloco no ar [dia]. Se não for o momento, pode me falar tranquila.

- **Sim e não na mesma mensagem.** A saída livre dita uma vez, no pedido que importa.
- **Nada de dever de casa antes do 1º Pix**: foto, registro e cardápio vêm depois, antes de publicar ("a foto eu troco quando você mandar").
- **Nunca oferecer adiar** ("prefere que eu te chame semana que vem?").
- Uma forma de pagamento só. Sem "investimento", sem "sou flexível", sem desconto "se fechar hoje", sem prazo em dias antes do material, sem PDF junto.
- Domínio só se perguntarem: fica no nome do cliente, e você ajuda a registrar numa ligação de 5 minutos.
- Suporte, se perguntarem, em 1 frase (exemplo: "ajustes inclusos no primeiro mês").

Engatou mas não perguntou o preço (pediu ajuste, elogiou algo específico):
> Que bom que gostou dessa parte! Quer que eu te conte como funciona pra ela ir pro ar no nome de vocês?

## Disse sim

Mande a chave de pagamento na hora, com o valor exato e o dia em que vai pro ar. Sem PDF. Registre no CRM no mesmo turno.

## Objeções

**"Vou pensar"**: aceite de verdade e faça **uma** pergunta que deixa a pessoa escolher a saída.
> Claro, fica à vontade! Só pra eu entender, ficou alguma dúvida de como funciona, ou é mais o momento mesmo?

**"Tá caro" / "fora do orçamento"**: agradeça a sinceridade, não defenda o preço com argumento. **Só aqui entra o parcelamento** (exemplo: 4x de R$ 125).
> Entendo, obrigado por ser sincera. Se ajudar, dá pra fazer em 4x de R$ 125 no Pix.

Distância grande: saia sem drama ("aí não faz sentido mesmo agora, de boa").

**"Agora não" / "não tenho interesse"**: "não" é não. Uma resposta, sem pergunta, e para.
> Tranquilo, obrigado por responder! Se um dia quiser, é só me chamar.

Nunca: lista de benefícios, "mas pensa bem", urgência inventada, nova mensagem depois de um "não".

## Ligação de 5 minutos

Ofereça depois do elogio, de "quem é você?", ou para falar com o decisor por trás de uma secretária: "Te ligo 5 minutinhos e mostro a página funcionando no seu celular. Que horário é melhor?" Use a ligação também para registrar o domínio.

## PDF da proposta (só depois do sim ou de pedido explícito)

Passos, nesta ordem:
1. Você aprova a página.
2. Primeiro pagamento (só depois da aprovação).
3. A gente registra o domínio (ligação de 5 minutos).
4. Eu monto e ajusto com o seu material.
5. O site vai pro ar e fecha com o segundo pagamento.

## Pagamento e entrega

- Chave de pagamento da sua empresa; nota fiscal de serviço depois de cada parcela.
- Não prometer prazo em dias antes de receber o material.
- Na entrega: domínio do cliente, tirar `noindex` e `Disallow`, pedir um depoimento ou atestado curto e 1 indicação.

## No CRM

```bash
python3 crm.py msg <slug> --de eles --quando "AAAA-MM-DD HH:MM" --texto "quanto fica?" --fonte print
python3 crm.py set <slug> proposta.valor 500
python3 crm.py set <slug> proposta.forma "2x R$ 250 Pix"
python3 crm.py move <slug> proposta
python3 crm.py cobrar <slug> --em "+1" --motivo "Pedir decisão" --texto "..."
python3 crm.py move <slug> negociando     # objeção ou forma de pagamento em conversa
python3 crm.py move <slug> ganho          # 1º pagamento caiu
python3 crm.py move <slug> perdido --motivo "..."
```
