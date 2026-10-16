# crm-leads

Mini CRM local para prospecção de pequenos negócios pelo WhatsApp: funil kanban, réplica da conversa de cada lead, fila de envio, cobranças (follow-up) com lembrete e uma CLI pensada para um agente de IA (qualquer harness de agente) operar e alimentar o CRM por você.

- Só Python 3 (stdlib). Sem banco, sem dependência, sem conta em serviço nenhum.
- Fonte única: um arquivo JSON (`crm.json`) na pasta de dados, com backup automático a cada escrita.
- Página web local (127.0.0.1) que relê o arquivo a cada 3 s: o que a CLI grava aparece sozinho.
- Painel de números (funil, taxas de passagem, gráficos por dia e por nicho, onde os leads negam, aberturas da prévia).
- Junto vem a skill `captacao-leads` (em `skills/`), que documenta o fluxo inteiro de captação: busca, prévia, revisão "nota 8", publicação, disparo e fechamento.

## Instalação

Precisa de Python 3.9 ou mais novo. Nada para instalar.

```bash
git clone <este repo> crm-leads && cd crm-leads
mkdir -p data
cp exemplo/crm.json data/crm.json     # opcional: começa com 4 leads fictícios
export CRM_PREVIAS=exemplo/previas        # com o exemplo: sem isso `python3 crm.py textos doceriaaurora` mostra a Msg 2 como '(sem texto)'
```

Sem `data/crm.json`, o CRM começa vazio e cria o arquivo na primeira escrita.

## Configuração (variáveis de ambiente)

| Variável | Padrão | Para que serve |
|---|---|---|
| `CRM_DIR` | `./data` (pasta do repo) | Pasta dos dados: `crm.json`, `backups/`, `servidor.log` |
| `CRM_DADOS` | `<CRM_DIR>/crm.json` | Caminho direto do arquivo (vence `CRM_DIR`) |
| `CRM_PORTA` | `4180` | Porta do servidor web |
| `CRM_PREVIAS` | `./previas` | Opcional. Pasta das prévias: `<CRM_PREVIAS>/<slug>/roteiro.md` traz os textos das mensagens |
| `CRM_HOJE` | (agora) | Simula a data/hora em teste: `2026-10-20` ou `2026-10-20 09:30` |
| `CRM_SEM_LEMBRETE` | (vazio) | `1` desliga o lembrete do servidor (útil em teste) |
| `CRM_CHECAR_S` | `60` | Intervalo do lembrete, em segundos |
| `CRM_LOG` | (vazio) | `1` liga o log HTTP do servidor |
| `CRM_CIDADES` | (vazio) | Opcional. Junta grafias da mesma cidade no Painel: `Sigla=prefixo1\|prefixo2;Outra=prefixo` |
| `CRM_AGENTES_GLOB` | (vazio) | Opcional. Glob de journals JSONL do seu harness de agente; liga a lista "Agora" do Painel (formato no topo de `servidor.py`) |
| `CRM_LOG_MD` | (vazio) | Opcional. Markdown de log do dia a dia; o Painel mostra as linhas `- dd/mm hh:mm texto` |
| `CRM_IG_ESTADO` | (vazio) | Opcional. JSON do freio do Instagram (`<IG_FREIO_DIR>/ig-freio.json` do `ig-get.py`); mostra se está em pausa |
| `CRM_VIGIA_ZAP` | (vazio) | `1` liga o `vigia-zap.sh` dentro do `vigias.sh` (só macOS + Chrome) |
| `CRM_ACESSOS_CMD` | (vazio) | Opcional. Comando seu que o `vigias.sh` roda a cada 2 min para gravar aberturas da prévia |

## Rodar

```bash
./abrir.sh                  # sobe o servidor (se não estiver de pé) e abre o navegador
./abrir.sh --sem-abrir
python3 servidor.py         # direto, em primeiro plano (Ctrl+C para)
CRM_PORTA=4190 CRM_DIR=/tmp/teste python3 servidor.py   # outra porta, outros dados
```

A página tem: **Painel** (só leitura: números do funil, filtro por recorte, período pela Msg 1, cidade e nicho guardado no endereço `#painel?...`, gráfico por dia, rosca por nicho, onde negam, tabela por nicho, lista de leads ordenável e o bloco de tempo real com últimas respostas e aberturas da prévia; relê `GET /api/painel` a cada 4 s), **Hoje** (responder, cobrar, prazos), **Funil** (kanban; arrastar card muda a etapa), **Fila de envio** (um lead por vez com a Msg 1: Copiar, Abrir no WhatsApp, Enviei, Pular) e **Contatos**. No painel de cada negócio: resumo, conversa do WhatsApp, mensagens por fase (Copiar, Abrir no WhatsApp, Marcar enviada, Desfazer) e cobranças.

## CLI

```bash
python3 crm.py add doceria --nome "Doceria X" --cidade "Cidade" --nicho confeitaria --whatsapp 5500000000000 --contato "Fulana" --papel dono
python3 crm.py add doceria --from-json lead.json   # campos (nome, cidade, nicho, instagram, whatsapp, tags, etapa, nota) vêm do arquivo
python3 crm.py set doceria previa.url https://doceria.seudominio.com.br
python3 crm.py set doceria proposta.valor 500
python3 crm.py set doceria proximo_passo "Mandar a proposta"
python3 crm.py set doceria proximo_em 2026-10-14
python3 crm.py set doceria textos.m2 --from-file m2.txt   # valor lido de arquivo (texto de terceiros fora do shell)
python3 crm.py contato doceria --nome "Sócia" --papel sócio --whatsapp 5500000000000 --fonte print
python3 crm.py msg doceria --de eles --quando "2026-10-13 10:39" --texto "quanto fica?" --fonte print
python3 crm.py msg doceria --de eu --quando "2026-10-13 10:45" --texto "Segue a proposta" --anexo propostas/doceria.pdf --fonte whatsapp-tela
python3 crm.py nota doceria "Pediu pra chamar depois do almoço"
python3 crm.py move doceria proposta
python3 crm.py move doceria perdido --motivo "sem resposta"
python3 crm.py move doceria retomar --em 2026-10-20
python3 crm.py show doceria [--msgs 10]
python3 crm.py list [--etapa respondeu]
python3 crm.py hoje                         # responder + cobranças vencidas/de hoje + prazos, em ordem
python3 crm.py fila                         # quem falta a Msg 1 + quem falta a Msg 2
python3 crm.py textos doceria               # texto de cada fase e de onde veio
python3 crm.py enviada doceria m1 [--quando "13/10 13:30"] [--desfazer]   # fases: m1 m2 m2a m3 fu
python3 crm.py cobrar doceria --em "2026-10-20 09:00" --motivo "Volta de viagem" --texto "Oi, tudo bem? ..."
python3 crm.py feita doceria [c1]           # sem id: a cobrança aberta mais antiga
python3 crm.py adiar doceria c1 --em amanha # ou "+3", "22/10 10:00"
python3 crm.py contato-novo --nome "Fulana" --whatsapp 5500000000000 [--negocio slug --papel dono]
python3 crm.py contatos [--busca fulana]
python3 crm.py contato-set k1a2b3c4 negocio doceria
python3 crm.py import-json [--so-novos] lote.json   # lista de negócios ou {"negocios": ...}; mescla por slug
python3 crm.py rm doceria
```

`python3 crm.py <comando> --help` mostra as opções de cada um.

- `--quando` aceita `2026-10-13 10:39` ou `13/10 10:39`. `--em` aceita também só a data (vira 09:00), `amanha` ou `+3` (10:00).
- `msg` ignora mensagem idêntica (mesmo lado, hora e texto): dá pra reprocessar um print sem duplicar. Repetida de verdade: `--forcar`.
- Campos de `set`: `nome`, `cidade`, `nicho`, `instagram`, `tags` (a,b), `proximo_passo`, `proximo_em`, `motivo_perda`, `previa.url`, `previa.appId`, `previa.publicada`, `previa.og`, `proposta.valor`, `proposta.forma`, `proposta.pdf`, `proposta.enviada_em`, `textos.<fase>` (texto só deste negócio; `""` volta ao roteiro).

## Modelo de dados

`crm.json` (indent 2, chaves ordenadas):

```text
{ versao, negocios: { <slug>: Negocio }, contatos_avulsos: [Contato] }

Negocio: slug, nome, cidade, nicho, instagram, tags[]
  etapa, etapa_desde, etapa_desde_fonte, criado_em, atualizado_em
  contatos[]:  {id, nome, papel (dono|atendente|sócio|outro), whatsapp, nota, fonte}
  previa:      {url, appId, publicada, og}
  proposta:    {valor, forma, pdf, enviada_em}
  mensagens[]: {id, de (eu|eles), quando, texto, anexo, fonte (print|whatsapp-tela|manual|marcado)}
  eventos[]:   {quando, texto, envio?}       histórico ("Prévia pronta → Abordado", notas)
  envios:      {m1|m2|m2a|m3|fu: {quando, ...}}   fases marcadas como enviadas
  textos:      {fase: "texto só deste negócio"}
  cobrancas[]: {id, quando, motivo, texto_sugerido, feita, feita_em, auto, notificada_em}
  acessos[]:   {q, t (abriu|previa_gerada), d (celular|desktop), v (hash curto do visitante)}   aberturas da prévia
  proximo_passo, proximo_em, motivo_perda
```

O slug é o identificador e também o nome da pasta da prévia (`<CRM_PREVIAS>/<slug>/`).

### Etapas

`previa` (Prévia pronta) → `abordado` (Msg 1/2) → `respondeu` → `link` (Link enviado) → `proposta` (Proposta enviada) → `negociando` → `ganho`. Fora da linha: `perdido` (com `--motivo`) e `retomar` (com `--em`).

`etapa_desde` grava quando o negócio entrou na etapa atual; o quadro ordena cada coluna do mais novo na etapa para o mais velho.

### Mensagens por fase

Cinco fases: `m1` (saudação), `m2` (licença: quem é, o que montou, "posso te mandar o link?"), `m2a` (versão para atendente), `m3` (link) e `fu` (follow-up).

- `m1` é "Bom dia, tudo bem?" antes das 12h e "Boa tarde, tudo bem?" depois.
- `m2`, `m2a`, `m3` e `fu` vêm ao vivo do `roteiro.md` da prévia, seção `## Mensagens` (veja `exemplo/previas/doceriaaurora/roteiro.md`): cada `### Msg N` abre um bloco, só as linhas com `>` entram, nota interna entre parênteses fica de fora e `(Junto: "...")` entra na mensagem. Sem roteiro: `m3` usa a URL da prévia e `fu` usa um texto padrão.
- **Marcar enviada** grava a mensagem no histórico (lado eu, fonte `marcado`) e move o funil para frente: `m1`/`m2`/`m2a` → Abordado, `m3` → Link enviado. Nunca move para trás. `fu` resolve a cobrança aberta mais antiga. Desfazer volta tudo.

## Cobranças

- Manual: `cobrar`, `feita`, `adiar`.
- Regra de horário: nada depois das 18:00 nem domingo. Cobrança marcada fora disso vai para o próximo dia útil às 10:00 (a CLI avisa "empurrada").
- Sugestões automáticas (`auto: true`): Abordado com 2+ envios sem resposta → D+2 10:00; Link enviado sem resposta → D+1 (com o texto padrão de follow-up: uma pergunta útil, sem cobrar resposta); Proposta sem resposta → D+3; Retomar com data → nessa data 09:00. Somem sozinhas quando chega mensagem nova, a etapa muda ou existe cobrança manual aberta.
- Lembrete: com o servidor de pé, a cada minuto ele cria as sugestões e avisa cada cobrança vencida uma vez (notificação do macOS; em outro sistema, linha no log), só entre 08:00 e 18:00. Sem servidor: `./lembrete.sh` no início do dia. Para rodar sozinho, um exemplo de crontab: `30 8 * * 1-6 /caminho/crm-leads/lembrete.sh >/dev/null 2>&1`.

## Vigias

Scripts que ficam rodando e imprimem 1 linha por evento, bons para um agente ou um terminal acompanhar:

- `python3 vigia-m3.py`: lead que recebeu a Msg 3 (link) e ainda não tem proposta (`MSG3 ...`).
- `python3 vigia-pub.py`: prévia publicada que ainda não recebeu a Msg 1 (`PUB ...`; já abordado sai `PUB-ABORDADO`).
- `./vigia-zap.sh` (opcional, só macOS com Google Chrome e o WhatsApp Web aberto): lê só o título da aba e avisa quando as não lidas sobem (`ZAP ...`), das 9h às 18h, seg a sáb.
- `./vigias.sh`: sobe os vigias num processo só. `CRM_VIGIA_ZAP=1` inclui o do WhatsApp; `CRM_ACESSOS_CMD` roda, a cada 2 min, um comando seu que lê o log de acesso das prévias e grava as aberturas com `crm.op_acessos(d, slug, regs)` (cada abertura nova vira o evento "Abriu a prévia"). Sem ele, o resto do CRM funciona igual.

O estado de cada vigia fica em `<CRM_DIR>` (`.m3-vistos.json`, `.pub-vistos.json`, `.vigia-zap.*`).

## Backup

- Cada escrita copia o arquivo anterior para `<CRM_DIR>/backups/crm-AAAAMMDD-HHMMSS-*.json` (ficam os 30 últimos).
- Restaurar: pare o servidor, `cp data/backups/<arquivo>.json data/crm.json`.
- Backup externo: copie a pasta `data/` inteira (ou aponte `CRM_DIR` para uma pasta sincronizada). `data/` está no `.gitignore` de propósito: dado de lead (nome, telefone, conversa) não vai para o git.

## Testes

```bash
python3 teste_envio.py      # roda numa cópia de exemplo/crm.json, nunca nos seus dados
./exemplo/gerar-exemplo.sh  # regera os dados de exemplo usando só a CLI
```

## Usando com um agente

O CRM foi feito para o agente preencher quase tudo pela CLI enquanto você só olha a página. `AGENTS.md` aponta para esta seção e vale para qualquer harness de agente.

### Prompts prontos

- "Registre que a Doceria Aurora respondeu 'pode mandar sim' às 11:02 de hoje (print abaixo)."
- "O que tenho pra cobrar hoje?"
- "Marque a Msg 3 da Pousada Vale Azul como enviada."
- "Cadastre este lead: Studio X, sobrancelha, Cidade Y, WhatsApp da bio 55..., Instagram @..."
- "Leia este print da conversa e registre as mensagens novas no CRM."
- "A dona do Studio Lírio pediu pra chamar dia 20. Crie a cobrança com o texto pronto."
- "Quem está na fila de envio? Me dá a Msg 1 do próximo."
- "Mova o Ateliê Fio de Ouro pra perdido: disse que não tem interesse."

### Regras para o agente

1. **Sempre pela CLI** (`python3 crm.py ...`). Nunca editar `crm.json` na mão: a CLI trava o arquivo, normaliza, faz backup e mantém `etapa_desde`, cobranças automáticas e eventos coerentes. Um comando por vez (serial).
2. **Registrar no mesmo turno**: aconteceu algo (resposta, envio, pedido de preço, recusa), grava no CRM antes de responder ao usuário.
3. **Fonte de cada mensagem**: só entra no histórico o que veio de um print enviado pelo usuário (`--fonte print`) ou do que o agente viu na tela do WhatsApp (`--fonte whatsapp-tela`). Envio marcado pela fila é `marcado`; digitado pelo usuário é `manual`. Nunca inventar mensagem. Hora que não aparece no print fica de fora ou vai com a hora visível mais próxima, nunca chutada.
4. **Envio é do usuário**: o agente prepara texto e marca como enviada quando o usuário confirmar que mandou. Não mande mensagem por conta própria.
5. **Horário**: nada depois das 18h nem domingo. Se o usuário pedir algo fora disso, avise ("melhor amanhã") e agende com `cobrar`.
6. **"Não" é não**: recusa clara vira `move <slug> perdido --motivo "..."`, sem cobrança.
7. **Antes de agir, leia**: `show <slug>` para o histórico, `hoje` para a agenda, `fila` para o próximo envio.
8. Contato só de canal publicado pelo próprio negócio (bio, link da bio, Maps, site). Telefone sempre com DDI e DDD, só dígitos.
9. Dado de lead é pessoal: não copie `data/` para fora da máquina nem para o git.

O fluxo completo de captação (como achar o lead, montar a prévia, revisar, publicar, disparar e fechar) está na skill [`skills/captacao-leads/SKILL.md`](skills/captacao-leads/SKILL.md).

## Instalando a skill

A skill é uma pasta com `SKILL.md` (frontmatter `name` e `description`) e referências. Copie `skills/captacao-leads/` para a pasta de skills do seu harness de agente (global ou do projeto), ou aponte o agente para `skills/captacao-leads/SKILL.md` no briefing.

## Licença

MIT. Veja `LICENSE`.
