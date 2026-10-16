# Verificador automático de prévia (`scripts/checar-previa.mjs`)

Portão mecânico que roda **antes** de qualquer revisão por modelo e antes de publicar. Não chama modelo nenhum: sobe a pasta da prévia num servidor local, abre num Chrome headless e mede. Tudo que ele mede, o revisor não precisa medir de novo; o revisor fica só com gosto, verdade da copy e foto certa.

## Instalação

```bash
cd <raiz do clone do crm-leads>
npm i                            # instala o playwright-core pinado no package.json, sem baixar navegador
# precisa do Google Chrome instalado; sem Chrome:
npx playwright-core install chromium && export CHECAR_CANAL=chromium   # vale também para ig-pw.mjs e baixar-grid.py (IG_CANAL vence nesses dois)
```

Rode o `npm i` na raiz do clone (onde está o `package.json`). O script também procura o `playwright-core` em `node_modules` a partir da pasta onde o comando roda.

Também precisa de `python3` no PATH (servidor local) e Node 18 ou mais novo.

## Uso

```bash
# sempre da raiz do clone, sempre com --previas
node skills/captacao-leads/scripts/checar-previa.mjs <slug> --previas=<pasta> --wa=55DDDNUMERO           # texto, rc 0 = passou
node skills/captacao-leads/scripts/checar-previa.mjs <slug> --previas=<pasta> --json --wa=55DDDNUMERO    # {slug, ok_total, falhas[], avisos[]}
```

Teste rápido com a prévia fictícia que acompanha o repositório (deve terminar com rc 0):

```bash
node skills/captacao-leads/scripts/checar-previa.mjs doceriaaurora --previas=exemplo/previas --wa=5500000000001; echo rc=$?
```

| Opção | Variável | Padrão | Para que serve |
|---|---|---|---|
| `--previas=<pasta>` | `PREVIAS_DIR` | `./previas` | onde ficam as pastas `<slug>/` |
| `--portas=A-B` (ou `N`) | `CHECAR_PORTAS` | `8800-8899` | faixa do servidor local (só 127.0.0.1; nunca reusa porta ocupada) |
| `--wa=<dígitos>` | | | WhatsApp da ficha; todo `wa.me` da página tem que bater |
| `--demo=<regex>` | `CHECAR_DEMO` | | texto que denuncia sobra do kit de partida (ex.: a saudação do exemplo) |
| | `PLAYWRIGHT_CORE` | resolve do clone ou da pasta atual | caminho de `playwright-core/index.mjs` se não estiver no projeto |
| | `CHECAR_CANAL` | `chrome` | `chrome`, `msedge` ou `chromium` |
| | `CHROME_PATH` | | executável do navegador (vence o canal) |

rc: `0` tudo ok, `1` alguma falha, `2` erro de uso (slug, pasta, playwright ausente).

Custo de máquina: 1 navegador, 1 aba por vez, fecha tudo no fim (mesmo com erro). Pode rodar em paralelo em agentes diferentes porque cada um pega uma porta livre.

## Convenções que ele lê

- `<slug>/index.html` (a prévia), `og-vN.jpg`, `favicon.png`, `apple-touch-icon.png`.
- `<slug>/_raw/perfil.json` (bio do perfil) e `<slug>/_raw/spec.json` (campo `registro` e `fonte_fatos`): de onde ele tira número de conselho.
- `<slug>/msg3.txt`: texto da Msg 3, conferido contra a página.
- Formulário de pedido (obrigatório: sem ele `form-pedido` e `balao-celular` reprovam): o `<form>` com mais campos (2 ou mais). Mensagem lida do `href` de `wa.me` / `api.whatsapp.com` com `text=`, ou do balão (`[data-msg]`, `.wa-balao`, `#msg`, `#bubble`, `.bolha`, `.bubble`, `.bub`, `.chat`, `#prev`).
- Passos numerados: `<ol class="etapas">` com `<h3>` por passo.
- Opcional: `window.P.parar()` pausa a demo animada antes de mexer no formulário.

## O que reprova (falha = não publica)

| id | Mede | Limite |
|---|---|---|
| `overflow-1440`, `overflow-390` | rolagem horizontal | 0 px |
| `console` | erro de console, exceção, HTTP >= 400 local | 0 |
| `img-nitidez-1440`, `img-nitidez-390` | resolução natural / tamanho exibido | cada foto >= 1,5x, nenhuma quebrada |
| `contraste-1440`, `contraste-390` | texto sobre fundo opaco | >= 4,5:1 (>= 3:1 se grande) |
| `borda-controle-*` | borda ou fundo de campo contra o entorno | >= 3:1 |
| `alvo-44-390` | botão, link, campo no celular | >= 44x44 px |
| `hero-foto` | foto raster grande na 1ª dobra | >= 40% da largura e >= 120 px, nos dois tamanhos |
| `secoes` | blocos reais (section + hero + rodapé com conteúdo) | >= 5 |
| `carrossel` | rolagem lateral | scroll-snap, scroll-padding, 1º card >= 8 px da borda |
| `scroll-padding`, `scroll-behavior` | âncora com nav fixa; smooth global | conteúdo não some sob a nav; sem smooth global |
| `travessao` | travessão no texto visível | 0 |
| `h1-marca`, `h1-corte-*` | h1 existe, difere dos h2, nome da marca em 1 linha, sem corte lateral | |
| `area-morta` | grid/flex a 1440 com buraco | ocupação >= 60% |
| `cena-repetida` | par de fotos grandes parecidas (dHash) | nenhum par com distância <= 5/64 |
| `bastidor` | "foto real entra aqui", placeholder, lorem, TODO, `[foto ...]`, `{var}` | nenhum |
| `registro-confirmar` | número de conselho na bio/spec, mas a página diz "a confirmar" ou em branco | proibido |
| `msg3-registro` | Msg 3 fala de campo "em branco" que a página não tem | proibido |
| `passos-duplicados`, `msg3-duplicada` | título de passo repetido; frase repetida na Msg 3 | 0 |
| `og-image` | existe, 1200x630, < 64 KB, sem querystring, não é cópia da OG de outra prévia | |
| `favicon` | favicon e apple-touch existem; apple-touch >= 180 px | |
| `whatsapp-numero` | todo número `wa.me` = `--wa`; sem sobra do kit (`--demo`) | |
| `noindex` | `<meta name="robots" content="noindex">` | presente |
| `datas-fixas` | data ou ano literal que vence em menos de 60 dias; campo de data sem `new Date()` | nenhum |
| `form-pedido`, `msg-whatsapp` | preenche o formulário: cada opção entra na mensagem, opção anterior sai, mês passado vira o ano seguinte, data passada não entra, sem `undefined`/`NaN`/`null`/" e e " | |
| `balao-celular` | no 390, depois de tocar o 1º chip, o balão da mensagem está na tela | >= 50% visível |

## Avisos (não reprovam, o revisor olha)

Opção de rádio que não aparece na mensagem, h1 de 3+ linhas sem `text-wrap: balance`, OG sem sufixo `-vN`, favicon < 192 px, apple-touch < 512 px, data literal distante, tamanho de fonte fora da escala (12,8 / 16 / 20 / 25 / 31,25 / 39 / 48,8 px), e "a confirmar" sem registro em nenhuma fonte (só vale para número de conselho que não foi achado).

## O que ele NÃO sabe

Se a foto é do negócio certo, se é bonita, se a copy tem fato inventado, se a OG mostra foto real e não logo em fundo liso, se tem cara de modelo pronto. Isso é da revisão (`references/regua-revisor.md`).

## Como usar no fluxo

1. Montou ou ajustou: roda. `ok_total: false` = corrige **pela fonte** (spec, foto, texto) e roda de novo, no máximo 2 voltas.
2. Só depois de `ok_total: true` a prévia vai para publicação e revisão.
3. Revisão nunca mede de novo o que está na tabela acima; se o revisor discordar de uma medida, o erro é do verificador e se corrige o script.
