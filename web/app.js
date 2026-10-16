"use strict";
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const POLL_MS = 3000;
  const ls = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (_) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };

  let dados = { versao: "", etapas: [], negocios: [], contatos: [], fases: [], fila: [], fila_msg2: [] };
  let aberto = null; // {slug, aba}
  let dadosPendente = false;
  const celular = () => matchMedia("(max-width: 720px)").matches;
  let vista = ls.get("crm-vista", null) || (celular() ? "hoje" : "funil");
  // estado de UI do painel (zera ao trocar de negócio)
  let ui = { prox: false, anotar: false, hist: false, det: false, editar: false, fases: {}, editFase: "" };

  // ---------- util de data ----------
  const pad = (n) => String(n).padStart(2, "0");
  const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const somaDias = (iso, n) => { const d = new Date(iso + "T12:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const agoraBR = () => { const d = new Date(); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function rotuloDia(iso) {
    const h = hojeISO();
    if (iso === h) return "Hoje";
    if (iso === somaDias(h, -1)) return "Ontem";
    const d = new Date(iso + "T12:00");
    const sem = d.toLocaleDateString("pt-BR", { weekday: "long" });
    const dif = (new Date(h + "T12:00") - d) / 864e5;
    if (dif > 0 && dif < 7) return sem.charAt(0).toUpperCase() + sem.slice(1);
    return `${ddmm(iso)}/${iso.slice(0, 4)}`;
  }
  function rotuloQuando(q) {
    if (!q) return "";
    const dia = q.slice(0, 10), h = q.slice(11, 16);
    if (dia === hojeISO()) return `hoje ${h}`;
    if (dia === somaDias(hojeISO(), -1)) return `ontem ${h}`;
    return `${ddmm(dia)} ${h}`;
  }
  const msDe = (q) => new Date(String(q).replace(" ", "T").slice(0, 16)).getTime();
  const rotuloIdade = (ms) => {
    const m = Math.max(0, Math.floor(ms / 6e4));
    if (m < 60) return `há ${Math.max(m, 1)} min`;
    if (m < 1440) return `há ${Math.floor(m / 60)} h`;
    return `há ${Math.floor(m / 1440)} d`;
  };
  const moeda = (v) => v == null || v === "" ? "" : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const fmtData = (iso) => !iso ? "" : iso.slice(0, 4) === hojeISO().slice(0, 4) ? ddmm(iso) : `${ddmm(iso)}/${iso.slice(0, 4)}`;
  const fmtQuando = (q) => `${fmtData(q.slice(0, 10))} ${q.slice(11, 16)}`;
  function lerData(t) {
    t = String(t || "").trim();
    if (!t) return "";
    const rel = { hoje: 0, amanha: 1, "amanhã": 1 }[t.toLowerCase()];
    if (rel != null) return somaDias(hojeISO(), rel);
    let m = t.match(/^\+(\d{1,3})$/);
    if (m) return somaDias(hojeISO(), +m[1]);
    let d, mo, a;
    if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [, a, mo, d] = m;
    else if ((m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/))) { [, d, mo, a] = m; a = !a ? hojeISO().slice(0, 4) : a.length === 2 ? "20" + a : a; }
    else return null;
    const iso = `${a}-${pad(+mo)}-${pad(+d)}`, dt = new Date(iso + "T12:00");
    return dt.getMonth() + 1 === +mo && dt.getDate() === +d ? iso : null;
  }

  // ---------- rede ----------
  async function api(rota, corpo) {
    const r = await fetch(rota, corpo ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) } : {});
    const j = await r.json();
    if (!r.ok) throw new Error(j.erro || r.statusText);
    return j;
  }
  async function enviar(rota, corpo) {
    try {
      const r = await api(rota, corpo);
      aplicar(r, false);
      if (r.aviso) toast(r.aviso);
      return true;
    } catch (e) {
      toast(e.message, true);
      return false;
    }
  }
  function toast(msg, erro, acao) {
    $$(".toast").forEach((x) => x.remove());
    const t = document.createElement("div");
    t.className = "toast" + (erro ? " erro" : "") + (acao ? " com-acao" : "");
    t.setAttribute("role", "status");
    t.textContent = msg;
    if (acao) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = acao.rot;
      b.addEventListener("click", () => { t.remove(); acao.fn(); });
      t.appendChild(b);
    }
    document.body.appendChild(t);
    setTimeout(() => t.remove(), erro ? 4000 : acao ? 6000 : 1800);
  }
  function marcarSinc(externo) {
    const s = $("#sinc");
    const d = new Date();
    const h = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    s.classList.remove("erro");
    if (externo) {
      s.textContent = `Mudou no arquivo ${h}`;
      s.classList.add("mudou");
      clearTimeout(marcarSinc.t);
      marcarSinc.t = setTimeout(() => s.classList.remove("mudou"), 4000);
    } else if (!s.classList.contains("mudou")) {
      s.textContent = `Atualizado ${h}`;
    }
  }
  function aplicar(novo, externo) {
    dados = novo;
    dados.contatos = dados.contatos || [];
    dados.fases = dados.fases || []; dados.fila = dados.fila || []; dados.fila_msg2 = dados.fila_msg2 || []; dados.fila_sem_numero = dados.fila_sem_numero || 0;
    renderFiltros();
    render();
    if (aberto) {
      if (!porSlug(aberto.slug)) return fechar();
      renderPainel(false);
    }
    marcarSinc(externo);
  }
  const porSlug = (s) => dados.negocios.find((n) => n.slug === s);
  async function poll() {
    try {
      const { versao } = await api("/api/versao");
      if (versao !== dados.versao) aplicar(await api("/api/estado"), true);
    } catch (e) {
      const s = $("#sinc");
      s.textContent = "Servidor fora do ar";
      s.classList.add("erro");
    }
    setTimeout(poll, POLL_MS);
  }

  // ---------- filtros ----------
  const filtros = { busca: "", cidade: "", nicho: "" };
  function renderFiltros() {
    for (const [id, campo, rot] of [["#f-cidade", "cidade", "Todas as cidades"], ["#f-nicho", "nicho", "Todos os nichos"]]) {
      const sel = $(id);
      const vals = [...new Set(dados.negocios.map((n) => n[campo]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
      const html = `<option value="">${rot}</option>` + vals.map((v) => `<option${v === filtros[campo] ? " selected" : ""}>${esc(v)}</option>`).join("");
      if (sel.innerHTML !== html) sel.innerHTML = html;
    }
    const nf = (filtros.cidade ? 1 : 0) + (filtros.nicho ? 1 : 0);
    $("#f-n").textContent = nf || "";
  }
  const termos = () => filtros.busca.toLowerCase().split(/\s+/).filter(Boolean);
  function passa(n) {
    if (filtros.cidade && n.cidade !== filtros.cidade) return false;
    if (filtros.nicho && n.nicho !== filtros.nicho) return false;
    const t = termos();
    if (t.length) {
      const alvo = [n.nome, n.slug, n.instagram, n.cidade, n.nicho, ...(n.contatos || []).map((c) => c.nome + " " + c.whatsapp), ...(n.tags || [])].join(" ").toLowerCase();
      return t.every((p) => alvo.includes(p));
    }
    return true;
  }
  $("#f-busca").addEventListener("input", (e) => { filtros.busca = e.target.value.trim(); render(); });
  $("#f-cidade").addEventListener("change", (e) => { filtros.cidade = e.target.value; renderFiltros(); render(); });
  $("#f-nicho").addEventListener("change", (e) => { filtros.nicho = e.target.value; renderFiltros(); render(); });

  // ---------- regras de negócio (iguais às da CLI) ----------
  const NOME_CURTO = { previa: "Prévia", abordado: "Abordado", respondeu: "Respondeu", link: "Link enviado", proposta: "Proposta", negociando: "Negociando", ganho: "Fechado", perdido: "Perdido", retomar: "Retomar" };
  const SEM_ACAO = ["ganho", "perdido", "retomar"];
  // Envios meus (operador): evento com envio:true ou, nos antigos, texto que diz "enviada/enviado" ("não confirmado" nunca conta).
  const ehEnvio = (e) => e.envio === true || (/\benviad[oa]s?\b/i.test(e.texto) && !/não confirmado/i.test(e.texto) && !/^(Criado em|Proposta:|Cobrança)/.test(e.texto));
  const enviosDe = (n) => (n.eventos || []).filter(ehEnvio).map((e, i) => ({ id: "ev" + i, de: "eu", quando: e.quando, texto: e.texto, evento: true }));
  const linhaDoTempo = (n) => [...(n.mensagens || []), ...enviosDe(n)].sort((a, b) => (a.quando < b.quando ? -1 : a.quando > b.quando ? 1 : !!a.evento - !!b.evento));
  const ultimoContato = (n) => { const l = linhaDoTempo(n); return l.length ? l[l.length - 1] : null; };
  const aguardaMeu = (n) => { const u = ultimoContato(n); return !!u && u.de === "eles" && !SEM_ACAO.includes(n.etapa); };
  const idadeResposta = (n) => Date.now() - msDe(ultimoContato(n).quando);
  const respAtrasada = (n) => aguardaMeu(n) && idadeResposta(n) > 864e5;
  const passoLimpo = (n) => (/^ver log\b/i.test(n.proximo_passo || "") ? "" : n.proximo_passo || "");
  function estadoProx(n) {
    if (!n.proximo_em || ["ganho", "perdido"].includes(n.etapa)) return "";
    const h = hojeISO();
    return n.proximo_em < h ? "atrasado" : n.proximo_em === h ? "hoje" : "";
  }
  const cobAbertas = (n) => (n.cobrancas || []).filter((c) => !c.feita).sort((a, b) => (a.quando < b.quando ? -1 : 1));
  const estadoCob = (c) => { const d = c.quando.slice(0, 10), h = hojeISO(); return d < h ? "vencida" : d === h ? "hoje" : ""; };
  const cobDevidas = (n) => cobAbertas(n).filter((c) => estadoCob(c));
  const temCobrar = (n) => cobDevidas(n).length > 0;
  function rotuloCob(c) {
    const e = estadoCob(c);
    if (e === "vencida") return `vencida ${rotuloIdade(Date.now() - msDe(c.quando))}`;
    if (e === "hoje") return `hoje ${c.quando.slice(11, 16)}`;
    return fmtQuando(c.quando);
  }
  const digitos = (s) => String(s || "").replace(/\D/g, "");
  const comDDI = (d) => (d.length <= 11 ? "55" + d : d);
  const contatoWA = (n) => (n.contatos || []).find((c) => digitos(c.whatsapp));
  const waApp = (n, texto) => { const ct = contatoWA(n); return ct ? `whatsapp://send?phone=${comDDI(digitos(ct.whatsapp))}${texto ? "&text=" + encodeURIComponent(texto) : ""}` : ""; };
  const waUrl = (num) => { const d = digitos(num); return d ? `https://wa.me/${comDDI(d)}` : ""; };
  const fmtTel = (num) => { const d = digitos(num).replace(/^55(?=\d{10,11}$)/, ""); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d; };
  const igUrl = (ig) => !ig ? "" : /^https?:/.test(ig) ? ig : `https://instagram.com/${ig.replace(/^@/, "")}`;
  const semProto = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const etapaDesde = (n) => n.etapa_desde || n.criado_em || "";
  // Só movimento registrado ou criação direta na etapa são exatos; o resto (importação) é estimativa e não vai pra tela.
  const desdeExato = (n) => ["movimento", "criacao"].includes(n.etapa_desde_fonte);
  // Estimado pelo histórico: mostra com "~" (desconhecido não mostra)
  const desdeAprox = (n) => n.etapa_desde_fonte === "estimado";
  // Hora da importação: evento "Criado em" com histórico anterior a ele. Os eventos dessa hora são ruído.
  function importadoEm(n) {
    const cri = (n.eventos || []).find((e) => e.texto.startsWith("Criado em "));
    if (!cri) return "";
    const q = cri.quando;
    return (n.eventos.some((e) => e.quando < q) || (n.mensagens || []).some((m) => m.quando < q)) ? q : "";
  }
  const pedeAcao = (n) => aguardaMeu(n) || temCobrar(n) || !!estadoProx(n);
  // Ordem dos cards: quem entrou na etapa por último fica no topo. Empate: o que se mexeu por último.
  function ordem(a, b) {
    const ea = etapaDesde(a), eb = etapaDesde(b);
    if (ea !== eb) return ea < eb ? 1 : -1;
    const sa = a.etapa_seq || 0, sb = b.etapa_seq || 0; // mesmo minuto: segundos do movimento
    if (sa !== sb) return sb - sa;
    const ua = (ultimoContato(a) || {}).quando || "", ub = (ultimoContato(b) || {}).quando || "";
    if (ua !== ub) return ua < ub ? 1 : -1;
    return a.nome.localeCompare(b.nome, "pt-BR");
  }
  const FILA_ROT = { responder: "responder", cobrar: "cobrar", hoje: "prazo hoje", atrasados: "atrasados" };
  const FILTRO_FILA = { responder: aguardaMeu, cobrar: temCobrar, hoje: (n) => estadoProx(n) === "hoje", atrasados: (n) => estadoProx(n) === "atrasado" };
  let fila = "";

  // ---------- render geral ----------
  const TITULO = { painel: "Painel", hoje: "Hoje", funil: "Funil", fila: "Fila de envio", contatos: "Contatos" };
  function render() {
    const visiveis = dados.negocios.filter(passa);
    const ativos = visiveis.filter((n) => !["ganho", "perdido"].includes(n.etapa));
    // sidebar
    const devidas = ativos.flatMap(cobDevidas);
    const nResp = ativos.filter(aguardaMeu).length;
    const nHoje = devidas.length + nResp + ativos.filter((n) => estadoProx(n) && !temCobrar(n) && !aguardaMeu(n)).length;
    const verm = devidas.some((c) => estadoCob(c) === "vencida") || ativos.some(respAtrasada);
    const ch = $("#n-hoje");
    ch.textContent = nHoje || "";
    ch.className = "cont" + (nHoje ? (verm ? " verm" : " amb") : "");
    $("#n-funil").textContent = dados.negocios.filter((n) => !["ganho", "perdido"].includes(n.etapa)).length;
    $("#n-contatos").textContent = dados.contatos.length || "";
    $("#n-fila").textContent = dados.fila.length || "";
    $$(".nav-item").forEach((a) => (a.dataset.ir === vista ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    $("#titulo").textContent = TITULO[vista];
    $("#filtros-wrap").hidden = vista === "contatos" || vista === "fila" || vista === "painel";
    $("#f-busca").hidden = vista === "painel";
    $("#f-busca").placeholder = celular() ? "Buscar" : vista === "contatos" ? "Buscar contato" : "Buscar negócio";
    $("#quadro").hidden = vista !== "funil";
    $("#faixa").hidden = vista !== "funil";
    $("#v-hoje").hidden = vista !== "hoje";
    $("#v-painel").hidden = vista !== "painel";
    $("#v-contatos").hidden = vista !== "contatos";
    $("#v-fila").hidden = vista !== "fila";
    // resumo
    let total = 0;
    for (const n of ativos) if (!SEM_ACAO.includes(n.etapa)) total += Number(n.proposta && n.proposta.valor) || 0;
    const ganhos = visiveis.filter((n) => n.etapa === "ganho");
    const vGanho = ganhos.reduce((s, n) => s + (Number(n.proposta && n.proposta.valor) || 0), 0);
    $("#resumo").textContent = vista === "painel" ? (painelDados ? `atualizado ${painelDados.gerado_em}` : "")
      : vista === "contatos" ? `${dados.contatos.length} pessoas`
      : vista === "fila" ? `${dados.fila.length} pra Msg 1 · ${dados.fila_msg2.length} pra Msg 2`
      : `${ativos.length} em aberto${total ? ` · ${moeda(total)} em proposta` : ""} · ${ganhos.length} fechado${ganhos.length === 1 ? "" : "s"}${vGanho ? ` (${moeda(vGanho)})` : ""}`;
    if (vista === "painel") { renderPainelDash(); pollPainel(true); }
    else if (vista === "funil") { renderFaixa(ativos); renderQuadro(visiveis); }
    else if (vista === "hoje") renderHoje(visiveis);
    else if (vista === "fila") {
      renderFila();
      // entrou pela sidebar: o foco fica no link da nav e os atalhos (C, Enter, →) não pegariam
      const f = document.activeElement;
      if (f && f.closest && f.closest(".nav-item, [data-ir]")) f.blur();
    }
    else renderContatos();
  }
  function irPara(v) {
    vista = v;
    ls.set("crm-vista", v);
    if (!aberto) history.replaceState(null, "", v === "painel" ? pfHash() : location.pathname);
    fila = "";
    render();
  }

  // ---------- faixa Hoje compacta ----------
  function renderFaixa(ativos) {
    const cont = {}, tom = {};
    for (const k of Object.keys(FILA_ROT)) cont[k] = ativos.filter(FILTRO_FILA[k]).length;
    tom.responder = ativos.some(respAtrasada) ? "verm" : "amb";
    tom.cobrar = ativos.some((n) => cobDevidas(n).some((c) => estadoCob(c) === "vencida")) ? "verm" : "amb";
    tom.hoje = "amb"; tom.atrasados = "verm";
    const urg = ativos.filter((n) => aguardaMeu(n) || temCobrar(n)).sort((a, b) => (respAtrasada(b) - respAtrasada(a)));
    $("#faixa").innerHTML = `<span class="f-tit">Hoje</span>` +
      (Object.keys(FILA_ROT).filter((k) => cont[k] || fila === k).map((k) => `<button class="chip ${cont[k] ? tom[k] : "zero"}" data-fila="${k}" aria-pressed="${fila === k}"><b>${cont[k]}</b> ${FILA_ROT[k]}</button>`).join("")
        || `<span class="f-nada">nada pendente</span>`) +
      `<span class="f-nomes">${urg.slice(0, 4).map((n) => `<button data-abrir="${esc(n.slug)}">${esc(n.nome)}</button>`).join(", ")}${urg.length > 4 ? ` e mais ${urg.length - 4}` : ""}</span>` +
      `<button class="btn-txt f-ver" data-ir-v="hoje">Ver lista</button>`;
  }

  // ---------- quadro ----------
  let recolhidas = new Set(ls.get("crm-recolhidas", ["perdido", "retomar"]));
  let abertas = new Set(ls.get("crm-abertas", []));
  let larguras = ls.get("crm-larguras", {}) || {};
  const LARG = { min: 200, max: 520, padrao: 232 };
  const ICO_REC = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  function cartaoHTML(n) {
    const u = ultimoContato(n);
    const aguarda = aguardaMeu(n);
    const cob = cobDevidas(n)[0];
    let status = "";
    if (aguarda) {
      const t = String(u.texto || "").replace(/\s+/g, " ").trim();
      status = `<div class="c-status ${respAtrasada(n) ? "verm" : "amb"}"><span class="tag">responder ${rotuloIdade(idadeResposta(n))}</span>${t ? `<span class="cit">“${esc(t)}”</span>` : ""}</div>`;
    } else if (cob) {
      const ec = estadoCob(cob);
      status = `<div class="c-status ${ec === "vencida" ? "verm" : "amb"}"><span class="tag">cobrar ${esc(ec === "hoje" ? "hoje" : "vencida")}</span>${esc(cob.motivo)}</div>`;
    } else {
      const ep = estadoProx(n), passo = passoLimpo(n);
      if (passo || n.proximo_em) {
        const data = n.proximo_em ? (ep === "hoje" ? "hoje" : ep === "atrasado" ? `atrasado ${ddmm(n.proximo_em)}` : ddmm(n.proximo_em)) : "";
        status = `<div class="c-status ${ep === "atrasado" ? "verm" : ep === "hoje" ? "amb" : ""}">${data ? `<span class="tag">${esc(data)}</span>` : ""}${esc(passo)}</div>`;
      }
    }
    // uma linha só de meta: recência (quando não há status) · na etapa (só se exato e de outro dia) · cidade
    const desde = etapaDesde(n);
    const recencia = !status && u ? `${u.de === "eu" ? "enviei" : "responderam"} ${rotuloIdade(Date.now() - msDe(u.quando))}` : "";
    const outroDia = !u || u.quando.slice(0, 10) !== desde.slice(0, 10);
    const naEtapa = !desde || !outroDia ? "" : desdeExato(n) ? `na etapa ${rotuloIdade(Date.now() - msDe(desde))}`
      : desdeAprox(n) ? `na etapa ~${rotuloIdade(Date.now() - msDe(desde)).replace(/^há /, "")}` : "";
    const meta = [recencia, naEtapa, n.cidade].filter(Boolean).map(esc).join(" · ");
    const val = n.proposta && n.proposta.valor != null ? `<span class="c-valor">${esc(moeda(n.proposta.valor))}</span>` : "";
    const cls = "cartao" + (aberto && aberto.slug === n.slug ? " aberto" : "");
    return `<article class="${cls}" data-slug="${esc(n.slug)}" data-desde="${esc(desde)}" tabindex="0" aria-label="${esc(n.nome)}">
      <div class="c-l1"><span class="c-nome">${esc(n.nome)}</span>${val}</div>${status}${meta ? `<div class="c-meta">${meta}</div>` : ""}</article>`;
  }
  function renderQuadro(visiveis) {
    const q = $("#quadro");
    const rolagens = {};
    $$(".coluna .col-cartoes", q).forEach((c) => (rolagens[c.parentNode.dataset.etapa] = c.scrollTop));
    const filtro = FILTRO_FILA[fila] || null;
    q.innerHTML = dados.etapas.map((e) => {
      const todos = visiveis.filter((n) => n.etapa === e.id);
      const ns = (filtro ? todos.filter(filtro) : todos).sort(ordem);
      const soma = ns.reduce((s, n) => s + (Number(n.proposta && n.proposta.valor) || 0), 0);
      const nome = NOME_CURTO[e.id] || e.nome;
      // começa encolhida só se vazia (Perdido e Retomar vêm encolhidas pelo padrão salvo); coluna com card nunca some sozinha
      const auto = !filtro && !ns.length && !abertas.has(e.id);
      if (recolhidas.has(e.id) || auto || (filtro && !ns.length)) {
        const manual = recolhidas.has(e.id) || auto;
        return `<section class="coluna recolhida" data-etapa="${e.id}"><${manual ? `button data-rec="${e.id}" aria-label="Expandir ${esc(nome)} (${ns.length})" title="Expandir"` : "div"} class="rec-faixa"><span class="n">${ns.length}</span><h3>${esc(nome)}</h3></${manual ? "button" : "div"}></section>`;
      }
      const w = larguras[e.id] ? ` style="--w:${Math.max(LARG.min, Math.min(LARG.max, larguras[e.id]))}px"` : "";
      return `<section class="coluna" data-etapa="${e.id}"${ns.some(pedeAcao) ? " data-acao" : ""}${w}>
        <header class="col-cab"><h3>${esc(nome)}</h3><span class="n">${ns.length}</span>${soma ? `<span class="soma">${esc(moeda(soma))}</span>` : ""}<button class="btn-icone col-rec" data-rec="${e.id}" aria-label="Encolher ${esc(nome)}" title="Encolher">${ICO_REC}</button></header>
        <div class="col-cartoes">${ns.map(cartaoHTML).join("") || `<div class="col-vazia">Nenhum</div>`}</div>
        <div class="col-resize" data-resize="${e.id}" title="Arraste pra mudar a largura (duplo clique volta ao padrão)"></div></section>`;
    }).join("");
    $$(".coluna .col-cartoes", q).forEach((c) => { const r = rolagens[c.parentNode.dataset.etapa]; if (r) c.scrollTop = r; });
    // celular: abre na primeira coluna que pede ação (senão a primeira aberta), não na Prévia
    if (celular() && !renderQuadro.rolou) {
      const alvo = $(".coluna[data-acao]", q) || $(".coluna:not(.recolhida)", q);
      if (alvo) { q.scrollLeft = alvo.offsetLeft - 14; renderQuadro.rolou = true; }
    }
  }
  function alternarRec(id, expandir) {
    if (expandir) { recolhidas.delete(id); abertas.add(id); }
    else { recolhidas.add(id); abertas.delete(id); }
    ls.set("crm-recolhidas", [...recolhidas]);
    ls.set("crm-abertas", [...abertas]);
    render();
  }

  // ---------- redimensionar coluna ----------
  let rz = null;
  document.addEventListener("pointerdown", (e) => {
    const h = e.target.closest("[data-resize]");
    if (!h || e.button !== 0) return;
    e.preventDefault();
    const col = h.closest(".coluna");
    rz = { id: h.dataset.resize, col, h, x0: e.clientX, w0: col.getBoundingClientRect().width };
    h.classList.add("ativo");
    document.body.classList.add("redimensionando");
  });
  window.addEventListener("pointermove", (e) => {
    if (!rz) return;
    const w = Math.round(Math.max(LARG.min, Math.min(LARG.max, rz.w0 + e.clientX - rz.x0)));
    rz.col.style.setProperty("--w", w + "px");
    rz.w = w;
  });
  window.addEventListener("pointerup", () => {
    if (!rz) return;
    if (rz.w) { larguras[rz.id] = rz.w; ls.set("crm-larguras", larguras); }
    rz.h.classList.remove("ativo");
    document.body.classList.remove("redimensionando");
    rz = null;
  });
  document.addEventListener("dblclick", (e) => {
    const h = e.target.closest("[data-resize]");
    if (!h) return;
    delete larguras[h.dataset.resize];
    ls.set("crm-larguras", larguras);
    render();
  });


  // ---------- vista Painel (só leitura, /api/painel; filtros e contas aqui no cliente) ----------
  let painelDados = null, painelTimer = null, painelVoando = false, painelTodos = false;
  const PAINEL_MS = 4000;
  const PF_PADRAO = { n: "", c: "", p: "tudo", a: "", o: "alcance", od: "desc", t: "testados", td: "desc", neg: "" };
  let pf = { ...PF_PADRAO };
  const CORES_CAT = ["#3b6fd8", "#e08a1e", "#1f9d74", "#c94f7c", "#7c5cd6", "#2a9cb3", "#a3742c", "#5f6b7a", "#9aa1ad"];
  const SERIES = [["abordado", "Abordados", "var(--tinta)"], ["respondeu", "Responderam", "#3b6fd8"], ["link", "Link", "#e08a1e"], ["proposta", "Proposta", "#1f9d74"]];
  const ATALHOS = { "": "Todos", avancados: "Mais avançados", responderam: "Responderam", perdidos: "Perdidos" };
  const PERIODOS = { hoje: "Hoje", "7d": "7 dias", tudo: "Tudo" };
  function pfLer(h) {
    const q = new URLSearchParams(h.replace(/^painel\??/, ""));
    pf = { ...PF_PADRAO };
    for (const k of Object.keys(PF_PADRAO)) if (q.get(k) != null) pf[k] = q.get(k);
    if (!PERIODOS[pf.p]) pf.p = "tudo";
    if (!(pf.a in ATALHOS)) pf.a = "";
  }
  function pfHash() {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(pf)) if (v !== PF_PADRAO[k]) q.set(k, v);
    const s = q.toString();
    return "#painel" + (s ? "?" + s : "");
  }
  function pfGravar() { if (!aberto) history.replaceState(null, "", pfHash()); renderPainelDash(); }
  async function pollPainel(agora) {
    if (agora && painelTimer) return;
    clearTimeout(painelTimer); painelTimer = null;
    if (vista !== "painel") return;
    if (!painelVoando) {
      painelVoando = true;
      try {
        painelDados = await api("/api/painel");
        if (vista === "painel") { renderPainelDash(); $("#resumo").textContent = `atualizado ${painelDados.gerado_em}`; }
      } catch (e) { /* o poll geral já mostra "Servidor fora do ar" */ }
      painelVoando = false;
    }
    if (vista === "painel") painelTimer = setTimeout(() => { painelTimer = null; pollPainel(false); }, PAINEL_MS);
  }
  const pct = (v) => (v == null ? "–" : `${v}%`);
  const taxa = (a, b) => (b ? Math.round((100 * a) / b) : null);
  const diaDe = (q) => (q || "").slice(0, 10);
  const diasEntre = (a, b) => Math.round((new Date(b + "T12:00") - new Date(a + "T12:00")) / 864e5);
  function passaPeriodo(l) {
    if (pf.p === "tudo") return true;
    const d = diaDe(l.datas.abordado);
    if (!d) return false;
    const h = hojeISO();
    return pf.p === "hoje" ? d === h : d >= somaDias(h, -6);
  }
  function passaAtalho(l) {
    if (pf.a === "avancados") return ["link", "proposta", "negociando", "ganho"].includes(l.etapa);
    if (pf.a === "responderam") return l.respondeu;
    if (pf.a === "perdidos") return l.etapa === "perdido";
    return true;
  }
  // tudo menos o nicho (pra rosca mostrar a divisão inteira e destacar a fatia escolhida)
  const filtroBase = (L) => L.filter((l) => (!pf.c || l.cidade === pf.c) && passaPeriodo(l) && passaAtalho(l));
  function svgLinha(L) {
    const dias = new Set();
    for (const l of L) for (const [k] of SERIES) if (l.datas[k]) dias.add(diaDe(l.datas[k]));
    if (!dias.size) return `<p class="vazio-msg">Sem datas no filtro.</p>`;
    const h = hojeISO();
    let ini = [...dias].sort()[0];
    if (pf.p === "7d") ini = somaDias(h, -6);
    if (pf.p === "hoje") ini = somaDias(h, -1);
    if (diasEntre(ini, h) > 45) ini = somaDias(h, -45);
    const eixo = []; for (let d = ini; d <= h; d = somaDias(d, 1)) eixo.push(d);
    const cont = SERIES.map(([k]) => eixo.map((d) => L.filter((l) => diaDe(l.datas[k]) === d).length));
    const max = Math.max(1, ...cont.flat());
    const W = celular() ? 360 : 640, H = celular() ? 200 : 220, ml = 28, mr = 12, mt = 12, mb = 26;
    const x = (i) => ml + (eixo.length === 1 ? (W - ml - mr) / 2 : (i * (W - ml - mr)) / (eixo.length - 1));
    const y = (v) => mt + (H - mt - mb) * (1 - v / max);
    const passo = Math.max(1, Math.ceil(max / 4));
    let grade = "";
    for (let v = 0; v <= max; v += passo) grade += `<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" class="gr"/><text x="${ml - 6}" y="${y(v) + 4}" class="ex" text-anchor="end">${v}</text>`;
    const cadaX = Math.max(1, Math.ceil(eixo.length / (celular() ? 4 : 8)));
    const rot = eixo.map((d, i) => (i % cadaX === 0 || i === eixo.length - 1) ? `<text x="${x(i)}" y="${H - 6}" class="ex" text-anchor="middle">${ddmm(d)}</text>` : "").join("");
    const linhas = SERIES.map(([k, nome, cor], si) => {
      const pts = cont[si].map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      const pontos = cont[si].map((v, i) => v ? `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${cor}"><title>${nome} ${ddmm(eixo[i])}: ${v}</title></circle>` : "").join("");
      return `<polyline points="${pts}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${pontos}`;
    }).join("");
    const leg = SERIES.map(([k, nome, cor], si) => `<span><i style="background:${cor}"></i>${nome} <b>${cont[si].reduce((a, b) => a + b, 0)}</b></span>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" class="g-linha" role="img" aria-label="Marcos por dia">${grade}${rot}${linhas}</svg><p class="g-leg">${leg}</p>`;
  }
  function svgRosca(L) {
    const cats = painelDados.categorias;
    const atac = L.filter((l) => l.testado);
    const fat = cats.map((c, i) => ({ c, cor: CORES_CAT[i % CORES_CAT.length], n: atac.filter((l) => l.cat === c).length })).filter((f) => f.n);
    const tot = atac.length;
    if (!tot) return `<p class="vazio-msg">Ninguém abordado no filtro.</p>`;
    const R = 80, r = 50, cx = 100, cy = 100;
    let a0 = -Math.PI / 2, arcos = "";
    for (const f of fat.sort((a, b) => b.n - a.n)) {
      const a1 = a0 + (2 * Math.PI * f.n) / tot;
      const sel = pf.n === f.c, apag = pf.n && !sel;
      const g = a1 - a0 >= Math.PI ? 1 : 0;
      const p = (rr, a) => `${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
      const d = fat.length === 1 ? `M${cx - R} ${cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0M${cx - r} ${cy}a${r} ${r} 0 1 1 ${2 * r} 0a${r} ${r} 0 1 1 ${-2 * r} 0`
        : `M${p(R, a0)}A${R} ${R} 0 ${g} 1 ${p(R, a1)}L${p(r, a1)}A${r} ${r} 0 ${g} 0 ${p(r, a0)}Z`;
      arcos += `<path d="${d}" fill="${f.cor}" fill-rule="evenodd" class="fatia${sel ? " sel" : ""}${apag ? " apag" : ""}" data-pf="n" data-v="${esc(f.c)}" tabindex="0" role="button" aria-label="${esc(f.c)}: ${f.n}"><title>${esc(f.c)}: ${f.n} (${Math.round((100 * f.n) / tot)}%)</title></path>`;
      a0 = a1;
    }
    const centro = pf.n ? (fat.find((f) => f.c === pf.n) || { n: 0 }).n : tot;
    const leg = fat.map((f) => `<button type="button" class="leg-it${pf.n === f.c ? " sel" : ""}" data-pf="n" data-v="${esc(f.c)}" aria-pressed="${pf.n === f.c}"><i style="background:${f.cor}"></i><span>${esc(f.c)}</span><b>${f.n}</b></button>`).join("");
    return `<div class="rosca"><svg viewBox="0 0 200 200" class="g-rosca" role="img" aria-label="Abordados por nicho">${arcos}
      <text x="100" y="98" text-anchor="middle" class="rc-n">${centro}</text><text x="100" y="118" text-anchor="middle" class="ex">${pf.n ? "no nicho" : "abordados"}</text></svg>
      <div class="rosca-leg">${leg}</div></div>`;
  }
  function renderPainelDash() {
    const el = $("#v-painel");
    const d = painelDados;
    if (!d) { el.innerHTML = `<div class="vista-int dash"><p class="vazio-msg">Carregando…</p></div>`; return; }
    const nomeEtapa = Object.fromEntries(d.etapas.map((e) => [e.id, e.nome]));
    const base = filtroBase(d.leads);
    const L = pf.n ? base.filter((l) => l.cat === pf.n) : base;
    const test = L.filter((l) => l.testado), resp = test.filter((l) => l.respondeu), link = test.filter((l) => l.link),
      prop = test.filter((l) => l.proposta), ganho = L.filter((l) => l.ganho);
    const valor = ganho.reduce((s, l) => s + l.valor, 0);
    // filtros
    const seg = (k, opts) => Object.entries(opts).map(([v, nome]) => `<button type="button" class="seg-b" data-pf="${k}" data-v="${esc(v)}" aria-pressed="${pf[k] === v}">${esc(nome)}</button>`).join("");
    const cidades = [...new Set(d.leads.map((l) => l.cidade))].sort((a, b) => (a === "Sem cidade") - (b === "Sem cidade") || a.localeCompare(b));
    const nCat = (c) => d.leads.filter((l) => l.cat === c && l.testado).length;
    const chipsN = ["", ...d.categorias.filter(nCat)].map((c) => `<button type="button" class="chip" data-pf="n" data-v="${esc(c)}" aria-pressed="${pf.n === c}">${c ? esc(c) : "Todos os nichos"}</button>`).join("");
    const algum = Object.keys(PF_PADRAO).some((k) => !["o", "od", "t", "td"].includes(k) && pf[k] !== PF_PADRAO[k]);
    // funil
    const passos = [["Abordados", test.length, null], ["Responderam", resp.length, taxa(resp.length, test.length)],
      ["Receberam link", link.length, taxa(link.length, resp.length)], ["Proposta / preço", prop.length, taxa(prop.length, link.length)],
      ["Fechados", ganho.length, taxa(ganho.length, prop.length)]];
    const lFunil = passos.map(([nome, n, t], i) => `<li>${i ? `<span class="fn-taxa" title="passagem da etapa anterior">${pct(t)}</span>` : ""}<span class="fn-n">${n}</span><span class="fn-nome">${nome}</span></li>`).join("")
      + `<li class="fn-rs"><span class="fn-n">${esc(moeda(valor) || "R$ 0")}</span><span class="fn-nome">ganho</span></li>`;
    const contEt = d.etapas.map((e) => [e, L.filter((l) => l.etapa === e.id).length]).filter(([, n]) => n);
    const lEtapas = contEt.map(([e, n]) => `<span class="et"><b>${n}</b> ${esc(e.nome)}</span>`).join("");
    // onde negam
    const perd = L.filter((l) => l.etapa === "perdido");
    const cn = Object.fromEntries(d.motivos.map((m) => [m.id, perd.filter((l) => l.negou === m.id).length]));
    const maxN = Math.max(1, ...Object.values(cn));
    const lBarras = d.motivos.map((m) => `<li class="${cn[m.id] ? "" : "zero"}"><span class="br-nome">${esc(m.nome)}</span><span class="br-trilho"><span class="br-barra" style="width:${(100 * cn[m.id]) / maxN}%"></span></span><span class="br-n">${cn[m.id]}</span></li>`).join("");
    // tabela por nicho
    const linhasN = d.categorias.map((c) => {
      const t = L.filter((l) => l.cat === c && l.testado);
      const r = t.filter((l) => l.respondeu).length;
      return { nicho: c, originais: [...new Set(L.filter((l) => l.cat === c).map((l) => l.nicho))].sort(), testados: t.length, responderam: r,
        recusaram: t.filter((l) => l.etapa === "perdido").length, avancaram: t.filter((l) => ["link", "proposta", "negociando"].includes(l.etapa)).length,
        ganharam: t.filter((l) => l.ganho).length, taxa: t.length ? Math.round((100 * r) / t.length) : -1 };
    }).filter((r) => r.testados);
    const sn = pf.td === "asc" ? 1 : -1;
    linhasN.sort((a, b) => (pf.t === "nicho" ? sn * a.nicho.localeCompare(b.nicho) : sn * (a[pf.t] - b[pf.t]) || a.nicho.localeCompare(b.nicho)));
    const thN = (k, nome, tit = "") => `<th scope="col"${tit ? ` title="${tit}"` : ""} aria-sort="${pf.t === k ? (pf.td === "asc" ? "ascending" : "descending") : "none"}"><button type="button" data-ord-n="${k}">${nome}${pf.t === k ? (pf.td === "asc" ? " ↑" : " ↓") : ""}</button></th>`;
    const lNichos = linhasN.map((r) => `<tr><th scope="row" title="${esc(r.originais.join(" · "))}">${esc(r.nicho)}</th><td>${r.testados}</td><td>${r.responderam}</td><td>${r.recusaram}</td><td>${r.avancaram}</td><td>${r.ganharam}</td><td class="tx">${r.taxa < 0 ? "–" : r.taxa + "%"}</td></tr>`).join("");
    // lista de leads
    const h = hojeISO();
    const parado = (l) => (l.etapa_desde ? diasEntre(diaDe(l.etapa_desde), h) : -1);
    const ORD = { alcance: (l) => l.alcance * 1000 - parado(l), nome: (l) => l.nome.toLowerCase(), nicho: (l) => l.cat, cidade: (l) => l.cidade, dias: parado };
    const so = pf.od === "asc" ? 1 : -1;
    const fo = ORD[pf.o] || ORD.alcance;
    const leads = [...L].sort((a, b) => { const A = fo(a), B = fo(b); return so * (A < B ? -1 : A > B ? 1 : 0) || a.nome.localeCompare(b.nome); });
    const thL = (k, nome) => `<th scope="col" aria-sort="${pf.o === k ? (pf.od === "asc" ? "ascending" : "descending") : "none"}"><button type="button" data-ord-l="${k}">${nome}${pf.o === k ? (pf.od === "asc" ? " ↑" : " ↓") : ""}</button></th>`;
    const LIM = 20, cortar = !painelTodos && leads.length > LIM + 5;
    const lLeads = (cortar ? leads.slice(0, LIM) : leads).map((l) => { const dp = parado(l); return `<tr data-abrir="${esc(l.slug)}">
        <th scope="row"><span class="ld-nome">${esc(l.nome)}</span><span class="ld-sub">${esc(l.cat)} · ${esc(l.cidade)}</span>${l.abriu && l.abriu.n ? `<span class="selo-abriu" title="${l.abriu.visitantes} visitante(s); miniatura do WhatsApp ${l.abriu.gerada}x">abriu ${l.abriu.n}x, último ${esc(l.abriu.ultimo.slice(11, 16))}</span>` : ""}</th>
        <td class="ld-nicho" title="${esc(l.nicho)}">${esc(l.cat)}</td><td class="ld-cid">${esc(l.cidade)}</td>
        <td><span class="et-tag e-${esc(l.etapa)}">${esc(nomeEtapa[l.etapa] || l.etapa)}</span></td>
        <td class="ld-ult" title="${esc(l.ultimo.texto)}">${l.ultimo.quando ? `<span class="ld-q">${esc(ddmm(l.ultimo.quando))}</span> ` : ""}${esc(l.ultimo.texto)}</td>
        <td class="ld-dias${dp >= 3 && !["perdido", "ganho", "retomar"].includes(l.etapa) ? " amb" : ""}">${dp < 0 ? "–" : dp === 0 ? "hoje" : dp + " d"}</td></tr>`; }).join("");
    // tempo real
    const a = d.agora;
    const fonte = a.fontes || {};
    const slugs = new Set(L.map((l) => l.slug));
    const wfs = a.workflows.filter((w) => w.ativos.length);
    const ags = wfs.flatMap((w) => w.ativos);
    const lAg = ags.length ? ags.map((x) => `<li><span class="ag-pt ${x.parado ? "parado" : ""}" aria-hidden="true"></span><span class="ag-nome">${esc(x.label)}</span><span class="ag-fase">${esc(x.fase)}</span>
        <span class="ag-ha">${x.parado ? `<span class="amb">sem atividade há ${esc(x.ultimo)}</span>` : esc(x.ha ? "há " + x.ha : "")}</span></li>`).join("")
      : `<li class="ag-vazio">Nenhum agente rodando${a.workflows.length ? ` · último workflow mexeu há ${esc(a.workflows[0].mod_ha)}` : ""}</li>`;
    const wfRes = wfs.map((w) => `${w.feitos}/${w.total} etapas`).join(" · ");
    const ig = a.instagram;
    const igTxt = ig.estado === "pausa" ? `em pausa até ${esc(ig.ate)}` : ig.estado === "livre" ? "livre" : "sem dado";
    const rec = a.recebidas.filter((r) => slugs.has(r.slug)).slice(0, 8);
    const lRec = rec.map((r) => `<li class="clica" data-abrir="${esc(r.slug)}" data-aba="whats"><span class="rc-q">${esc(rotuloQuando(r.quando))}</span><span class="rc-nome">${esc(r.nome)}</span>
        <span class="rc-txt ${r.auto ? "auto" : ""}" title="${esc(r.texto)}">${esc(r.texto)}</span></li>`).join("");
    const abert = (a.aberturas || []).filter((r) => slugs.has(r.slug)).slice(0, 8);
    const lAbr = abert.map((r) => `<li class="clica" data-abrir="${esc(r.slug)}"><span class="rc-q">${esc(rotuloQuando(r.quando))}</span><span class="rc-nome">${esc(r.nome)}</span><span class="rc-txt">${esc(r.disp)}</span></li>`).join("");
    const lLog = a.log.map((l) => `<li><span class="lg-q">${esc(l.dia === ddmm(h) ? l.hora : l.dia + " " + l.hora)}</span><span class="lg-txt" title="${esc(l.texto)}">${esc(l.texto)}</span></li>`).join("");
    const rolagem = el.scrollTop;
    el.innerHTML = `<div class="vista-int dash">
      <section class="d-filtros" aria-label="Filtro do painel">
        <div class="f-linha"><div class="seg" role="group" aria-label="Recorte">${seg("a", ATALHOS)}</div>
          <div class="seg" role="group" aria-label="Período pela Msg 1">${seg("p", PERIODOS)}</div>
          <div class="seg" role="group" aria-label="Cidade">${seg("c", { "": "Todas", ...Object.fromEntries(cidades.map((c) => [c, c])) })}</div>
          ${algum ? `<button type="button" class="btn-txt" data-pf-limpar>Limpar</button>` : ""}</div>
        <div class="chips f-nichos">${chipsN}</div>
      </section>
      <section class="d-bloco d-funil">
        <ol class="funil-num">${lFunil}</ol>
        <p class="etapas-agora">${lEtapas || "Nenhum lead neste filtro."}</p>
      </section>
      <div class="d-graf">
        <section class="d-bloco d-cartao"><h2>Por dia<span class="n">Msg 1, resposta, link e proposta</span></h2>${svgLinha(L)}</section>
        <section class="d-bloco d-cartao"><h2>Abordados por nicho<span class="n">clique filtra</span></h2>${svgRosca(base)}</section>
      </div>
      <div class="d-par">
        <section class="d-bloco d-negam d-cartao"><h2>Onde negam<span class="n">${perd.length} perdidos</span></h2><ul class="barras">${lBarras}</ul></section>
        <section class="d-bloco d-nichos"><h2>Por nicho</h2>
          <div class="tab-rola"><table class="t-nicho"><thead><tr>${thN("nicho", "Nicho")}${thN("testados", "Testados", "abordados ou além")}${thN("responderam", "Resp.")}${thN("recusaram", "Recus.", "perdidos")}${thN("avancaram", "Avanç.", "link, proposta ou negociando")}${thN("ganharam", "Ganhos")}${thN("taxa", "Taxa")}</tr></thead>
          <tbody>${lNichos}</tbody></table></div></section>
      </div>
      <section class="d-bloco d-leads"><h2>Leads<span class="n">${L.length}</span></h2>
        <div class="tab-rola"><table class="t-leads"><thead><tr>${thL("nome", "Nome")}${thL("nicho", "Nicho")}${thL("cidade", "Cidade")}${thL("alcance", "Etapa")}<th scope="col">Último evento</th>${thL("dias", "Parado")}</tr></thead>
        <tbody>${lLeads}</tbody></table></div>${cortar ? `<button type="button" class="btn sec ver-todos" data-ver-todos>Ver todos os ${leads.length}</button>` : ""}</section>
      <section class="d-agora" aria-label="Tempo real">
        ${fonte.agentes || fonte.instagram ? `<div class="d-bloco d-agentes"><h2>Agora${wfRes ? `<span class="n">${esc(wfRes)}</span>` : ""}</h2>${fonte.agentes ? `<ul class="agentes">${lAg}</ul>` : ""}
          ${fonte.instagram ? `<p class="ig ${ig.estado}"><span class="ig-pt" aria-hidden="true"></span>Instagram ${igTxt}${ig.estado === "pausa" ? ` <span class="mudo">(${esc(ig.falta)})</span>` : ""}</p>` : ""}</div>` : ""}
        <div class="d-bloco d-recebidas"><h2>Últimas respostas</h2><ul class="recebidas">${lRec || `<li class="ag-vazio">Nenhuma neste filtro</li>`}</ul>
          <h2>Abriram a prévia</h2><ul class="recebidas">${lAbr || `<li class="ag-vazio">Ninguém ainda</li>`}</ul></div>
        ${fonte.log ? `<div class="d-bloco d-log"><h2>Log</h2><ul class="log">${lLog || `<li class="ag-vazio">Sem linhas no log</li>`}</ul></div>` : ""}
      </section></div>`;
    el.scrollTop = rolagem;
  }
  $("#v-painel").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pf]");
    if (b) { const k = b.dataset.pf, v = b.dataset.v; pf[k] = k === "n" && pf.n === v ? "" : v; return pfGravar(); }
    if (e.target.closest("[data-ver-todos]")) { painelTodos = true; return renderPainelDash(); }
    if (e.target.closest("[data-pf-limpar]")) { pf = { ...PF_PADRAO, o: pf.o, od: pf.od, t: pf.t, td: pf.td }; return pfGravar(); }
    const ol = e.target.closest("[data-ord-l]");
    if (ol) { const k = ol.dataset.ordL; pf.od = pf.o === k ? (pf.od === "asc" ? "desc" : "asc") : (["nome", "nicho", "cidade"].includes(k) ? "asc" : "desc"); pf.o = k; return pfGravar(); }
    const on = e.target.closest("[data-ord-n]");
    if (on) { const k = on.dataset.ordN; pf.td = pf.t === k ? (pf.td === "asc" ? "desc" : "asc") : (k === "nicho" ? "asc" : "desc"); pf.t = k; return pfGravar(); }
  });
  $("#v-painel").addEventListener("keydown", (e) => {
    const f = e.target.closest("path[data-pf]");
    if (f && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); f.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
  });

  // ---------- vista Hoje ----------
  const ICO_WA = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 3a9 9 0 00-7.8 13.5L3 21l4.6-1.2A9 9 0 1012 3z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>`;
  const popAdiar = (rotulo = "Adiar") => `<div class="pop-wrap"><button type="button" class="btn sec" data-pop aria-expanded="false">${rotulo}</button>
    <div class="pop"><span class="rot-pop">Adiar para</span><div class="chips">
      <button type="button" class="chip" data-adiar="amanha">amanhã</button><button type="button" class="chip" data-adiar="+3">+3 d</button><button type="button" class="chip" data-adiar="+7">+1 sem</button></div>
      <form class="linha-pop" data-adiar-form><input name="quando" placeholder="dd/mm hh:mm" aria-label="Nova data" inputmode="numeric" autocomplete="off"><button class="btn sec">Ok</button></form></div></div>`;
  function renderHoje(base) {
    const ativos = base.filter((n) => !["ganho", "perdido"].includes(n.etapa));
    const cobs = ativos.flatMap((n) => cobDevidas(n).map((c) => ({ n, c }))).sort((a, b) => (a.c.quando < b.c.quando ? -1 : 1));
    const resp = ativos.filter(aguardaMeu).sort((a, b) => idadeResposta(b) - idadeResposta(a));
    const prazos = ativos.filter((n) => estadoProx(n) && !temCobrar(n) && !aguardaMeu(n)).sort((a, b) => (a.proximo_em < b.proximo_em ? -1 : 1));
    const futuras = ativos.flatMap((n) => cobAbertas(n).filter((c) => !estadoCob(c)).map((c) => ({ n, c }))).sort((a, b) => (a.c.quando < b.c.quando ? -1 : 1)).slice(0, 6);
    const grupo = (tit, n, corpo) => `<section class="grupo"><h2>${tit}<span class="n">${n}</span></h2>${corpo}</section>`;
    const lCob = cobs.map(({ n, c }) => {
      const wa = waApp(n, c.texto_sugerido);
      return `<li data-slug="${esc(n.slug)}" data-cid="${esc(c.id)}">
        <button class="l-nome" data-abrir="${esc(n.slug)}">${esc(n.nome)}</button>
        <span class="l-quando e-${estadoCob(c)}">${esc(rotuloCob(c))}</span>
        <span class="l-txt" title="${esc(c.motivo)}">${esc(c.motivo)}${c.auto ? ` <span class="l-auto">sugestão</span>` : ""}</span>
        <span class="l-acoes">${wa ? `<a class="btn sec" href="${esc(wa)}">${ICO_WA}WhatsApp</a>` : ""}${c.texto_sugerido ? `<button class="btn sec" data-copiar>Copiar</button>` : ""}<button class="btn sec" data-feita>Feita</button>${popAdiar()}</span></li>`;
    }).join("");
    const lResp = resp.map((n) => {
      const u = ultimoContato(n), t = String(u.texto || "").replace(/\s+/g, " ").trim();
      return `<li class="clica" data-abrir="${esc(n.slug)}" data-aba="whats"><span class="l-nome">${esc(n.nome)}</span><span class="l-quando ${respAtrasada(n) ? "verm" : "amb"}">${esc(rotuloIdade(idadeResposta(n)))}</span><span class="l-txt">${t ? "“" + esc(t) + "”" : ""}</span></li>`;
    }).join("");
    const lPrazo = prazos.map((n) => {
      const ep = estadoProx(n);
      return `<li class="clica" data-abrir="${esc(n.slug)}"><span class="l-nome">${esc(n.nome)}</span><span class="l-quando ${ep === "atrasado" ? "verm" : "amb"}">${ep === "hoje" ? "hoje" : "atrasado " + ddmm(n.proximo_em)}</span><span class="l-txt">${esc(passoLimpo(n))}</span></li>`;
    }).join("");
    const lFut = futuras.map(({ n, c }) => `<li class="clica" data-abrir="${esc(n.slug)}"><span class="l-nome">${esc(n.nome)}</span><span class="l-quando">${esc(fmtQuando(c.quando))}</span><span class="l-txt">${esc(c.motivo)}</span></li>`).join("");
    const nada = !cobs.length && !resp.length && !prazos.length;
    $("#v-hoje").innerHTML = `<div class="vista-int">
      ${nada ? `<p class="vazio-msg">Nada pendente hoje.</p>` : ""}
      ${cobs.length ? grupo("Cobrar", cobs.length, `<ul class="lista">${lCob}</ul>`) : ""}
      ${resp.length ? grupo("Responder", resp.length, `<ul class="lista">${lResp}</ul>`) : ""}
      ${prazos.length ? grupo("Prazos", prazos.length, `<ul class="lista">${lPrazo}</ul>`) : ""}
      ${futuras.length ? grupo("Próximas cobranças", futuras.length, `<ul class="lista">${lFut}</ul>`) : ""}</div>`;
  }

  // ---------- mensagens por fase (texto do roteiro.md, lido ao vivo pelo servidor) ----------
  const FASE_ROT = { m1: "Msg 1", m2: "Msg 2", m2a: "Msg 2 atendente", m3: "Msg 3", fu: "Follow-up" };
  const FASE_SUB = { m1: "saudação", m2: "licença", m2a: "se cair em atendente", m3: "link", fu: "se não respondeu" };
  const FASE_ORDEM = ["m1", "m2", "m2a", "m3", "fu"];
  const tarde = () => new Date().getHours() >= 18;
  const saudacao = () => (new Date().getHours() < 12 ? "Bom dia" : "Boa tarde") + ", tudo bem?";
  const AVISO_TARDE = `<p class="aviso-tarde">Depois das 18h, melhor amanhã.</p>`;
  function textoFase(n, k) {
    const f = (n.fases || {})[k] || {};
    if (k === "m1" && f.origem === "padrao") return saudacao(); // a hora certa é a do clique
    return f.texto || "";
  }
  const envio = (n, k) => (n.envios || {})[k];
  // próxima fase a mandar: Msg 1, depois Msg 2 (ou a de atendente), depois Msg 3, depois Follow-up.
  // A etapa manda: quem foi movido antes das fases (sem envio marcado) não recebe sugestão de Msg 1 de novo.
  const ETAPA_POS = ["previa", "abordado", "respondeu", "link", "proposta", "negociando", "ganho", "perdido", "retomar"];
  const semFila = (n) => ["proposta", "negociando", "ganho", "perdido", "retomar"].includes(n.etapa);
  // fase que a etapa já deixou pra trás, mesmo sem envio marcado
  function fasePassou(n, k) {
    if (envio(n, k)) return false;
    const i = ETAPA_POS.indexOf(n.etapa);
    if (k === "m1") return i >= 1;
    return k !== "fu" && i >= 3 && n.etapa !== "retomar";
  }
  const etapaSemEnvio = (n) => n.etapa !== "previa" && !envio(n, "m1") && !semFila(n) && n.etapa !== "link";
  function proximaFase(n) {
    if (semFila(n)) return "";
    if (n.etapa === "link") return envio(n, "fu") ? "" : "fu";
    if (etapaSemEnvio(n)) return "";
    if (!envio(n, "m1")) return "m1";
    if (!envio(n, "m2") && !envio(n, "m2a")) return "m2";
    if (!envio(n, "m3")) return "m3";
    return envio(n, "fu") ? "" : "fu";
  }
  const waTexto = (n, t) => waApp(n, t);
  const enviando = new Set(); // trava contra clique/Enter duplo antes da resposta
  async function marcarEnviada(slug, fase, depois) {
    const n = porSlug(slug), nome = n ? n.nome : slug, chave = slug + ":" + fase;
    if (enviando.has(chave) || envio(n || {}, fase)) return false;
    enviando.add(chave);
    let ok;
    try { ok = await enviar("/api/enviada", { slug, fase }); } finally { enviando.delete(chave); }
    if (!ok) return false;
    if (depois) { depois(); render(); if (aberto) renderPainel(false); }
    toast(`${FASE_ROT[fase]} marcada · ${nome}`, false, { rot: "Desfazer", fn: () => desfazerEnviada(slug, fase) });
    return true;
  }
  async function desfazerEnviada(slug, fase) {
    if (await enviar("/api/enviada", { slug, fase, desfazer: true })) {
      filaFeitos = Math.max(0, filaFeitos - (fase === "m1" && filaMarcadas.delete(slug) ? 1 : 0));
      render();
      toast(`${FASE_ROT[fase]} desfeita`);
    }
  }

  // ---------- vista Fila de envio ----------
  // pulados vão pro fim e assim ficam até o fim do dia (localStorage, por data)
  const pulGuardado = ls.get("crm.pulados", {});
  let pulDia = hojeISO();
  let filaPulados = pulGuardado.dia === pulDia && Array.isArray(pulGuardado.slugs) ? pulGuardado.slugs : [];
  const salvarPulados = () => ls.set("crm.pulados", { dia: pulDia, slugs: filaPulados });
  let filaFeitos = 0;            // marcados pela fila nesta sessão (contador "3 de 10")
  const filaMarcadas = new Set();
  const m2Escolha = {};          // slug -> "m2" | "m2a"
  const ICO_COPIAR = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M10.5 3.5v-.5a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h.5" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>`;
  function filaOrdenada() {
    const L = dados.fila.map(porSlug).filter((n) => n && passa(n));
    if (pulDia !== hojeISO()) { pulDia = hojeISO(); filaPulados = []; salvarPulados(); } // virou o dia: pulados voltam
    const naFila = new Set(dados.fila); // fila inteira, sem o filtro de busca, pra não perder pulado ao filtrar
    if (dados.versao && filaPulados.some((s) => !naFila.has(s))) { filaPulados = filaPulados.filter((s) => naFila.has(s)); salvarPulados(); }
    const vivos = new Set(L.map((n) => n.slug));
    const fila = [...L.filter((n) => !filaPulados.includes(n.slug)), ...filaPulados.filter((s) => vivos.has(s)).map(porSlug)];
    return fila; // o servidor já deixa de fora quem não tem WhatsApp (fila_sem_numero)
  }
  function botoesEnvio(n, k, { atalhos = false, enviei = "Enviei", soIcone = false, exigeNumero = false } = {}) {
    const t = textoFase(n, k), wa = t ? waTexto(n, t) : "";
    const kb = (x) => (atalhos ? `<kbd>${x}</kbd>` : "");
    const cop = soIcone
      ? `<button type="button" class="btn sec so-ico" data-copiar-fase="${k}" aria-label="Copiar texto" title="Copiar texto"${t ? "" : " disabled"}>${ICO_COPIAR}</button>`
      : `<button type="button" class="btn sec" data-copiar-fase="${k}"${t ? "" : " disabled"}>${ICO_COPIAR}Copiar${kb("C")}</button>`;
    return `${cop}
      ${wa ? `<a class="btn wa" href="${esc(wa)}" data-wa-fase="${k}">${ICO_WA}Abrir no WhatsApp</a>` : `<span class="btn sec off" aria-disabled="true">Sem WhatsApp</span>`}
      <button type="button" class="btn" data-enviei="${k}"${t && (wa || !exigeNumero) ? "" : " disabled"}>${enviei}${kb("Enter")}</button>`;
  }
  function renderFila() {
    const L = filaOrdenada(), atual = L[0];
    const total = filaFeitos + L.length;
    let topo;
    if (!atual) {
      topo = `<div class="envio-vazio"><b>Ninguém na fila.</b> Todo mundo em Prévia pronta com número já recebeu a Msg 1.</div>`;
    } else {
      const ct = contatoWA(atual), p = atual.previa || {};
      const prox = L.slice(1);
      topo = `<div class="fila-grade">
        <article class="envio-card" data-slug="${esc(atual.slug)}" aria-label="Próximo envio: ${esc(atual.nome)}">
          <div class="ec-top"><span class="ec-cont">${filaFeitos + 1} de ${total}</span><span class="ec-fase">Msg 1 · saudação</span></div>
          <h2><button class="ec-nome" data-abrir="${esc(atual.slug)}" data-aba="msgs" title="Abrir o negócio">${esc(atual.nome)}</button></h2>
          <div class="ec-sub">${esc([atual.cidade, atual.nicho].filter(Boolean).join(" · "))}</div>
          <dl class="ec-linhas">
            <div><dt>WhatsApp</dt><dd class="num">${ct ? esc(fmtTel(ct.whatsapp)) : `<span class="mudo">sem número</span>`}</dd></div>
            <div><dt>Prévia</dt><dd>${p.url ? ext(p.url) : `<span class="mudo">sem link</span>`}${p.publicada ? "" : ` <span class="selo">não publicada</span>`}</dd></div>
          </dl>
          ${passoLimpo(atual) ? `<p class="ec-passo"><b>Próximo passo</b> ${esc(passoLimpo(atual))}</p>` : ""}
          <div class="ec-msg"><div class="bolha eu primeira">${esc(textoFase(atual, "m1"))}</div></div>
          <div class="ec-acoes">${botoesEnvio(atual, "m1", { atalhos: true, exigeNumero: true })}
            <button type="button" class="btn-txt ec-pular" data-pular>Pular<kbd>→</kbd></button></div>
        </article>
        <aside class="fila-prox" aria-label="Próximos">
          <h3>Próximos<span class="n">${prox.length}</span></h3>
          ${prox.length ? `<ol>${prox.map((n) => `<li><button data-abrir="${esc(n.slug)}" data-aba="msgs"><span class="fp-nome">${esc(n.nome)}</span><span class="fp-sub">${esc(n.cidade || "")}${filaPulados.includes(n.slug) ? " · pulado" : ""}</span></button></li>`).join("")}</ol>` : `<p class="mudo">Último da fila.</p>`}
        </aside></div>`;
    }
    if (dados.fila_sem_numero) topo += `<p class="fila-sem-num">${dados.fila_sem_numero} sem número</p>`;
    const m2 = dados.fila_msg2.map(porSlug).filter((n) => n && passa(n));
    const lM2 = m2.map((n) => {
      const k = m2Escolha[n.slug] || "m2", t = textoFase(n, k), e1 = envio(n, "m1");
      return `<li class="m2-item" data-slug="${esc(n.slug)}">
        <div class="m2-cab"><div class="m2-id"><button class="l-nome" data-abrir="${esc(n.slug)}" data-aba="msgs">${esc(n.nome)}</button>
          <span class="l-quando">Msg 1 ${esc(rotuloIdade(Date.now() - msDe(e1.quando)))}</span></div>
          <button type="button" class="btn sec m2-abrir" data-abrir="${esc(n.slug)}" data-aba="msgs">Abrir</button>
          <span class="seg" role="radiogroup" aria-label="Versão da Msg 2">
            <button type="button" role="radio" data-m2k="m2" aria-checked="${k === "m2"}">Dono</button><button type="button" role="radio" data-m2k="m2a" aria-checked="${k === "m2a"}">Atendente</button></span></div>
        <p class="m2-txt" tabindex="0" role="button" aria-expanded="false" title="Ver a mensagem inteira">${t ? esc(t) : `<span class="mudo">sem texto no roteiro</span>`}</p>
        <div class="l-acoes">${botoesEnvio(n, k)}</div></li>`;
    }).join("");
    $("#v-fila").innerHTML = `<div class="vista-int">
      ${tarde() ? AVISO_TARDE : ""}${topo}
      <section class="grupo m2-grupo"><h2>Msg 2 a mandar<span class="n">${m2.length}</span></h2>
        ${m2.length ? `<ul class="lista m2-lista">${lM2}</ul>` : `<p class="vazio-msg">Ninguém esperando a Msg 2.</p>`}</section></div>`;
  }
  function filaAtual() { const L = filaOrdenada(); return L[0] || null; }
  function filaPular() {
    const a = filaAtual();
    if (!a) return;
    if (filaOrdenada().length < 2) return toast("Ninguém mais na fila");
    filaPulados = filaPulados.filter((s) => s !== a.slug).concat(a.slug);
    salvarPulados();
    renderFila();
  }
  async function filaEnviei() {
    const a = filaAtual();
    if (!a || !textoFase(a, "m1") || !contatoWA(a)) return;
    await marcarEnviada(a.slug, "m1", () => { filaFeitos++; filaMarcadas.add(a.slug); filaPulados = filaPulados.filter((s) => s !== a.slug); salvarPulados(); });
  }
  $("#v-fila").addEventListener("click", (e) => {
    const t = e.target;
    // clique de mouse não deixa o foco preso no botão: os atalhos (C, Enter, →) seguem valendo
    const bt = t.closest("button, a");
    if (e.detail && bt && bt.closest(".envio-card")) bt.blur();
    const mt = t.closest(".m2-txt");
    if (mt && !t.closest("a")) { mt.classList.toggle("aberto"); mt.setAttribute("aria-expanded", mt.classList.contains("aberto")); return; }
    if (t.closest("[data-pular]")) return filaPular();
    const seg = t.closest("[data-m2k]");
    if (seg) { m2Escolha[seg.closest("[data-slug]").dataset.slug] = seg.dataset.m2k; return renderFila(); }
    const el = t.closest("[data-slug]");
    if (!el) return;
    const n = porSlug(el.dataset.slug);
    const cp = t.closest("[data-copiar-fase]");
    if (cp) return copiar(textoFase(n, cp.dataset.copiarFase));
    const ev = t.closest("[data-enviei]");
    if (ev) return el.matches(".envio-card") ? filaEnviei() : marcarEnviada(n.slug, ev.dataset.enviei);
  });
  $("#v-fila").addEventListener("keydown", (e) => {
    const mt = e.target.closest && e.target.closest(".m2-txt");
    if (mt && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); mt.click(); }
  });
  document.addEventListener("keydown", (e) => {
    if (vista !== "fila" || aberto || dlg.open || e.metaKey || e.ctrlKey || e.altKey) return;
    // foco num botão ou link: Enter é dele (Pular pula, Abrir abre), não vira "Enviei"
    if (e.target.closest && e.target.closest("input, textarea, select, button, a, [role=radio], [contenteditable], .m2-lista")) return;
    const a = filaAtual();
    if (!a) return;
    if (e.key === "c" || e.key === "C") { e.preventDefault(); copiar(textoFase(a, "m1")); }
    else if (e.key === "Enter") { e.preventDefault(); filaEnviei(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); filaPular(); }
  });

  // ---------- aba Mensagens do painel ----------
  function fasesHTML(n) {
    const prox = proximaFase(n);
    const itens = FASE_ORDEM.map((k) => {
      const env = envio(n, k), f = (n.fases || {})[k] || {}, t = textoFase(n, k);
      const outraM2 = (k === "m2" && envio(n, "m2a")) || (k === "m2a" && envio(n, "m2"));
      const aberta = k in ui.fases ? ui.fases[k] : k === prox;
      const est = env ? `<span class="f-est ok">enviada ${esc(fmtQuando(env.quando))}</span>`
        : fasePassou(n, k) ? `<span class="f-est">etapa já passou</span>`
        : outraM2 ? `<span class="f-est">não precisa</span>` : f.origem === "editado" ? `<span class="f-est">texto editado</span>` : "";
      const cab = `<div class="fase-cab"><button type="button" class="fase-tog" data-fase-tog="${k}" aria-expanded="${aberta}">
          <span class="f-nome">${FASE_ROT[k]}</span><span class="f-sub">${FASE_SUB[k]}</span>${est}</button>
        ${env && Date.now() - msDe(env.quando) <= 3600000 ? `<button type="button" class="btn-txt" data-desfazer-fase="${k}">Desfazer</button>`
          : env ? ""
          : aberta && ui.editFase !== k && !(k === "m1" && f.origem === "padrao") ? `<button type="button" class="btn-txt" data-fase-editar="${k}">Editar texto</button>` : ""}</div>`;
      if (!aberta) return `<li class="fase${env ? " enviada" : ""}" data-fase="${k}">${cab}</li>`;
      const editando = ui.editFase === k;
      const corpo = editando
        ? `<form class="f-edit" data-fase-form="${k}"><textarea name="texto" rows="5" aria-label="Texto da ${FASE_ROT[k]}">${esc(f.texto || t)}</textarea>
            <div class="f-acoes">${f.origem === "editado" ? `<button type="button" class="btn-txt" data-fase-roteiro="${k}">Voltar ao roteiro</button>` : ""}<span class="esp"></span>
            <button type="button" class="btn-txt" data-fase-cancelar>Cancelar</button><button class="btn">Salvar</button></div></form>`
        : `<div class="f-texto">${t ? linkify(t) : `<span class="mudo">Sem texto no roteiro.md desta prévia.</span>`}</div>
          ${env ? "" : `<div class="f-acoes">${botoesEnvio(n, k, { enviei: "Marcar enviada", soIcone: true })}</div>`}`;
      return `<li class="fase aberta${env ? " enviada" : ""}" data-fase="${k}">${cab}${corpo}</li>`;
    }).join("");
    const pub = n.previa && n.previa.url && !n.previa.publicada ? `<p class="f-nota">Prévia ainda não publicada: confira o link antes da Msg 3.</p>` : "";
    const sem = etapaSemEnvio(n) ? `<p class="f-nota">Foi pra ${esc(n.etapa === "respondeu" ? "Respondeu" : "Abordado")} sem envio marcado aqui: abra a fase que falta.</p>` : "";
    return `${tarde() ? AVISO_TARDE : ""}${sem}<ol class="fases">${itens}</ol>${pub}
      ${n.fases && Object.values(n.fases).some((f) => f.origem === "roteiro") ? "" : `<p class="f-nota">Não achei a seção Mensagens no roteiro.md desta prévia.</p>`}`;
  }
  const corpoMsgs = $("#corpo-msgs");
  corpoMsgs.addEventListener("click", async (e) => {
    const t = e.target, n = porSlug(aberto.slug);
    const tog = t.closest("[data-fase-tog]");
    if (tog) { const k = tog.dataset.faseTog; ui.fases[k] = tog.getAttribute("aria-expanded") !== "true"; if (!ui.fases[k] && ui.editFase === k) ui.editFase = ""; return renderPainel(false); }
    const cp = t.closest("[data-copiar-fase]");
    if (cp) return copiar(textoFase(n, cp.dataset.copiarFase));
    const ev = t.closest("[data-enviei]");
    if (ev) { const k = ev.dataset.enviei; return marcarEnviada(n.slug, k, () => { delete ui.fases[k]; }); }
    const dz = t.closest("[data-desfazer-fase]");
    if (dz) return desfazerEnviada(n.slug, dz.dataset.desfazerFase);
    const ed = t.closest("[data-fase-editar]");
    if (ed) { ui.editFase = ed.dataset.faseEditar; renderPainel(false); const ta = $("textarea", corpoMsgs); if (ta) ta.focus(); return; }
    if (t.closest("[data-fase-cancelar]")) { ui.editFase = ""; return renderPainel(false); }
    const rt = t.closest("[data-fase-roteiro]");
    if (rt) { ui.editFase = ""; if (await enviar("/api/editar", { slug: n.slug, campos: { ["textos." + rt.dataset.faseRoteiro]: "" } })) toast("Voltou ao texto do roteiro"); }
  });
  corpoMsgs.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, k = f.dataset.faseForm;
    if (!k) return;
    const n = porSlug(aberto.slug);
    const v = f.texto.value.trim();
    const igual = v === ((n.fases || {})[k] || {}).texto;
    ui.editFase = "";
    if (igual) return renderPainel(false);
    if (await enviar("/api/editar", { slug: n.slug, campos: { ["textos." + k]: v } })) toast("Texto salvo neste negócio");
  });

  // ---------- vista Contatos ----------
  function contatosFiltrados() {
    const t = termos();
    return dados.contatos.filter((c) => !t.length || t.every((p) => [c.nome, c.papel, c.whatsapp, fmtTel(c.whatsapp), c.negocio_nome, c.nota].join(" ").toLowerCase().includes(p)));
  }
  function renderContatos() {
    const cs = contatosFiltrados();
    // sem nome: o negócio vira o nome (o papel já tem coluna própria / linha de apoio)
    const nome = (c) => c.nome ? esc(c.nome) : c.negocio_nome ? esc(c.negocio_nome) : `<span class="sem">Sem nome</span>`;
    const neg = (c) => c.negocio ? `<button class="t-neg" data-abrir="${esc(c.negocio)}">${esc(c.negocio_nome)}</button>` : `<span class="t-avulso">sem negócio</span>`;
    const tel = (c) => c.whatsapp ? `<a href="${esc(waUrl(c.whatsapp))}" target="_blank" rel="noopener">${esc(fmtTel(c.whatsapp))}</a>` : "";
    $("#v-contatos").innerHTML = `<div class="vista-int">
      ${cs.length ? `<table class="tabela"><thead><tr><th>Nome</th><th>Papel</th><th>WhatsApp</th><th>Negócio</th><th>Nota</th></tr></thead><tbody>
      ${cs.map((c) => `<tr data-contato="${esc(c.id)}"><td class="t-nome">${nome(c)}</td><td class="t-mudo">${esc(c.papel)}</td><td>${tel(c)}</td><td>${neg(c)}</td><td class="t-mudo">${esc(c.nota)}</td></tr>`).join("")}
      </tbody></table>
      <ul class="lista cont-lista">${cs.map((c) => `<li class="clica" data-contato="${esc(c.id)}"><span class="l-nome">${nome(c)}</span><span class="l-quando">${esc(fmtTel(c.whatsapp))}</span><span class="l-txt">${esc([c.papel, c.negocio_nome || "sem negócio", c.nota].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul>`
        : `<p class="vazio-msg">${dados.contatos.length ? "Nenhum contato com essa busca." : "Nenhum contato ainda."}</p>`}</div>`;
  }

  // ---------- diálogo de contato ----------
  const dlg = $("#dlg-contato"), fc = $("#form-contato");
  let dlgId = null;
  const nomeNeg = (slug) => { const n = porSlug(slug); return n ? `${n.nome} (${slug})` : ""; };
  function slugDeTexto(t) {
    t = String(t || "").trim();
    if (!t) return "";
    const m = t.match(/\(([a-z0-9-]+)\)\s*$/);
    if (m && porSlug(m[1])) return m[1];
    const n = dados.negocios.find((x) => x.slug === t || x.nome.toLowerCase() === t.toLowerCase());
    return n ? n.slug : null;
  }
  function abrirContato(id, negocio) {
    dlgId = id || null;
    const c = id ? dados.contatos.find((x) => x.id === id) : null;
    $("#dl-negocios").innerHTML = dados.negocios.slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((n) => `<option value="${esc(n.nome)} (${esc(n.slug)})">`).join("");
    $("#dlg-tit").textContent = c ? "Editar contato" : "Novo contato";
    fc.nome.value = c ? c.nome : "";
    fc.whatsapp.value = c ? fmtTel(c.whatsapp) : "";
    fc.negocio.value = nomeNeg(c ? c.negocio : negocio || "");
    fc.papel.value = c ? c.papel || "" : "";
    fc.nota.value = c ? c.nota || "" : "";
    $(".dlg-mais", fc).open = !!(c && (c.papel || c.nota));
    $("#dlg-apagar").hidden = !c;
    dlg.showModal();
    fc.nome.focus();
  }
  fc.addEventListener("submit", async (e) => {
    e.preventDefault();
    const negocio = slugDeTexto(fc.negocio.value);
    if (negocio === null) { toast("Negócio não encontrado. Escolha da lista ou deixe vazio.", true); return fc.negocio.focus(); }
    const campos = { nome: fc.nome.value.trim(), whatsapp: fc.whatsapp.value, negocio, papel: fc.papel.value, nota: fc.nota.value.trim() };
    if (!digitos(campos.whatsapp)) { toast("Informe o WhatsApp", true); return fc.whatsapp.focus(); }
    const ok = dlgId ? await enviar("/api/contato/editar", { id: dlgId, campos }) : await enviar("/api/contato", campos);
    if (ok) { dlg.close(); toast(dlgId ? "Contato salvo" : "Contato cadastrado"); }
  });
  $("#dlg-cancelar").addEventListener("click", () => dlg.close());
  $("#dlg-apagar").addEventListener("click", async () => {
    if (dlgId && confirm("Apagar este contato?") && await enviar("/api/contato/apagar", { id: dlgId })) dlg.close();
  });
  $("#novo-contato").addEventListener("click", () => abrirContato(null));

  // ---------- cliques globais ----------
  async function copiar(t) {
    try { await navigator.clipboard.writeText(t); }
    catch (_) { const a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); document.execCommand("copy"); a.remove(); }
    toast("Texto copiado");
  }
  // cobrança de uma linha (vista Hoje ou painel): {slug, id}
  const cobDe = (el) => { const li = el.closest("[data-cid]"); return li ? { slug: li.dataset.slug || (aberto && aberto.slug), id: li.dataset.cid } : null; };
  function fecharPops(exceto) { $$(".pop-wrap.aberto").forEach((p) => { if (p !== exceto) { p.classList.remove("aberto"); const b = $("[data-pop]", p); if (b) b.setAttribute("aria-expanded", "false"); } }); }
  document.addEventListener("click", (e) => {
    const wrap = e.target.closest(".pop-wrap");
    fecharPops(wrap);
    const pb = e.target.closest("[data-pop]");
    if (pb) {
      const w = pb.closest(".pop-wrap"), ab = !w.classList.contains("aberto");
      w.classList.toggle("aberto", ab);
      pb.setAttribute("aria-expanded", ab);
      if (ab) { const i = $(".pop input:not([type=hidden])", w); if (i && !celular()) setTimeout(() => i.focus(), 0); }
      return;
    }
    const nav = e.target.closest("[data-ir]");
    if (nav) { e.preventDefault(); return irPara(nav.dataset.ir); }
    const iv = e.target.closest("[data-ir-v]");
    if (iv) return irPara(iv.dataset.irV);
    if (e.target.closest("#lat-rec")) {
      const r = document.body.classList.toggle("lat-recolhida");
      ls.set("crm-lateral", r);
      $("#lat-rec").setAttribute("aria-label", r ? "Expandir barra lateral" : "Recolher barra lateral");
      return;
    }
    const ct = e.target.closest("[data-contato]");
    if (ct && !e.target.closest("a, [data-abrir]")) return abrirContato(ct.dataset.contato);
    if (e.target.closest("a")) return;
    const ab = e.target.closest("[data-abrir]");
    if (ab) return abrir(ab.dataset.abrir, ab.dataset.aba || "dados");
    const cb = cobDe(e.target);
    if (cb && e.target.closest("[data-copiar]")) { const n = porSlug(cb.slug); const c = n && n.cobrancas.find((x) => x.id === cb.id); return c && copiar(c.texto_sugerido); }
    if (cb && e.target.closest("[data-feita]")) return enviar("/api/cobranca/feita", cb);
    const ad = e.target.closest("[data-adiar]");
    if (cb && ad) { fecharPops(); return enviar("/api/cobranca/adiar", { ...cb, quando: ad.dataset.adiar }); }
    const f = e.target.closest("[data-fila]");
    if (f) { fila = fila === f.dataset.fila ? "" : f.dataset.fila; return render(); }
    const r = e.target.closest("[data-rec]");
    if (r) return alternarRec(r.dataset.rec, !!r.closest(".coluna.recolhida"));
  });
  document.addEventListener("submit", (e) => {
    const f = e.target.closest("[data-adiar-form]");
    if (!f) return;
    e.preventDefault();
    const q = f.quando.value.trim(), cb = cobDe(f);
    if (q && cb) { fecharPops(); enviar("/api/cobranca/adiar", { ...cb, quando: q }); }
  });

  // ---------- arrastar card (mouse e toque) ----------
  let arr = null;
  const colunaEm = (x, y) => { const el = document.elementFromPoint(x, y); return el ? el.closest(".coluna") : null; };
  function iniciarArrasto(x, y) {
    arr.ativo = true;
    const r = arr.el.getBoundingClientRect();
    arr.dx = x - r.left; arr.dy = y - r.top;
    arr.fantasma = arr.el.cloneNode(true);
    arr.fantasma.classList.add("fantasma");
    arr.fantasma.style.width = r.width + "px";
    document.body.appendChild(arr.fantasma);
    arr.el.classList.add("arrastando");
    moverArrasto(x, y);
  }
  function moverArrasto(x, y) {
    arr.fantasma.style.left = x - arr.dx + "px";
    arr.fantasma.style.top = y - arr.dy + "px";
    const c = colunaEm(x, y);
    $$(".coluna.alvo").forEach((k) => k !== c && k.classList.remove("alvo"));
    if (c && c.dataset.etapa !== arr.origem) c.classList.add("alvo");
    const q = $("#quadro"), qr = q.getBoundingClientRect();
    if (x > qr.right - 60) q.scrollLeft += 14; else if (x < qr.left + 60) q.scrollLeft -= 14;
  }
  async function terminarArrasto(x, y, cancelar) {
    const a = arr; arr = null;
    clearTimeout(a.timer);
    if (!a.ativo) return false;
    a.fantasma.remove();
    a.el.classList.remove("arrastando");
    $$(".coluna.alvo").forEach((k) => k.classList.remove("alvo"));
    const c = cancelar ? null : colunaEm(x, y);
    if (c && c.dataset.etapa !== a.origem) {
      const n = porSlug(a.slug);
      n.etapa = c.dataset.etapa; // otimista: entra no topo da coluna
      n.etapa_desde = `${hojeISO()} ${new Date().toTimeString().slice(0, 5)}`;
      n.etapa_desde_fonte = "movimento";
      n.etapa_seq = Date.now() / 1000;
      render();
      await enviar("/api/mover", { slug: a.slug, etapa: c.dataset.etapa });
    }
    return true;
  }
  const quadro = $("#quadro");
  quadro.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    const el = e.target.closest(".cartao");
    if (!el) return;
    arr = { slug: el.dataset.slug, origem: el.closest(".coluna").dataset.etapa, el, x0: e.clientX, y0: e.clientY, ativo: false };
  });
  window.addEventListener("pointermove", (e) => {
    if (!arr || arr.toque) return;
    if (!arr.ativo && Math.hypot(e.clientX - arr.x0, e.clientY - arr.y0) > 5) iniciarArrasto(e.clientX, e.clientY);
    if (arr && arr.ativo) moverArrasto(e.clientX, e.clientY);
  });
  window.addEventListener("pointerup", async (e) => {
    if (!arr || arr.toque) return;
    const el = arr.el;
    const arrastou = await terminarArrasto(e.clientX, e.clientY);
    if (!arrastou && e.target.closest(".cartao") === el) abrir(el.dataset.slug);
  });
  quadro.addEventListener("touchstart", (e) => {
    const el = e.target.closest(".cartao");
    if (!el || e.touches.length > 1) return;
    const t = e.touches[0];
    arr = { slug: el.dataset.slug, origem: el.closest(".coluna").dataset.etapa, el, x0: t.clientX, y0: t.clientY, ativo: false, toque: true, moveu: false };
    arr.timer = setTimeout(() => { if (arr && !arr.moveu) { iniciarArrasto(arr.x0, arr.y0); if (navigator.vibrate) navigator.vibrate(10); } }, 300);
  }, { passive: true });
  quadro.addEventListener("touchmove", (e) => {
    if (!arr || !arr.toque) return;
    const t = e.touches[0];
    if (arr.ativo) { e.preventDefault(); moverArrasto(t.clientX, t.clientY); }
    else if (Math.hypot(t.clientX - arr.x0, t.clientY - arr.y0) > 8) { arr.moveu = true; clearTimeout(arr.timer); }
  }, { passive: false });
  quadro.addEventListener("touchend", async (e) => {
    if (!arr || !arr.toque) return;
    const t = e.changedTouches[0];
    const { el, moveu } = arr;
    const arrastou = await terminarArrasto(t.clientX, t.clientY);
    if (arrastou) e.preventDefault();
    else if (!moveu) { e.preventDefault(); abrir(el.dataset.slug); }
  });
  quadro.addEventListener("touchcancel", () => { if (arr && arr.toque) terminarArrasto(0, 0, true); });
  document.addEventListener("keydown", (e) => {
    const el = e.target.closest && e.target.closest(".cartao, li.clica, tr[data-contato]");
    if (el && (e.key === "Enter" || e.key === " ") && e.target === el) { e.preventDefault(); el.click(); if (el.matches(".cartao")) abrir(el.dataset.slug); }
  });

  // ---------- painel ----------
  function abrir(slug, aba) {
    if (!aberto || aberto.slug !== slug) ui = { prox: false, anotar: false, hist: false, det: false, editar: false, fases: {}, editFase: "" };
    aberto = { slug, aba: aba || (aberto && aberto.aba) || "dados" };
    document.body.classList.add("com-painel");
    $("#painel").setAttribute("aria-hidden", "false");
    history.replaceState(null, "", `#${slug}/${aberto.aba}`);
    dadosPendente = false;
    renderPainel(true);
    render();
    requestAnimationFrame(() => {
      const el = document.querySelector(`.cartao[data-slug="${CSS.escape(slug)}"]`), q = $("#quadro");
      if (!el || celular() || vista !== "funil") return;
      const r = el.getBoundingClientRect(), limite = innerWidth - $("#painel").offsetWidth - 16;
      if (r.right > limite) q.scrollLeft += r.right - limite;
    });
  }
  function fechar() {
    aberto = null;
    document.body.classList.remove("com-painel");
    $("#painel").setAttribute("aria-hidden", "true");
    history.replaceState(null, "", vista === "painel" ? pfHash() : location.pathname);
    render();
  }
  $("#p-fechar").addEventListener("click", fechar);
  $("#veu").addEventListener("click", fechar);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || dlg.open) return;
    if ($(".pop-wrap.aberto")) return fecharPops();
    if (e.target.closest("[data-prox-form]")) { ui.prox = false; return renderPainel(true); }
    if (aberto && !e.target.closest("input,textarea,select")) fechar();
  });
  $$(".abas button").forEach((b) => b.addEventListener("click", () => {
    aberto.aba = b.dataset.aba;
    history.replaceState(null, "", `#${aberto.slug}/${aberto.aba}`);
    renderPainel(true);
  }));

  const corpoDados = $("#corpo-dados");
  function renderPainel(novo) {
    const n = porSlug(aberto.slug);
    $("#p-nome").textContent = n.nome;
    $("#p-sub").textContent = [n.cidade, n.nicho].filter(Boolean).join(" · ");
    $("#aba-dados").setAttribute("aria-selected", aberto.aba === "dados");
    $("#aba-whats").setAttribute("aria-selected", aberto.aba === "whats");
    $("#aba-msgs").setAttribute("aria-selected", aberto.aba === "msgs");
    const pf = proximaFase(n);
    $("#aba-msgs").innerHTML = `Mensagens${pf && !["ganho", "perdido"].includes(n.etapa) ? `<span class="cont">${esc(FASE_ROT[pf])}</span>` : ""}`;
    corpoMsgs.classList.toggle("ativa", aberto.aba === "msgs");
    const focoM = document.activeElement;
    if (novo || !(corpoMsgs.contains(focoM) && focoM.matches("textarea"))) {
      const rolM = novo ? 0 : corpoMsgs.scrollTop;
      corpoMsgs.innerHTML = fasesHTML(n);
      corpoMsgs.scrollTop = rolM;
    }
    $("#aba-whats").innerHTML = `WhatsApp<span class="cont">${n.mensagens.length || ""}</span>`;
    corpoDados.classList.toggle("ativa", aberto.aba === "dados");
    $("#corpo-whats").classList.toggle("ativa", aberto.aba === "whats");
    const foco = document.activeElement;
    if (!novo && corpoDados.contains(foco) && foco.matches("input,textarea,select")) {
      dadosPendente = true; // não atropela o que o usuário está digitando
    } else {
      const rol = novo ? 0 : corpoDados.scrollTop;
      corpoDados.innerHTML = resumoHTML(n);
      corpoDados.scrollTop = rol;
      dadosPendente = false;
      if (ui.prox) { const i = $("[data-prox-form] input[name=passo]", corpoDados); if (i && novo) i.focus(); }
      if (ui.anotar) { const i = $("[data-nota] input", corpoDados); if (i && novo) i.focus(); }
    }
    renderChat(n, novo);
    if (novo) mostrarCompor(false);
  }

  const campo = (rot, caminho, valor, { tipo = "text", largo = false, ph = "" } = {}) =>
    `<label class="campo${largo ? " largo" : ""}"><span>${esc(rot)}</span>${tipo === "textarea"
      ? `<textarea data-c="${caminho}" rows="2" placeholder="${esc(ph)}">${esc(valor)}</textarea>`
      : `<input type="${tipo}" data-c="${caminho}" value="${esc(valor ?? "")}" placeholder="${esc(ph)}">`}</label>`;
  const campoData = (rot, caminho, iso) =>
    `<label class="campo"><span>${esc(rot)}</span><input type="text" data-c="${caminho}" data-data value="${esc(fmtData(iso))}" placeholder="dd/mm" inputmode="numeric" autocomplete="off"></label>`;
  const ext = (url, rot) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(rot || semProto(url))}</a>` : "";
  const ICO_X = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8m0-8l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

  function resumoHTML(n) {
    const p = n.previa || {}, pr = n.proposta || {};
    const etapas = dados.etapas.map((e) => `<option value="${e.id}"${e.id === n.etapa ? " selected" : ""}>${esc(e.nome.replace(/\s*\(.*\)$/, ""))}</option>`).join(""); // rótulo curto: cabe no painel
    const wa = waApp(n) || "";
    const waWeb = (contatoWA(n) && waUrl(contatoWA(n).whatsapp)) || "";
    // topo: etapa, WhatsApp, Cobrar
    const cobrar = `<div class="pop-wrap"><button class="btn sec" data-pop aria-expanded="false">Cobrar...</button>
      <div class="pop"><span class="rot-pop">Lembrar de cobrar</span>
        <div class="chips"><button type="button" class="chip" data-cobrar="amanha">amanhã</button><button type="button" class="chip" data-cobrar="+3">+3 d</button><button type="button" class="chip" data-cobrar="+7">+1 sem</button></div>
        <form class="linha-pop" data-cobrar-form><input name="quando" placeholder="dd/mm" inputmode="numeric" aria-label="Data" autocomplete="off"><button class="btn sec">Ok</button></form>
        <input name="motivo" data-cobrar-motivo placeholder="Motivo (opcional)" aria-label="Motivo" autocomplete="off"></div></div>`;
    const topo = `<div class="p-acoes">
      <label class="etapa-sel"><span class="pt ${esc(n.etapa)}" aria-hidden="true"></span><select data-etapa aria-label="Etapa">${etapas}</select></label>
      ${wa ? `<a class="btn wa" href="${esc(wa)}">${ICO_WA}Abrir WhatsApp</a>` : ""}
      ${cobrar}</div>`;
    // próximo passo: texto; clique vira campo
    const ep = estadoProx(n), passo = passoLimpo(n);
    const prox = ui.prox
      ? `<form class="prox-form" data-prox-form><input name="passo" value="${esc(passo)}" placeholder="O que fazer" aria-label="Próximo passo" autocomplete="off">
          <div class="linha-pop"><input name="data" value="${esc(fmtData(n.proximo_em))}" placeholder="dd/mm" inputmode="numeric" aria-label="Quando" autocomplete="off">
          ${[["hoje", 0], ["amanhã", 1], ["+3 d", 3], ["+1 sem", 7]].map(([r, d]) => `<button type="button" class="chip" data-rapido="${d}">${r}</button>`).join("")}
          <span class="esp" style="flex:1"></span><button type="button" class="btn-txt" data-prox-cancelar>Cancelar</button><button class="btn">Salvar</button></div></form>`
      : `<button class="prox-txt" data-prox-editar title="Clique pra editar">${n.proximo_em ? `<span class="data ${ep}">${ep === "hoje" ? "hoje" : ep === "atrasado" ? "atrasado " + ddmm(n.proximo_em) : fmtData(n.proximo_em)}</span>` : ""}${passo ? esc(passo) : n.proximo_em ? "" : `<span class="vazio">Sem próximo passo</span>`}</button>`;
    // linhas de leitura
    const cts = n.contatos || [];
    const c0 = contatoWA(n) || cts[0];
    const linhaCt = c0 ? `${c0.nome ? esc(c0.nome) : `<span class="mudo">sem nome</span>`}${c0.papel ? ` <span class="mudo">${esc(c0.papel)}</span>` : ""}${c0.whatsapp ? ` · <a class="num" href="${esc(waUrl(c0.whatsapp))}" target="_blank" rel="noopener">${esc(fmtTel(c0.whatsapp))}</a>` : ""}${cts.length > 1 ? `<button class="mais-ct" data-ver-det>+${cts.length - 1}</button>` : ""}`
      : `<span class="mudo">nenhum</span> <button class="mais-ct" data-novo-ct>adicionar</button>`;
    const linhaPrev = p.url ? `${ext(p.url)} <span class="mudo">${p.publicada ? "no ar" : "não publicada"}</span>` : `<span class="mudo">sem prévia</span>`;
    const temProp = pr.valor != null || pr.forma || pr.pdf;
    const linhaProp = temProp ? `<span class="num">${esc(moeda(pr.valor) || "sem valor")}</span>${pr.enviada_em ? ` <span class="mudo">enviada ${esc(fmtData(pr.enviada_em))}</span>` : ""}${pr.pdf ? ` <span class="mudo">· PDF</span>` : ""}${pr.forma ? `<div class="forma" title="${esc(pr.forma)}">${esc(pr.forma)}</div>` : ""}` : `<span class="mudo">sem proposta</span>`;
    const desde = etapaDesde(n);
    const linhas = `<dl class="linhas">
      <div><dt>Contato</dt><dd>${linhaCt}</dd></div>
      <div><dt>Prévia</dt><dd>${linhaPrev}</dd></div>
      <div><dt>Proposta</dt><dd>${linhaProp}</dd></div>
      ${desde && (desdeExato(n) || desdeAprox(n)) ? `<div><dt>Na etapa</dt><dd>${desdeExato(n) ? "" : "~"}${esc(rotuloIdade(Date.now() - msDe(desde)).replace(/^há /, ""))} <span class="mudo">${desdeExato(n) ? `desde ${esc(rotuloQuando(desde))}` : `estimado pelo histórico, ~${esc(fmtData(desde.slice(0, 10)))}`}</span></dd></div>` : ""}</dl>`;
    // cobranças abertas
    const abertas = cobAbertas(n);
    const cobs = abertas.length ? `<div class="p-bloco"><h4>Cobranças</h4><ul class="cob-l">${abertas.map((c) => `<li data-cid="${esc(c.id)}" data-slug="${esc(n.slug)}">
        <span class="q e-${estadoCob(c)}">${esc(rotuloCob(c))}</span><span class="m" title="${esc(c.motivo)}">${esc(c.motivo)}${c.auto ? "<small>sugestão</small>" : ""}</span>
        ${c.texto_sugerido ? `<button class="btn sec" data-copiar title="${esc(c.texto_sugerido)}">Copiar</button>` : ""}<button class="btn sec" data-feita>Feita</button>${popAdiar()}</li>`).join("")}</ul></div>` : "";
    // histórico (leitura)
    const imp = importadoEm(n);
    const evs = (n.eventos || []).filter((e) => !(imp && e.quando === imp && /^(Criado em|Proposta:)/.test(e.texto))).reverse();
    const mostra = ui.hist ? evs : evs.slice(0, 3);
    const hist = `<div class="p-bloco"><h4>Histórico<span class="esp"></span>${ui.anotar ? "" : `<button class="btn-txt" data-anotar>Anotar</button>`}</h4>
      ${ui.anotar ? `<form class="nota-form" data-nota><input name="texto" placeholder="Ligação, decisão..." aria-label="Nota" autocomplete="off"><button class="btn sec">Anotar</button></form>` : ""}
      <ul class="eventos">${mostra.map((e) => `<li><time>${esc(rotuloQuando(e.quando))}</time>${esc(e.texto)}</li>`).join("") || "<li>Nada ainda</li>"}</ul>
      ${evs.length > 3 ? `<button class="btn-txt" data-hist>${ui.hist ? "Mostrar menos" : `Ver tudo (${evs.length})`}</button>` : ""}</div>`;
    return topo + `<div class="p-prox"><span class="p-rot">Próximo passo</span>${prox}</div>` + linhas + cobs + hist + detalhesHTML(n);
  }

  function detalhesHTML(n) {
    const p = n.previa || {}, pr = n.proposta || {};
    const feitas = (n.cobrancas || []).filter((c) => c.feita).sort((a, b) => (a.feita_em < b.feita_em ? 1 : -1));
    const v = (x) => x ? esc(x) : `<span class="mudo">-</span>`;
    const papeis = ["dono", "atendente", "sócio", "outro"];
    let corpo;
    if (!ui.editar) {
      corpo = `<dl class="det">
        <dt>Cidade</dt><dd>${v(n.cidade)}</dd><dt>Nicho</dt><dd>${v(n.nicho)}</dd>
        <dt>Instagram</dt><dd>${n.instagram ? ext(igUrl(n.instagram), n.instagram) : v("")}</dd>
        <dt>Tags</dt><dd>${v((n.tags || []).join(", "))}</dd>
        ${n.motivo_perda ? `<dt>Motivo da perda</dt><dd>${esc(n.motivo_perda)}</dd>` : ""}
        <dt>Proposta</dt><dd>${v(moeda(pr.valor))}${pr.forma ? `<br>${esc(pr.forma)}` : ""}${pr.pdf ? `<br><span class="mudo">${esc(pr.pdf)}</span>` : ""}</dd>
        <dt>Prévia OG</dt><dd>${p.og ? ext(/^https?:/.test(p.og) ? p.og : "", p.og) || esc(p.og) : v("")}</dd>
        <dt>ID da app (deploy)</dt><dd>${v(p.appId)}</dd>
        <dt>Criado</dt><dd>${v(rotuloQuando(n.criado_em))} <span class="mudo">· atualizado ${esc(rotuloQuando(n.atualizado_em))}</span></dd></dl>
        <div class="det-sec">Contatos (${(n.contatos || []).length})</div>
        <dl class="det">${(n.contatos || []).map((c) => `<dt>${esc(c.papel || "contato")}</dt><dd>${c.nome ? esc(c.nome) : `<span class="mudo">sem nome</span>`}${c.whatsapp ? ` · <a href="${esc(waUrl(c.whatsapp))}" target="_blank" rel="noopener">${esc(fmtTel(c.whatsapp))}</a>` : ""}${c.nota ? ` <span class="mudo">${esc(c.nota)}</span>` : ""} <button class="btn-txt" data-contato="${esc(c.id)}">editar</button></dd>`).join("")}</dl>
        <button class="btn-txt" data-novo-ct>Adicionar contato</button>
        ${feitas.length ? `<div class="det-sec">Cobranças feitas (${feitas.length})</div><ul class="cob-feitas">${feitas.map((c) => `<li><time>${esc(fmtQuando(c.quando))}</time>${esc(c.motivo)}${c.resolvida ? ` <span class="mudo">(${esc(c.resolvida)})</span>` : ""}</li>`).join("")}</ul>` : ""}`;
    } else {
      const contatos = (n.contatos || []).map((c, i) => `<div class="contato" data-i="${i}">
        <input data-k="nome" value="${esc(c.nome)}" placeholder="Nome" aria-label="Nome">
        <select data-k="papel" aria-label="Papel"><option value="">-</option>${papeis.map((x) => `<option${x === c.papel ? " selected" : ""}>${x}</option>`).join("")}${c.papel && !papeis.includes(c.papel) ? `<option selected>${esc(c.papel)}</option>` : ""}</select>
        <input data-k="whatsapp" value="${esc(fmtTel(c.whatsapp))}" placeholder="WhatsApp" inputmode="tel" aria-label="WhatsApp">
        <button class="btn-icone" data-rm="${i}" aria-label="Remover contato" title="Remover">${ICO_X}</button></div>`).join("");
      corpo = `<div class="grade">
        ${campo("Nome", "nome", n.nome)}${campo("Cidade", "cidade", n.cidade)}
        ${campo("Nicho", "nicho", n.nicho)}${campo("Instagram", "instagram", n.instagram, { ph: "@perfil" })}
        ${campo("Tags", "tags", (n.tags || []).join(", "), { ph: "separadas por vírgula" })}${campo("Motivo da perda", "motivo_perda", n.motivo_perda)}
        ${campo("Prévia (URL)", "previa.url", p.url, { largo: true, ph: "https://slug.seudominio.com.br" })}
        <div class="campo"><span>Publicada</span><label class="check"><input type="checkbox" data-c="previa.publicada"${p.publicada ? " checked" : ""}><i class="caixa" aria-hidden="true"></i>no ar</label></div>
        ${campo("ID da app (deploy)", "previa.appId", p.appId)}
        ${campo("OG", "previa.og", p.og, { largo: true })}
        ${campo("Valor (R$)", "proposta.valor", pr.valor ?? "", { ph: "500" })}${campoData("Enviada em", "proposta.enviada_em", pr.enviada_em)}
        ${campo("Forma", "proposta.forma", pr.forma, { largo: true, tipo: "textarea" })}
        ${campo("PDF", "proposta.pdf", pr.pdf, { largo: true, ph: "caminho do arquivo" })}</div>
        <div class="det-sec">Contatos</div>${contatos}<button class="btn-txt" data-novo-ct>Adicionar contato</button>`;
    }
    return `<details class="detalhes" data-det${ui.det ? " open" : ""}><summary>Detalhes<span class="esp"></span>${ui.det ? `<button type="button" class="btn-txt" data-editar>${ui.editar ? "Concluir" : "Editar"}</button>` : ""}</summary>${corpo}</details>`;
  }

  function marcarSalvo(el) {
    const c = el.closest(".campo");
    if (!c) return;
    c.classList.add("salvo");
    setTimeout(() => c.classList.remove("salvo"), 900);
  }
  function lerContatos() {
    const n = porSlug(aberto.slug);
    return $$(".contato", corpoDados).map((row) => {
      const o = n.contatos[+row.dataset.i] || {};
      return { ...o, nome: $('[data-k="nome"]', row).value.trim(), papel: $('[data-k="papel"]', row).value, whatsapp: $('[data-k="whatsapp"]', row).value };
    });
  }
  corpoDados.addEventListener("change", async (e) => {
    const el = e.target, slug = aberto.slug;
    if (el.closest("[data-prox-form], [data-cobrar-form], [data-nota], [data-adiar-form]") || el.matches("[data-cobrar-motivo]")) return;
    if (el.matches("[data-etapa]")) return enviar("/api/mover", { slug, etapa: el.value });
    if (el.closest(".contato")) { if (await enviar("/api/editar", { slug, campos: { contatos: lerContatos() } })) toast("Contato salvo"); return; }
    if (!el.dataset.c) return;
    let v = el.type === "checkbox" ? el.checked : el.value;
    if ("data" in el.dataset) {
      v = lerData(v);
      if (v === null) { toast("Data inválida. Use dd/mm (ex.: 15/10).", true); el.value = ""; return; }
    }
    if (await enviar("/api/editar", { slug, campos: { [el.dataset.c]: v } })) marcarSalvo($(`[data-c="${el.dataset.c}"]`, corpoDados) || el);
  });
  corpoDados.addEventListener("toggle", (e) => {
    if (!e.target.matches("details[data-det]")) return;
    if (ui.det !== e.target.open) { ui.det = e.target.open; if (!ui.det) ui.editar = false; renderPainel(false); }
  }, true);
  corpoDados.addEventListener("focusout", () => {
    setTimeout(() => { if (dadosPendente && aberto && !corpoDados.contains(document.activeElement)) renderPainel(false); }, 50);
  });
  async function salvarProx(f, dias) {
    const iso = dias != null ? somaDias(hojeISO(), dias) : lerData(f.data.value);
    if (iso === null) { toast("Data inválida. Use dd/mm (ex.: 15/10).", true); return f.data.focus(); }
    ui.prox = false;
    if (await enviar("/api/editar", { slug: aberto.slug, campos: { proximo_passo: f.passo.value.trim(), proximo_em: iso } })) toast("Próximo passo salvo");
  }
  async function marcarCobranca(quando) {
    const m = $("[data-cobrar-motivo]", corpoDados);
    fecharPops();
    if (await enviar("/api/cobranca", { slug: aberto.slug, quando, motivo: (m && m.value.trim()) || "Cobrar retorno" })) toast("Cobrança marcada");
  }
  corpoDados.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-prox-editar]")) { ui.prox = true; return renderPainel(true); }
    if (t.closest("[data-prox-cancelar]")) { ui.prox = false; return renderPainel(false); }
    const rp = t.closest("[data-rapido]");
    if (rp) return salvarProx(t.closest("form"), +rp.dataset.rapido);
    const cb = t.closest("[data-cobrar]");
    if (cb) return marcarCobranca(cb.dataset.cobrar);
    if (t.closest("[data-anotar]")) { ui.anotar = true; return renderPainel(true); }
    if (t.closest("[data-hist]")) { ui.hist = !ui.hist; return renderPainel(false); }
    if (t.closest("[data-editar]")) { e.preventDefault(); ui.editar = !ui.editar; return renderPainel(false); }
    if (t.closest("[data-ver-det]")) { ui.det = true; renderPainel(false); const d = $("[data-det]", corpoDados); if (d) d.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
    if (t.closest("[data-novo-ct]")) { e.preventDefault(); return abrirContato(null, aberto.slug); }
    const rm = t.closest("[data-rm]");
    if (rm) { e.preventDefault(); const cs = lerContatos(); cs.splice(+rm.dataset.rm, 1); return enviar("/api/editar", { slug: aberto.slug, campos: { contatos: cs } }); }
  });
  corpoDados.addEventListener("submit", async (e) => {
    const f = e.target;
    if (f.matches("[data-adiar-form]")) return; // tratado no document
    e.preventDefault();
    if (f.matches("[data-prox-form]")) return salvarProx(f);
    if (f.matches("[data-cobrar-form]")) {
      const iso = lerData(f.quando.value);
      if (!iso) { toast("Data inválida. Use dd/mm (ex.: 15/10).", true); return f.quando.focus(); }
      return marcarCobranca(iso);
    }
    if (f.matches("[data-nota]")) {
      const t = f.texto.value.trim();
      if (t && await enviar("/api/nota", { slug: aberto.slug, texto: t })) { ui.anotar = false; renderPainel(false); }
    }
  });

  // ---------- WhatsApp ----------
  function linkify(t) { return esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }
  function anexoHTML(a) {
    if (!a) return "";
    if (/^https?:\/\//.test(a)) {
      let host = a; try { host = new URL(a).host; } catch (_) {}
      return `<a class="anexo" href="${esc(a)}" target="_blank" rel="noopener"><span class="ic link"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 014 4l-1 1M9 11.5l-1 1a2.8 2.8 0 01-4-4l1-1" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg></span><span><span class="nome">${esc(host)}</span><br><span class="info">${esc(a.length > 48 ? a.slice(0, 45) + "..." : a)}</span></span></a>`;
    }
    const nome = a.split("/").pop();
    const ex = (nome.match(/\.([a-z0-9]{2,4})$/i) || [, "arq"])[1].toUpperCase();
    return `<div class="anexo" title="${esc(a)}"><span class="ic ${ex === "PDF" ? "" : "arq"}">${esc(ex)}</span><span><span class="nome">${esc(nome)}</span><br><span class="info">${ex === "PDF" ? "PDF" : "Arquivo"}</span></span></div>`;
  }
  // Eventos do log no chat: 1 linha curta, nunca o texto interno. Envio a até 10 min de uma bolha some.
  function rotuloEvento(e) {
    const t = e.texto;
    const mv = t.match(/→\s*(.+)$/);
    if (mv) { const et = dados.etapas.find((x) => mv[1].startsWith(x.nome)); return et ? `Movido pra ${NOME_CURTO[et.id]}` : ""; }
    if (!ehEnvio(e)) return "";
    if (/\bpdf\b/i.test(t)) return "PDF enviado";
    if (/proposta|pre[çc]o/i.test(t)) return "Proposta enviada";
    if (/follow-?up/i.test(t)) return "Follow-up enviado";
    if (/\bmsgs? (\+|e) link\b/i.test(t)) return "Msg e link enviados";
    if (/\blink\b/i.test(t)) return "Link enviado";
    if (/\bmsgs? 1\b/i.test(t) && /\bmsg 2\b|\b1 e 2\b/i.test(t)) return "Msgs 1 e 2 enviadas";
    if (/\bmsg 2\b/i.test(t)) return "Msg 2 enviada";
    if (/\bmsg 1\b/i.test(t)) return "Msg 1 enviada";
    return "Mensagem enviada";
  }
  function itensChat(n) {
    const ms = n.mensagens || [];
    const perto = (q) => ms.some((m) => Math.abs(msDe(m.quando) - msDe(q)) <= 6e5);
    const evs = (n.eventos || []).map((e) => ({ evento: true, de: "eu", quando: e.quando, texto: e.texto, rotulo: rotuloEvento(e), mov: /→/.test(e.texto) }))
      .filter((e) => e.rotulo && (e.mov || !perto(e.quando)));
    return [...ms, ...evs].sort((a, b) => (a.quando < b.quando ? -1 : a.quando > b.quando ? 1 : !!a.evento - !!b.evento));
  }
  let bolhaSel = null;
  function renderChat(n, novo) {
    const ct = contatoWA(n);
    const wa = ct ? waUrl(ct.whatsapp) : "";
    $("#chat-wa").innerHTML = `<span class="avatar" aria-hidden="true">${esc((n.nome || "?").trim().charAt(0).toUpperCase())}</span>
      <span class="ch-txt"><b>${esc(n.nome)}</b><span>${ct ? esc(fmtTel(ct.whatsapp)) + (ct.nome ? " · " + esc(ct.nome) : "") : "Sem WhatsApp cadastrado"}</span></span>
      ${wa ? `<a class="ch-wa" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Abrir no WhatsApp" title="Abrir no WhatsApp"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3a9 9 0 00-7.8 13.5L3 21l4.6-1.2A9 9 0 1012 3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 8.5c0 3.2 2.3 5.6 5.5 6.5l1.2-1.4-1.8-1-.9.7c-.9-.4-1.7-1.2-2.1-2.1l.7-.9-1-1.8z" fill="currentColor"/></svg></a>` : ""}`;
    const chat = $("#chat");
    const noFim = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
    const msgs = itensChat(n);
    if (!msgs.length) {
      chat.innerHTML = `<div class="chat-vazio">Sem mensagens. Entram aqui só a partir de print da conversa ou do que foi visto na tela do WhatsApp.</div>`;
      return;
    }
    let html = "", dia = "", ant = null;
    for (const m of msgs) {
      const d = m.quando.slice(0, 10);
      if (d !== dia) { html += `<div class="dia">${esc(rotuloDia(d))}</div>`; dia = d; ant = null; }
      if (m.evento) {
        html += `<div class="ev-linha" title="Do histórico do negócio (hora aproximada): ${esc(m.texto)}">${esc(m.rotulo)} · ${esc(m.quando.slice(11, 16))}</div>`;
        ant = null;
        continue;
      }
      const primeira = !ant || ant.de !== m.de;
      html += `<div class="bolha ${m.de}${primeira ? " primeira" : ""}${m.id === bolhaSel ? " sel" : ""}" data-id="${m.id}">${anexoHTML(m.anexo)}${m.texto ? linkify(m.texto) : ""}<span class="hora" title="fonte: ${esc(m.fonte)}">${esc(m.quando.slice(11, 16))}</span><button class="apagar" data-apagar="${m.id}" aria-label="Apagar mensagem">Apagar mensagem</button></div>`;
      ant = m;
    }
    const rol = chat.scrollTop;
    chat.innerHTML = html;
    chat.scrollTop = novo || noFim ? chat.scrollHeight : rol;
  }
  $("#chat").addEventListener("click", (e) => {
    const b = e.target.closest("[data-apagar]");
    if (b) {
      bolhaSel = null;
      if (confirm("Apagar esta mensagem do histórico?")) enviar("/api/mensagem/apagar", { slug: aberto.slug, id: b.dataset.apagar });
      else renderChat(porSlug(aberto.slug), false);
      return;
    }
    if (e.target.closest("a")) return;
    const bol = e.target.closest(".bolha");
    const id = bol && bol.dataset.id !== bolhaSel ? bol.dataset.id : null;
    if (id === bolhaSel) return;
    bolhaSel = id;
    $$("#chat .bolha").forEach((x) => x.classList.toggle("sel", x.dataset.id === id));
  });
  const compor = $("#compor");
  compor.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = compor;
    const corpo = { slug: aberto.slug, de: f.de.value, quando: f.quando.value.trim(), texto: f.texto.value, anexo: f.anexo.value.trim(), fonte: f.fonte.value };
    if (!corpo.texto.trim() && !corpo.anexo) return f.texto.focus();
    const antes = porSlug(aberto.slug).mensagens.length;
    if (await enviar("/api/mensagem", corpo)) {
      if (porSlug(aberto.slug).mensagens.length === antes) toast("Mensagem igual já estava no histórico");
      f.texto.value = ""; f.anexo.value = ""; f.fonte.value = "print"; f.quando.value = agoraBR();
      $("#chat").scrollTop = $("#chat").scrollHeight;
      f.texto.focus();
    }
  });
  $("#compor-mais").addEventListener("click", () => {
    const ab = compor.classList.toggle("com-extras");
    $("#compor-mais").setAttribute("aria-expanded", ab);
    if (ab) compor.anexo.focus();
  });
  // Quem grava mensagem é o agente pela CLI: o formulário fica atrás de "Registrar mensagem".
  function mostrarCompor(ab) {
    compor.hidden = !ab;
    $("#registrar").hidden = ab;
    if (ab) { if (!compor.quando.value) compor.quando.value = agoraBR(); compor.texto.focus(); }
  }
  $("#abrir-compor").addEventListener("click", () => mostrarCompor(true));
  $("#fechar-compor").addEventListener("click", () => mostrarCompor(false));
  compor.texto.placeholder = `Mensagem (${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"}+Enter grava)`;
  compor.texto.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); compor.requestSubmit(); } });

  // ---------- início ----------
  if (ls.get("crm-lateral", false)) document.body.classList.add("lat-recolhida");
  (async () => {
    try {
      aplicar(await api("/api/estado"), false);
      const h = decodeURIComponent(location.hash.slice(1));
      if (h.startsWith("painel")) { pfLer(h); irPara("painel"); }
      else if (h) { const [slug, aba] = h.split("/"); if (porSlug(slug)) abrir(slug, ["whats", "msgs"].includes(aba) ? aba : "dados"); }
    } catch (e) {
      $("#sinc").textContent = "Servidor fora do ar";
    }
    setTimeout(poll, POLL_MS);
  })();
})();
