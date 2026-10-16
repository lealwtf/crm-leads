---
name: captacao-leads
description: Fluxo de captação de leads locais pelo WhatsApp com prévia de site pronta, do lead ao fechamento, operando o mini CRM (crm-leads) pela CLI. Use ao buscar leads, checar se um negócio serve, construir ou revisar uma prévia de site para prospecção, rodar a revisão "nota 8" (advisor adversarial com corte 8), publicar prévias, preparar ou registrar Msg 1/2/3 e follow-up, montar cobranças, responder pedido de preço ou fechar venda. Use também quando o usuário disser "acha leads", "monta as prévias", "revisa até nota 8", "publica as aprovadas", "o que mando pro lead X?", "ele perguntou quanto fica", "registra no CRM" ou "o que tenho pra cobrar hoje?".
---

# Captação de leads com prévia pronta

Método para vender sites simples a pequenos negócios locais: achar quem tem sinal real de compra, montar uma prévia boa o bastante para ser mostrada, revisar com um advisor adversarial até nota 8, publicar, abordar 1 a 1 pelo WhatsApp e fechar. Tudo que acontece com um lead é registrado no mini CRM pela CLI (`python3 crm.py`, ver `README.md` do repo).

Preços, cidades e nichos aqui são **exemplos configuráveis**. Ajuste para o seu mercado no topo do seu briefing; a estrutura do fluxo é o que vale.

## Configure antes de usar

Defina no briefing (ou num arquivo do projeto) e use sempre os mesmos valores:

| Item | Exemplo | Onde pesa |
|---|---|---|
| Região e cidades | 2 cidades vizinhas | busca, dedup, ordem de envio |
| Nichos-alvo e nichos a evitar | encomenda/orçamento sim, mensalidade não | busca |
| Preço e forma | R$ 500 em 2 Pix (50/50) | fechamento |
| Parcelamento de objeção | 4x R$ 125 | só depois de reclamação de preço |
| Domínio das prévias | `<slug>.seudominio.com.br` | publicação, Msg 3 |
| Horário de envio | dia útil, até 18h | disparo, cobranças |
| Guia de gosto | arquivo com critérios visuais | revisão nota 8 |

## Princípio: fases que não se misturam

Cada fase só resolve o que é dela. Não leve dúvida de uma fase para outra, e não pergunte ao usuário, na construção ou revisão, algo que só se decide no disparo.

| # | Fase | Entrega | Para quando |
|---|---|---|---|
| 1 | Busca e checagem | ficha do lead (fatos lidos, contato e fonte, ângulo, nota) | lead reprovado em qualquer critério |
| 2 | Construção da prévia | `previas/<slug>/index.html` + `roteiro.md` com as mensagens | checagem rápida reprovar ("REPROVADO: motivo") |
| 3 | Revisão de gosto (nota 8) | veredito com nota, problemas e o que manter | nota >= 8, ou 3 voltas sem chegar |
| 4 | Publicação | URL no ar com OG e favicon conferidos | algo falhar 2x: para e descreve |
| 5 | Disparo | Msg 1, 2, 3 e follow-up, marcados no CRM | "não", ou sequência encerrada |
| 6 | Fechamento | proposta aceita, 1ª parte paga | ganho ou perdido no CRM |

Número de WhatsApp não confirmado **não bloqueia** as fases 2 a 4. Isso é resolvido no disparo: deixe nota em "Antes de enviar" no roteiro.

## Fase 1: busca e checagem

Critérios, todos obrigatórios (detalhe e consultas em `references/busca-e-checagem.md`):

1. **Lead ativo**: post próprio nos últimos ~30 dias (post fixado não conta).
2. **Sem site próprio**: só Instagram, Linktree, Canva, agregador ou cardápio digital. Confira o domínio (`dig +short` nas variações `.com.br`/`.com`, RDAP do registro) e 1 busca na web. Domínio achado pode ser de outro negócio com o mesmo nome: confira antes de reprovar ou aprovar.
3. **Contato publicado pelo próprio negócio**: bio, link da bio, Google Maps, ficha. Nunca número achado em lista de terceiros.
4. **Sinal real**: negócio pequeno em que a dona ou o dono atende o próprio WhatsApp e vende por encomenda, orçamento ou agenda com data. Use o histórico do seu CRM para calibrar quais nichos respondem e quais recusam por preço.

Fora do alvo (exemplo, ajuste ao seu histórico): franquia ou rede, negócio com agência, mensalidade sensível a preço.

Instagram passa sempre pelo freio (abaixo). Cada aprovado vira ficha com: slug curto sem hífen nem acento, 3 a 6 fatos lidos, até 6 posts com foto boa (sem rosto de cliente), ângulo (o pedido concreto que a página resolve) e nota 0 a 10 de chance de responder e fechar. Deduplique por slug e pelos últimos 8 dígitos do telefone, contra o CRM e as pastas de prévia existentes.

## Freio de Instagram (padrão, vale para todos os agentes juntos)

- **1 requisição por vez na máquina inteira** (trava de arquivo), **intervalo mínimo** entre requisições (padrão 20 s), **sem login e sem cookie**.
- Bloqueio (429, redirect para login, página de desafio, página vazia): grava **resfriamento global** (padrão 20 min) e sai com código 3. O agente **não insiste**: segue sem Instagram (Google, Maps, Linktree, Facebook, link da bio, posts já baixados) e anota no recibo.
- No máximo ~6 requisições por lead. Imagens do CDN baixam direto, sem o freio.
- Nunca curl ou navegador direto em instagram.com, nunca o navegador logado do usuário.

Implementação de referência: `scripts/ig-get.py` (detalhes em `references/instagram-freio.md`).

## Fase 2: construção da prévia

- Checagem rápida antes (ativo + sem site). Reprovou: pare e devolva "REPROVADO: motivo".
- **Fatos só do que foi lido.** Nada de preço, depoimento, anos de mercado ou serviço inventado.
- **Hero com foto real do negócio, sem formulário e sem botão de contato.** O pedido vem depois que a pessoa entendeu o que é.
- No mínimo ~5 seções reais. A página resolve o pedido do nicho: encomenda, orçamento ou agenda com data viram um botão que abre o WhatsApp com o pedido escrito (data com ano, lista com um "e" só).
- Fotos reais e nítidas, sem repetir (nem a mesma cena). Foto de banco só em último caso e rotulada.
- **Favicon e apple-touch = logo real** (avatar do perfil, original guardado).
- Nada escondido esperando IntersectionObserver, sem `scroll-behavior: smooth` global, `noindex` enquanto for prévia.
- `roteiro.md` com a seção `## Mensagens` (formato em `references/disparo.md`). **A Msg 2 só cita o que existe na página.**

## Fase 3: revisão de gosto, corte nota 8

Um advisor **adversarial e honesto** (modelo forte, esforço alto) avalia a prévia com prints em 390x844 e 1440x900 e medição: nitidez, contraste AA, alvo de toque >= 44 px, overflow, console limpo, OG, favicon, mensagem do WhatsApp gerada e roteiro sem nada inventado. Cara de IA, genérico, texto demais ou foto de banco óbvia reprovam.

Veredito com schema fixo: `{aprovado, nota, problemas[], manter[], veredito}`. Aprovado se nota >= 8. Problemas específicos e acionáveis (máx. 8), em ordem de impacto.

Loop de ajuste (até 3 voltas):

1. Antes de cada volta, **backup** de `index.html` em `_interno/<slug>/_antes-ajuste-vN.html`.
2. O ajustador corrige todos os problemas em ordem de impacto **sem regredir** o que está em `manter`.
3. Revisa de novo. **Se a nota piorou, a próxima volta começa restaurando o backup** e corrige com mudanças pontuais.
4. Não chegou a 8 em 3 voltas: não publica. Registra no CRM a nota e os 2 problemas principais.

Detalhe e critérios em `references/previa-e-nota8.md`. Exemplo genérico de script de Workflow em `references/workflow-nota8-exemplo.js`.

## Fase 4: publicação

- Só publica o que passou na nota 8 (ou o que o usuário aprovou explicitamente).
- **OG 1200x630 com foto real nítida do negócio**, < 64 KB, nome de arquivo versionado (`og-vN.jpg`), nunca querystring. Sem foto ou pixelada reprova; logo em fundo cinza fica vazio.
- **Favicon = logo real.** `robots.txt` bloqueando indexação enquanto for prévia.
- Oráculo no ar: URL responde 200, `og:image` responde 200 `image/jpeg`, cada imagem do HTML servido responde 200.
- No fim: `crm.py set <slug> previa.url ...`, `previa.publicada true` (e `previa.appId` se houver). Detalhe em `references/publicacao.md`.

## Fase 5: disparo (Msg 1, 2, 3 e follow-up)

Um a um, pelo próprio WhatsApp, em dia útil e horário comercial. **Nada depois das 18h** nem domingo.

1. **Msg 1**: só a saudação ("Bom dia, tudo bem?" / "Boa tarde, tudo bem?"). Espere uns segundos para ver se cai em robô.
2. **Msg 2 (licença)**: quem é, o que montou para esse negócio com 2 ou 3 recursos que **existem na página**, e uma pergunta de sim fácil: "Posso te mandar o link pra você ver?". Se caiu em atendente, use a **Msg 2 atendente**: peça só repasse, melhor horário ou quem cuida da divulgação. Nunca pergunta de interesse, preço ou decisão para atendente.
3. **Msg 3 (link)**: só depois do "pode". Junto: "É uma proposta, não aparece no Google, só quem tem o link vê."
4. **Follow-up**: sem resposta em ~2 dias, o link vai no follow-up, já apresentado. Depois disso, no máximo uma mensagem de encerramento com saída fácil. Para.

Regras duras:

- **Nunca dizer "vocês não têm site"** (nem afirmar fato sem conferir).
- **"Não" é não**: agradeça em 1 frase e pare. No CRM: `move <slug> perdido --motivo "..."`.
- **Contato só de canal publicado** pelo próprio negócio. Primeiro contato pede o responsável por divulgação, nunca chama o dono pelo nome.
- Sem preço, áudio frio, "sem compromisso nenhum" ou "fico à disposição" na abertura.
- Envio é do usuário. O agente prepara, o usuário manda, o agente marca: `crm.py enviada <slug> m1|m2|m2a|m3|fu`.

Textos de exemplo e formato do `roteiro.md` em `references/disparo.md`.

## Fase 6: fechamento

Quando o lead responde com interesse ou pergunta preço:

- **Pergunta de próximo passo concreta**, nunca "o que achou?". Ex.: "Posso começar? Me manda as fotos e o cardápio que eu deixo no ar essa semana."
- **Tire o risco**: paga a 1ª parte ao aprovar a página. Formato de exemplo: R$ 500, metade para começar e metade quando estiver no ar (valor configurável).
- **Parcelamento só depois de objeção de preço**, nunca na primeira apresentação. Nada de "a gente é flexível".
- **Ofereça uma ligação de 5 minutos**: "Posso te ligar 5 minutinhos pra te mostrar?"
- Data real quando for verdade (temporada, data do evento), nunca escassez inventada. Não prometa prazo em dias antes de receber o material.

Proposta de exemplo, pagamento e entrega em `references/fechamento.md`.

## CRM: o que registrar em cada fase

| Momento | Comando |
|---|---|
| Lead aprovado e prévia construída | `crm.py add <slug> --nome ... --cidade ... --nicho ... --instagram ... --whatsapp 55DDDNUMERO --tags <lote>` |
| Prévia não chegou a 8 | `crm.py nota <slug> "nota 7,5 em <data>, não publicada: <2 problemas>"` |
| Publicada | `crm.py set <slug> previa.url <url>` e `crm.py set <slug> previa.publicada true` |
| Usuário mandou | `crm.py enviada <slug> <fase>` |
| Chegou resposta (print ou tela) | `crm.py msg <slug> --de eles --quando "..." --texto "..." --fonte print` |
| Pediu preço / proposta enviada | `crm.py set <slug> proposta.valor 500`, `move <slug> proposta` |
| Retomar numa data | `crm.py cobrar <slug> --em "AAAA-MM-DD 10:00" --motivo "..." --texto "..."` |
| Recusou | `crm.py move <slug> perdido --motivo "..."` |
| Fechou | `crm.py move <slug> ganho` |

Regras do agente no CRM: sempre pela CLI, um comando por vez, registrar no mesmo turno, mensagem só de print ou da tela (`--fonte`), nunca inventar mensagem nem hora.

## Orquestração com vários agentes

Lote (muitos leads, várias fases) roda melhor como pipeline com schema nos vereditos e volta automática quando reprova:

- Concorrência limitada (ex.: no máximo 4 ou 5 construções ao mesmo tempo).
- Navegador headless: 1 por agente, no máximo 2 abas, fechar ao terminar. Prints fora da pasta publicável (`_interno/`).
- Instagram sempre pelo freio global.
- Fechamento do lote em um agente só, serial: CRM, tabela do lote, ordem de envio sugerida (alternando cidade e nicho).
- Nenhum agente do lote publica sem passar na nota 8, e nenhum manda mensagem.

## Referências

- `references/busca-e-checagem.md`: critérios, consultas, schema da ficha, dedup.
- `references/previa-e-nota8.md`: checklist de construção e de revisão, loop de ajuste.
- `references/publicacao.md`: OG, favicon, robots, oráculo no ar.
- `references/disparo.md`: formato do `roteiro.md`, textos de exemplo, atendente, follow-up.
- `references/fechamento.md`: proposta, pagamento, objeção, entrega.
- `references/instagram-freio.md`: freio global e `scripts/ig-get.py`.
- `references/workflow-nota8-exemplo.js`: script de Workflow genérico (ajustar, revisar, publicar, fechar).
