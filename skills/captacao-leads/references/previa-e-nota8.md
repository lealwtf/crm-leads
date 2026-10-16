# Fases 2 e 3: construção da prévia e revisão nota 8

## Construção (checklist)

- [ ] Checagem rápida antes (ativo + sem site). Reprovou: "REPROVADO: motivo" e para.
- [ ] Pasta `previas/<slug>/` (se existir, outro slug).
- [ ] Fatos só da ficha e do que foi lido. Nada inventado (preço, depoimento, anos, serviço).
- [ ] Hero com foto real do negócio, sem formulário e sem botão de contato.
- [ ] No mínimo ~5 seções reais.
- [ ] O pedido do nicho resolvido: botão que abre o WhatsApp com o pedido escrito (data com ano, lista com um "e" só).
- [ ] Fotos reais nítidas (`naturalWidth` >= 1,5x a largura exibida), sem repetir foto nem cena.
- [ ] Favicon e apple-touch = logo real (avatar do perfil; guarde o original em `marca/`).
- [ ] Nada dependendo de IntersectionObserver para aparecer; sem `scroll-behavior: smooth` global.
- [ ] `noindex`, `robots.txt` bloqueando, rodapé com a sua marca.
- [ ] `og.jpg` 1200x630 < 64 KB com foto real.
- [ ] `roteiro.md` com `## Mensagens` (Msg 2 só cita o que existe na página) e `## Antes de enviar` (dúvidas de contato).
- [ ] Prints em `_interno/<slug>/` (fora da pasta publicável). Navegador headless: 1 por agente, máx. 2 abas.

## Revisão (advisor adversarial)

Modelo forte, esforço alto, papel explícito: "advisor de gosto e mercado, adversarial e honesto". Ele não conserta, só julga.

Mede e cita:

- Prints 390x844 e 1440x900 (dobra e página inteira).
- Nitidez das fotos, contraste AA, alvo de toque >= 44 px, overflow horizontal, erros de console.
- OG e favicon conforme o checklist.
- Botão de pedido: a mensagem do WhatsApp sai completa e correta.
- Roteiro: nada inventado; Msg 2 só cita o que a página mostra.

Reprova: cara de IA, genérico, texto demais, foto de banco óbvia, hero com formulário.

Schema do veredito:

```json
{
  "aprovado": false,
  "nota": 7.5,
  "problemas": ["foto do hero borrada no mobile (naturalWidth 640 para 780 exibidos)", "..."],
  "manter": ["paleta e tipografia", "seção de cardápio"],
  "veredito": "boa base, falta nitidez e o botão de pedido gera data sem ano"
}
```

Aprovado se `nota >= 8`. Máximo 8 problemas, específicos e acionáveis, em ordem de impacto.

## Loop de ajuste (até 3 voltas, sem regredir)

```text
r = {nota inicial, problemas pendentes}
para v = 1..3 enquanto não aprovado:
  se a volta anterior piorou: restaurar _interno/<slug>/_antes-ajuste-v<anterior>.html
  copiar index.html -> _interno/<slug>/_antes-ajuste-v<v>.html
  ajustar(problemas de r, manter de r)
  nr = revisar()
  se nr.nota < r.nota e v > 1: marcar restaurar   (não aceita a regressão)
  senão: r = nr
não aprovado ao fim: não publica; nota no CRM com os 2 problemas principais
```

Regras do ajustador: corrigir todos os problemas em ordem de impacto; não mexer no que está em `manter`; não trocar a família de fontes sem motivo; OG nova como `og-vN.jpg` (copiada para `og.jpg`), nunca querystring; atualizar a Msg 2 do roteiro se a página mudou; não publicar, não mandar mensagem, não editar o CRM.
