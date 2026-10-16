# Régua do revisor de prévias (corte nota 8)

Âncoras fixas para a nota não oscilar entre revisões e entre revisores. Guarde os prints de cada âncora sua em `previas/_interno/<slug>/` e cite o caminho aqui quando tiver as suas; os exemplos abaixo são do tipo de página, sem cliente real.

O revisor trabalha **depois** do verificador (`references/verificador.md`): nitidez, contraste, toque, overflow, OG técnica, favicon e mensagem do WhatsApp já foram medidos. Ele não mede de novo; julga gosto, verdade da copy, foto certa e o fluxo no celular.

## 1. O que é 8 (publica)

**Exemplo A, Padaria Exemplo com montador de encomenda (8,3)**
- Foto real do dono e dos produtos em tudo, nenhuma de banco, nenhuma cena repetida, todas nítidas.
- O objeto do negócio funciona: calendário de prazo calculado de hoje e montador que escreve a mensagem do WhatsApp com data e ano certos (mês que já passou vira o ano seguinte; data passada nunca entra).
- Fatos limpos (sem preço, sabor ou número de seguidor inventado), paleta tirada do logo, 5 seções com formatos diferentes, medição toda passando.

**Exemplo B, Ateliê Exemplo com guia de personalização (8,2)**
- Foto real da dona no hero; guia montado em volta de uma peça real (setas no desktop, pinos numerados no celular).
- Montador gera a mensagem que a cliente mandaria de verdade (data com ano, aviso de prazo curto).
- Zero cara de modelo pronto, copy sem tom de auditor. Pendência só de polimento.

## 2. O que é 7,5 (não publica)

**Exemplo C, Doceria Exemplo (7,5)**: a resposta do montador aparece bem abaixo dos botões no celular (a pessoa toca e não vê nada mudar); só 4 seções; voz em 3ª pessoa; datas fixas que vencem; balão do hero cobre o produto.

**Exemplo D, Loja Exemplo (7,5)**: copy com fato que não está em fonte nenhuma; galeria no celular sem sinal de que rola de lado; seção de acervo longa demais, em coluna única; fim genérico (dois blocos iguais, CTA repetido); borda de campo abaixo de 3:1.

Base boa não basta: 7,5 = objeto e foto certos, mas 1 ou mais críticos de fluxo no celular ou de verdade da copy.

## 3. Gravidade

**Crítico (derruba abaixo de 8, ou constrange no envio):**
- Fato na copy sem fonte lida (bio, perfil, Maps, busca), ou dado que vence (data fixa, ano literal).
- **Hero sem foto real do negócio** (foto de banco, logo, monograma, post com texto queimado, foto de evento ou de cliente).
- **OG sem foto real e nítida** (logo sozinho em fundo liso, desenho, foto pixelada).
- Placeholder ou texto de bastidor no ar ("a confirmar" quando o dado existe em alguma fonte, "foto aqui", `{var}`).
- Saúde: número de conselho achado em fonte e não mostrado; promessa de resultado; antes e depois; depoimento com promessa; preço promocional.
- Objeto central (balão, mensagem, calendário) fora da vista ao interagir no celular.
- Foto repetida ou mesma cena; foto que não mostra o produto ou o serviço.
- Mensagem do WhatsApp errada (sem ano, "e" duplicado, valor que a tela não mostra).
- Voz em 3ª pessoa no site do cliente; texto de quem revisa ("deixei em branco porque...") na página.
- Menos de 5 seções reais; galeria sem sinal de rolagem no celular.
- Msg 3 que acusa o canal do lead ("seu link da bio só abre o WhatsApp") ou inventa uma dor que ele não disse.
- Cara de IA gritante: tudo arredondado em pílula, hero lotado, selo de data ("Aberto desde..."), bloco de etapas preso ao scroll igual ao de outras prévias, CTA final idêntico ao das outras.

**Polimento (não segura o 8, vai para o roteiro):**
- Favicon ou OG a refazer por estética, logo levemente borrado, grafia de hashtag.
- Ordem de frase da mensagem em caso raro, legenda longa, ajuste de enquadramento (`object-position`), copy de 1 frase.
- Texto repetido leve, rótulo extra acima do título, enfeite leve em CSS.

## 4. Regra do processo

1. **A 1ª revisão faz a lista completa de uma vez**, cada item com gravidade (crítico ou polimento), o print onde aparece e a ação. Nada guardado para a rodada seguinte.
2. **As revisões seguintes só conferem** a lista e regressões. Item novo só se for regressão causada pela correção; o resto vira nota de polimento e não muda o veredito.
3. **Aprovado = 0 crítico pendente + verificador passando.** Polimento pendente não segura o 8.
4. A nota segue as âncoras acima. Subir ou descer exige citar a âncora comparada ("melhor que C porque o balão aparece, pior que A porque a galeria não rola").
5. O revisor não edita nada. Quem corrige é outro agente, pela fonte (spec, foto, texto), com backup antes e volta ao backup se a nota piorar.

## 5. Formato do veredito

```json
{
  "nota": 7.5,
  "criticos": [
    { "id": "hero-foto", "problema": "hero com post que tem texto queimado", "como_corrigir": "trocar por g03.jpg (foto da dona no balcão) e refazer a OG como og-v2.jpg" }
  ],
  "polimento": ["legenda da galeria longa demais no 390"],
  "manter": ["paleta e tipografia", "montador de encomenda"],
  "ancora": "entre C e A: objeto funciona, falta foto real no hero"
}
```
