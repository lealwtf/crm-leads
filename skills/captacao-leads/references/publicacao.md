# Publicação

Publique onde preferir (servidor próprio com nginx, hospedagem estática, plataforma de deploy). Padrão de endereço sugerido: `<slug>.seudominio.com.br`, com certificado curinga.

## Interface esperada do seu comando de publicar

O fluxo só precisa de **um comando que recebe a pasta da prévia e devolve a URL**:

```bash
./publicar.sh previas/<slug>      # imprime https://<slug>.seudominio.com.br e sai 0; falha = rc != 0 com o erro
```

- Idempotente: rodar de novo atualiza a mesma prévia (mesma URL), sem criar outra.
- Publica `index.html` (ou `_publicar.html`), `og-vN.jpg`, `robots.txt`, `favicon.png` e `apple-touch-icon.png`. Nunca publica `_raw/` nem `_interno/`.
- Se a plataforma tiver um id da app, grave no CRM (`previa.appId`).
- Hospedagem que recebe 1 arquivo só: rode antes `scripts/montar-publicar.py <slug>` (imagens viram data URI, fontes viram 1 `<link>` do Google Fonts) e publique o `_publicar.html` com o OG e o `robots.txt` ao lado.

## Antes de publicar

- Verificador passando (`scripts/checar-previa.mjs`, `ok_total: true`).
- OG aplicada com `scripts/aplicar-og.py <slug> og.json`: `og:image` apontando para `og-vN.jpg` (nome versionado; o WhatsApp guarda cache da imagem antiga e querystring não resolve).
- OG: 1200x630, < 64 KB, **foto real nítida do negócio**. Sem foto, foto pixelada ou logo sozinho em fundo liso reprovam.
- Favicon e apple-touch = logo real.
- `robots.txt` de prévia e `<meta name="robots" content="noindex">`.

## Oráculo no ar

```bash
curl -sI https://<slug>.seudominio.com.br | head -1                        # 200
curl -sI https://<slug>.seudominio.com.br/og-v2.jpg | grep -i content-type  # image/jpeg
# cada <img src> e background do HTML servido responde 200
```

Algo falhou 2x: pare e descreva o erro, não improvise em outra app ou outro domínio.

## Depois

```bash
python3 crm.py set <slug> previa.url https://<slug>.seudominio.com.br
python3 crm.py set <slug> previa.publicada true
python3 crm.py set <slug> previa.appId <id-da-app>    # se a sua plataforma tiver
```

Nada é enviado ao lead nesta fase. Prévia de lead perdido pode ser desligada para poupar recurso do servidor; não apague sem falar com o dono do processo.

## Quando fechar

Trocar para o domínio do cliente, tirar `noindex` e o `Disallow`.
