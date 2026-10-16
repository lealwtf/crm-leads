# Fase 1: busca e checagem

## Alvo

Negócio local pequeno, ativo, sem site próprio, com WhatsApp publicado pelo próprio negócio, em que quem decide atende o WhatsApp.

Sinal real de compra (calibre com o seu CRM): quem responde e pede preço costuma vender por **encomenda, orçamento ou agenda com data** (confeitaria, buffet pequeno, pousada, moda pequena, tatuador, pizzaria, profissional autônoma com agenda). Quem costuma recusar por preço: mensalidade (escola, curso), construção, contabilidade, revenda de eletrônicos, academia, eventos grandes com agência. Isso é **exemplo**: troque pelo que o seu histórico mostrar (`crm.py list --etapa perdido` e os motivos).

## Critérios (todos obrigatórios)

| Critério | Como conferir | Reprova se |
|---|---|---|
| Ativo | post próprio nos últimos ~30 dias (data do post pelo freio de IG ou pela página do Facebook) | só post fixado, ou último post antigo |
| Sem site próprio | `dig +short nome.com.br`, `nome.com`, variações sem acento; RDAP do registro; 1 busca na web; link da bio | site próprio no ar (confira se é do mesmo negócio) |
| Contato publicado | bio, link da bio, Google Maps, ficha do negócio | só número de lista de terceiros |
| Pequeno, dono atende | bio, legendas, tom das respostas | franquia, rede, agência |

Nunca afirme "não tem site" sem conferir. Domínio com nome parecido pode ser de outro negócio em outra cidade.

## Como buscar

- Busca na web: "<nicho> em <cidade>", listas "melhores X em <cidade>", Google Maps em texto, diretórios locais, Linktree.
- Instagram: só pelo freio (`scripts/ig-get.py`). Perfil `https://www.instagram.com/<perfil>/` traz bio e seguidores; post `https://www.instagram.com/p/<code>/embed/captioned/` traz data e legenda.
- Um buscador por (cidade x grupo de nicho) paraleliza bem. Meta por buscador: poucos aprovados bons (ex.: até 6).

## Ficha do lead (schema)

```json
{
  "nome": "Doceria Exemplo",
  "slug": "doceriaexemplo",
  "cidade": "Cidade, UF",
  "nicho": "confeitaria",
  "ig": "doceria.exemplo",
  "ultimoPost": "2026-10-10",
  "whatsapp": "5500000000000",
  "fonteContato": "bio do Instagram",
  "site": "",
  "fatos": ["bolos de festa sob encomenda", "entrega no bairro"],
  "posts": ["ABC123", "DEF456"],
  "angulo": "pedido de bolo com data direto no WhatsApp",
  "nota": 8
}
```

Obrigatórios: `nome, slug, cidade, nicho, ig, whatsapp, fonteContato, fatos, angulo, nota`.

- `slug`: curto, sem hífen nem acento, único (confira o CRM e a pasta de prévias).
- `fatos`: só o que foi lido (3 a 6).
- `posts`: códigos de posts com foto boa e sem rosto de cliente.
- `nota`: chance de responder e fechar, 0 a 10. Construa a partir de ~7,5.

## Deduplicação

Chave dupla: slug normalizado (`[a-z0-9]`) e últimos 8 dígitos do telefone. Exclua quem já está no CRM (`crm.py contatos --busca`, `crm.py list`), em arquivos de lote anteriores ou com pasta de prévia.

## Saída

Tabela por buscador (aprovados com fontes, reprovados com motivo) e a lista de aprovados no schema acima. Ninguém é contatado nesta fase.
