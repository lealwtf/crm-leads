# Fase 4: publicação

Publique onde preferir (servidor próprio com nginx, hospedagem estática, plataforma de deploy). O padrão de endereço sugerido é `<slug>.seudominio.com.br`, com certificado curinga.

## Antes de publicar

- Prévia aprovada na nota 8 (ou aprovação explícita do usuário).
- `og:image` apontando para `og-vN.jpg` (nome versionado; WhatsApp guarda cache da imagem antiga e querystring não resolve).
- OG: 1200x630, < 64 KB, **foto real nítida do negócio**. Sem foto, foto pixelada ou logo sozinho em fundo cinza reprovam.
- Favicon e apple-touch = logo real.
- `robots.txt` com `Disallow: /` e `<meta name="robots" content="noindex">` enquanto for prévia.
- Fontes externas declaradas (se o seu processo de publicação embute ou copia as fontes).

## Oráculo no ar

```bash
curl -sI https://<slug>.seudominio.com.br | head -1            # 200
curl -sI https://<slug>.seudominio.com.br/og-v2.jpg | grep -i content-type   # image/jpeg
# cada <img src> e background do HTML servido responde 200
```

Algo falhou 2x: pare e descreva o erro, não improvise em outra app ou outro domínio.

## Depois

```bash
python3 crm.py set <slug> previa.url https://<slug>.seudominio.com.br
python3 crm.py set <slug> previa.publicada true
python3 crm.py set <slug> previa.appId <id-da-app>    # se a sua plataforma tiver
```

Nada é enviado ao lead nesta fase.

## Quando fechar

- Trocar para o domínio do cliente, tirar `noindex` e o `Disallow`.
- Não apagar as outras prévias sem falar com o dono do processo.
