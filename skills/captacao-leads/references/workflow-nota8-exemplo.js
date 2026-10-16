// Exemplo GENÉRICO de script de workflow (orquestração de um harness de agente) para o fluxo "nota 8 + publicar".
// Leva prévias não publicadas a nota >= 8 (ajuste + revisão adversarial, até 3 voltas, sem regredir),
// publica as aprovadas e registra tudo no CRM no fim. Não manda mensagem para ninguém.
//
// args esperados (exemplo):
// {
//   "base": "/caminho/do/projeto",                  // onde ficam previas/ e o crm-leads/
//   "dominio": "seudominio.com.br",                  // prévias em https://<slug>.<dominio>
//   "publicar": "descrição ou comando do seu processo de publicação (ex.: ./publicar.sh <slug>)",
//   "gosto": "/caminho/para/guia-de-gosto.md",       // opcional: critérios visuais do dono
//   "itens": [{ "slug": "doceriaaurora", "nome": "Doceria Aurora", "nicho": "confeitaria", "cidade": "Cidade",
//              "nota": 7.5, "pend": ["foto do hero borrada"], "direto": false }]
// }
// "direto: true" publica sem passar pelo loop (prévia já aprovada pelo dono).

export const meta = {
  name: 'nota8-e-publicar',
  description: 'Ajusta e revisa prévias até nota >= 8 (advisor adversarial, até 3 voltas, restaura backup se piorar), publica as aprovadas e registra no CRM',
  phases: [
    { title: 'Ajustar', detail: 'corrige o parecer sem regredir' },
    { title: 'Revisar', detail: 'advisor adversarial, corte 8' },
    { title: 'Publicar', detail: 'sobe e confere 200/OG/imagens' },
    { title: 'Fechar', detail: 'CRM pela CLI' },
  ],
}

const BASE = args.base
const PREV = `${BASE}/previas`
const CRM = `${BASE}/crm-leads`
const DOM = args.dominio
const GOSTO = args.gosto ? `Critérios de gosto do dono: ${args.gosto}.` : 'Critério de gosto: nada com cara de template ou de IA, hierarquia clara, pouco texto.'

const IG = `INSTAGRAM (regra dura, vale para todos os agentes juntos): toda URL de instagram.com passa por python3 ${CRM}/skills/captacao-leads/scripts/ig-get.py <url> [arquivo] (freio global: 1 por vez, intervalo mínimo, sem login). Nunca curl ou navegador direto em instagram.com. Máx. ~6 requisições por lead. Código 3 (resfriamento/bloqueio): NÃO insista, siga sem Instagram e anote no recibo. Nunca o navegador logado do usuário.`
const SHOTS = `Prints: navegador headless, 1 por agente, máx. 2 abas, fechar ao terminar. Sirva a pasta com python3 -m http.server em porta livre e derrube no fim. Prints em ${PREV}/_interno/<slug>/ (fora da pasta publicável).`

const VEREDITO = {
  type: 'object',
  properties: {
    aprovado: { type: 'boolean' }, nota: { type: 'number' },
    problemas: { type: 'array', items: { type: 'string' } }, manter: { type: 'array', items: { type: 'string' } },
    veredito: { type: 'string' },
  },
  required: ['aprovado', 'nota', 'problemas', 'manter', 'veredito'],
}
const PUB = {
  type: 'object',
  properties: {
    slug: { type: 'string' }, url: { type: 'string' }, appId: { type: 'string' },
    http200: { type: 'boolean' }, ogOk: { type: 'boolean' }, imagensOk: { type: 'boolean' }, obs: { type: 'string' },
  },
  required: ['slug', 'url', 'http200', 'ogOk', 'imagensOk', 'obs'],
}

// concorrência limitada: no máximo 4 prévias no loop ao mesmo tempo
let ativos = 0
const espera = []
const slot = () => new Promise(r => { if (ativos < 4) { ativos++; r() } else espera.push(r) })
const solta = () => { const n = espera.shift(); if (n) n(); else ativos-- }

const revisar = (l, v) => agent(`ADVISOR de gosto e mercado, ADVERSARIAL e honesto. Você não conserta, só julga.
Prévia de ${l.nome} (${l.nicho}, ${l.cidade}): ${PREV}/${l.slug}/index.html. Volta ${v}.
${GOSTO} ${SHOTS} Prints 390x844 e 1440x900 (dobra e inteira).
Meça: nitidez (naturalWidth >= 1,5x a largura exibida, foto sem borrão), contraste AA, toque >= 44px, overflow, console, nada dependente de IntersectionObserver. og.jpg 1200x630 < 64 KB com foto real nítida; favicon = logo real. Teste o botão de pedido: a mensagem do WhatsApp sai completa e correta (data com ano, lista sem "e" duplicado).
Roteiro ${PREV}/${l.slug}/roteiro.md: nada inventado (preço, depoimento, anos, serviço não lido); Msg 2 só cita o que a página mostra. Hero com foto real, sem formulário nem botão de contato. Mín. ~5 seções reais. Fotos não repetem.
Cara de IA, genérico, texto demais, foto de banco óbvia reprovam. Nota 0-10, aprovado se >= 8. Problemas específicos e acionáveis (máx. 8), em ordem de impacto.`,
  { label: `revisar:${l.slug}:v${v}`, phase: 'Revisar', schema: VEREDITO, effort: 'high', model: '<modelo-forte>' })

const ajustar = (l, v, r, restaurar) => agent(`Designer/dev da prévia de ${l.nome} (${l.nicho}, ${l.cidade}): ${PREV}/${l.slug}/index.html. Meta: nota >= 8 no advisor. Volta ${v}.
${restaurar ? `A volta anterior PIOROU a nota. PRIMEIRO restaure ${PREV}/_interno/${l.slug}/_antes-ajuste-v${restaurar}.html por cima de index.html e só então corrija, com mudanças pontuais.` : ''}
PRIMEIRO copie index.html para ${PREV}/_interno/${l.slug}/_antes-ajuste-v${v}.html.
${GOSTO}
Corrija TODOS os problemas, em ordem de impacto, sem regredir o "manter": ${JSON.stringify({ nota: r.nota, problemas: r.problemas, manter: r.manter || [] })}
Regras: fatos só da ficha/roteiro; fotos reais nítidas sem repetir; favicon = logo real; nada dependendo de IntersectionObserver; noindex e robots bloqueando; PT-BR sem travessão. OG nova: og-vN.jpg 1200x630 < 64 KB com FOTO REAL, copie para og.jpg e aponte og:image para og-vN.jpg (nunca querystring). Atualize a Msg 2 do roteiro se a página mudou. Número de WhatsApp não confirmado NÃO bloqueia: anote em "Antes de enviar".
${IG} Não publique, não edite o CRM, não mande mensagem. ${SHOTS} Recibo <= 5 linhas com as medições.`,
  { label: `ajustar:${l.slug}:v${v}`, phase: 'Ajustar', agentType: 'developer' })

const publicar = (slug) => agent(`OBJETIVO: publicar ${PREV}/${slug}/ em https://${slug}.${DOM} e conferir no ar.
COMO: ${args.publicar}
RESTRIÇÕES: não tocar em outra app ou domínio; não imprimir chave nem token; não mandar mensagem; não editar index.html além do necessário para publicar. Falhou 2x: pare e descreva em obs.
ORÁCULO: curl -sI https://${slug}.${DOM} -> 200; URL do og:image -> 200 image/jpeg; cada imagem do HTML servido -> 200. Devolva o JSON pedido.`,
  { label: `publicar:${slug}`, phase: 'Publicar', agentType: 'developer', schema: PUB })

async function levar(l) {
  let r = { aprovado: false, nota: l.nota ?? 0, problemas: l.pend || [], manter: [] }
  let v = 0
  let restaurar = 0
  if (!l.direto) {
    await slot()
    try {
      while (!r.aprovado && v < 3) {
        v++
        await ajustar(l, v, r, restaurar)
        const nr = await revisar(l, v)
        if (!nr) break
        log(`${l.slug} v${v}: ${nr.nota}${nr.aprovado ? ' aprovado' : ''}`)
        if (nr.aprovado) { r = nr; restaurar = 0 }
        else if (nr.nota < r.nota && v > 1) { restaurar = v }   // regrediu: próxima volta restaura o backup
        else { r = nr; restaurar = 0 }
      }
    } finally { solta() }
    if (!r.aprovado || restaurar) return { slug: l.slug, publicada: false, nota: r.nota, problemas: r.problemas.slice(0, 2) }
  }
  const p = await publicar(l.slug)
  return { slug: l.slug, publicada: !!(p && p.http200 && p.ogOk), nota: r.nota, pub: p }
}

const res = (await parallel(args.itens.map(l => () => levar(l)))).filter(Boolean)

phase('Fechar')
const fim = await agent(`Fechamento do lote "nota 8 + publicar". Resultado: ${JSON.stringify(res)}
CRM pela CLI (cd ${CRM} && python3 crm.py ...), serial, um comando por vez, nunca editando o JSON na mão:
- publicada: set <slug> previa.url <url> ; set <slug> previa.publicada true ; set <slug> previa.appId <appId> (se houver).
- não publicada: nota <slug> "nota <n> em <hoje>, não publicada: <2 problemas principais>".
Slug que não existe no CRM: anote no recibo, não crie. Não mande mensagem. Recibo <= 8 linhas.`,
  { label: 'fechar', phase: 'Fechar', agentType: 'developer' })

return { res, fim }
