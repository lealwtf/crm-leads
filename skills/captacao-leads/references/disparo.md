# Fase 5: disparo

## Por que em partes

- "Oi" sozinho obriga a pessoa a responder um estranho sem saber o assunto. Textão com link de desconhecido tem o formato de golpe. O meio termo: saudação, depois uma mensagem curta e completa que **termina pedindo licença** para mandar o link.
- O WhatsApp limita mensagens a quem não responde, e denúncia pesa na conta. Menos toques, mais certeiros: 1 a 1, nunca em massa.
- A prévia pronta é o trunfo, mas é **proposta**, nunca "fiz de graça pra você".

## Sequência

| Fase CRM | Quando | Conteúdo |
|---|---|---|
| `m1` | dia útil, antes das 18h | "Bom dia, tudo bem?" / "Boa tarde, tudo bem?" e espera uns segundos (robô?) |
| `m2` | logo depois | quem é + o que montou (2 ou 3 recursos que existem na página) + "Posso te mandar o link pra você ver?" |
| `m2a` | caiu em atendente/recepção | pede só repasse, melhor horário ou quem cuida da divulgação |
| `m3` | depois do "pode" | link + "É uma proposta, não aparece no Google, só quem tem o link vê." |
| `fu` | sem resposta em ~2 dias | o link de novo, já apresentado, "abre quando tiver um tempo" |

Depois do follow-up: no máximo 1 mensagem de encerramento com saída fácil ("vou parar de te chamar pra não incomodar; a prévia fica no ar se quiser ver depois"). Para. Volta só com motivo novo e real, semanas depois.

## Formato do `roteiro.md` (lido ao vivo pelo CRM)

```markdown
## Mensagens

### Msg 2 (licença)
> Aqui é <seu nome>, faço sites aqui na região. Montei uma prévia de página pra <Negócio>, com <recurso 1>, <recurso 2> e um botão que já manda o pedido no WhatsApp de vocês. Posso te mandar o link pra você ver?

### Msg 2 atendente
> Oi, tudo bem? Montei uma prévia de página pra <Negócio>. Consegue passar pra quem cuida da divulgação, ou me dizer o melhor horário de falar com essa pessoa?

### Msg 3 (link)
> Tá aqui: https://<slug>.seudominio.com.br
> (Junto: "É uma proposta, não aparece no Google, só quem tem o link vê.")
Se não abrir, mande 2 prints (topo e o recurso principal).

### Follow-up
> Oi, pra facilitar deixo o link aqui, abre quando tiver um tempo: https://<slug>.seudominio.com.br

## Antes de enviar
- Conferir se o número é WhatsApp e se é do próprio negócio.
```

Regras do parser: cada `### Msg N` abre um bloco; só as linhas com `>` entram quando houver; linha entre parênteses é nota interna, exceto `(Junto: "...")`, que entra na mensagem; "Se não abrir..." fica de fora; `### Follow-up` é o texto do `fu`. `crm.py textos <slug>` mostra o resultado.

## Atendente e robô

- **Atendente nunca recebe pergunta de interesse, preço ou decisão.** Para ela, "não" é a resposta segura. Peça só o que ela pode fazer sem risco: repassar, dizer o melhor horário, dizer quem cuida da divulgação.
- Primeiro contato pede o responsável por divulgação, **nunca chama o dono pelo nome**. O dono entra só se a própria pessoa indicar.
- Caiu no robô: não reescreva o pitch como se fosse para o dono. Espere o humano, chame pelo nome, diga em 1 frase o que montou e peça repasse ou horário.
- Depois de um "não" da atendente, no máximo 1 resposta: agradecer, dizer em 1 frase o que é e oferecer só o repasse com saída fácil. Outro "não" ou silêncio: encerrou.

## Nunca

- "Vocês não têm site" (ou qualquer fato sem conferir).
- Insistir depois de "não". "Não é não": agradece e para.
- Mensagem depois das 18h ou no domingo. Mais de 1 toque por dia.
- Preço, áudio frio, "sem compromisso nenhum", "eu ajusto", "fico à disposição" na abertura.
- Contato que não foi publicado pelo próprio negócio.
- Hero da prévia com CTA de contato (o pedido vem depois que a pessoa entendeu).

## No CRM

```bash
python3 crm.py fila                       # quem falta a Msg 1 e a Msg 2
python3 crm.py textos <slug>              # textos prontos de cada fase
python3 crm.py enviada <slug> m1          # depois que o usuário mandou
python3 crm.py msg <slug> --de eles --quando "13/10 10:39" --texto "pode mandar" --fonte print
python3 crm.py enviada <slug> m3
python3 crm.py hoje                       # cobranças automáticas de follow-up aparecem aqui
```
