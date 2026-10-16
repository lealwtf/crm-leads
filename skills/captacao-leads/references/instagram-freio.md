# Freio de Instagram

Instagram bloqueia rápido quem faz muitas requisições sem login. Vários agentes em paralelo multiplicam o problema. O freio é **global da máquina**, não por agente.

## Regras (padrão)

| Regra | Padrão | Variável |
|---|---|---|
| 1 requisição por vez na máquina | trava de arquivo | `IG_FREIO_DIR` (pasta do estado; padrão a pasta temporária do sistema) |
| Intervalo mínimo entre requisições | 20 s | `IG_INTERVALO` |
| Resfriamento global após bloqueio | 20 min | `IG_RESFRIAMENTO` |
| Sem login, sem cookie | sempre | |
| Máximo por lead | ~6 requisições | (regra do briefing) |

Bloqueio = HTTP 429, redirect para `accounts/login`, página `challenge`, ou 200 sem conteúdo útil. O script grava o resfriamento para **todos** e sai com **código 3**. O agente não insiste: segue com Google, Maps, Linktree, Facebook, link da bio ou posts já baixados, e anota no recibo.

## Uso

```bash
python3 scripts/ig-get.py https://www.instagram.com/<perfil>/ perfil.json
python3 scripts/ig-get.py https://www.instagram.com/p/<code>/embed/captioned/ post.json
echo $?    # 0 ok, 3 resfriamento/bloqueio
```

- Por padrão busca com `urllib` (sem dependência). Para páginas que só renderizam com JavaScript, instale `playwright-core` e um Chrome/Chromium e use `IG_NAVEGADOR=1`: o script chama `scripts/ig-pw.mjs` (headless, contexto anônimo novo, sem login). Caminho do módulo: `PLAYWRIGHT_CORE=/caminho/para/playwright-core/index.mjs` se não estiver resolvível.
- `IG_CANAL` (aceita também `CHECAR_CANAL`; só com `IG_NAVEGADOR=1`): `chrome` (padrão) usa o Chrome instalado na máquina; `chromium` usa o Chromium baixado pelo Playwright (`npx playwright-core install chromium`). Use `chromium` quando não houver Chrome instalado (servidor, CI, container).
- Saída com navegador: JSON com `status, final, title, meta, text, imgs, datas, posts, links`.
- Imagens do CDN (`cdninstagram`, `fbcdn`) baixam direto, sem o freio.

## Proibido

- curl ou navegador direto em instagram.com sem passar pelo script.
- Navegador logado do usuário, automação de tela, abrir o perfil na máquina do usuário.
- Insistir depois do código 3.
