/* Presidente 2026 em Dados — painel dos resultados oficiais do TSE.
   Lê dados/painel.json (resultados por município) e dados/mapa.json (malhas do IBGE). */
(() => {
  "use strict";

  const REGIAO = {
    AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
    AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste", PE: "Nordeste",
    PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
    DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
    ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
    PR: "Sul", RS: "Sul", SC: "Sul", ZZ: "Exterior",
  };
  const REGIOES = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul", "Exterior"];
  const CAMPOS = ["e", "c", "a", "vb", "vn", "vv"];

  const $ = (s) => document.querySelector(s);
  const nf = new Intl.NumberFormat("pt-BR");
  const fmt = (x) => (x == null || !isFinite(x) ? "—" : nf.format(Math.round(x)));
  const pct = (x, d = 1) => (x == null || !isFinite(x) ? "—" :
    (x * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%");
  const pp = (x, d = 1) => (x == null || !isFinite(x) ? "—" :
    (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) + " p.p.");
  const sinal = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + fmt(Math.abs(x));
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const MIN = new Set(["da", "de", "do", "das", "dos", "e", "d'", "del", "la", "di"]);
  const titulo = (s) => (s || "").toLowerCase().split(/(\s+|-)/).map((w, i) =>
    (i > 0 && MIN.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join("")
    .replace(/D'([a-z])/g, (m, c) => "D'" + c.toUpperCase());
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === "class") n.className = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
    return n;
  };

  // ---------- estado ----------
  const S = { turno: "t2", esc: { tipo: "br", id: "BR" }, metrica: null, atip: "votos", tabSort: null };
  let D, MAPA, MUN = [], CAND = {}, FIN = [], A, B, G, TEM_T2 = false, MODELO = null;
  const POR_IBGE = new Map(), POR_ID = new Map();

  // ---------- dados ----------
  function preparar(painel) {
    D = painel;
    const ix = Object.fromEntries(D.cols.map((c, i) => [c, i]));
    TEM_T2 = !!(D.fin && D.fin.length >= 2 && ("e2" in ix));
    D.cand.forEach((c, k) => {
      CAND[c.n] = { ...c, k, nome: titulo(c.nm), cor: k < 8 ? `--s${k + 1}` : "--outros",
        partido: (c.cc || "").split(" - ")[0] };
    });
    FIN = TEM_T2 ? D.fin.slice(0, 2) : D.cand.slice(0, 2).map((c) => c.n);
    [A, B] = FIN;
    // as cores dos finalistas ficam nas duas primeiras posições da paleta
    if (TEM_T2) {
      const outros = D.cand.map((c) => c.n).filter((n) => !FIN.includes(n));
      [A, B, ...outros].forEach((n, k) => { CAND[n].cor = k < 8 ? `--s${k + 1}` : "--outros"; CAND[n].k = k; });
    }
    MUN = D.rows.map((r, i) => {
      const m = { i, uf: r[ix.uf], nm: r[ix.nm], nome: titulo(r[ix.nm]), ibge: String(r[ix.ibge] || ""), cap: !!r[ix.cap] };
      m.rg = REGIAO[m.uf] || "?";
      m.id = m.uf + "-" + i;
      for (const t of ["1", "2"]) {
        if (!(`e${t}` in ix) || r[ix[`e${t}`]] == null) continue;
        const o = { v: {} };
        CAMPOS.forEach((k) => (o[k] = r[ix[k + t]] || 0));
        for (const c of D.cols) if (c.startsWith(`v${t}_`)) o.v[c.slice(3)] = r[ix[c]] || 0;
        m["t" + t] = o;
      }
      if (m.ibge) POR_IBGE.set(m.ibge, m);
      POR_ID.set(m.id, m);
      return m;
    });
    // ganhou mais participação entre os turnos (no Brasil)
    const br = agregar(MUN);
    if (TEM_T2) {
      const dA = sh(br.t2, A) - sh(br.t1, A), dB = sh(br.t2, B) - sh(br.t1, B);
      G = dA >= dB ? A : B;
      MODELO = ajustarModelo();
    }
  }

  const sh = (t, n) => (t && t.vv ? (t.v[n] || 0) / t.vv : NaN);
  const outros1 = (t) => t.vv - (t.v[A] || 0) - (t.v[B] || 0);

  function agregar(lista) {
    const out = { n: lista.length, res: 0, resVV: 0 };
    for (const t of ["t1", "t2"]) {
      const o = { e: 0, c: 0, a: 0, vb: 0, vn: 0, vv: 0, v: {} };
      let tem = false;
      for (const m of lista) {
        const x = m[t]; if (!x) continue; tem = true;
        CAMPOS.forEach((k) => (o[k] += x[k]));
        for (const n in x.v) o.v[n] = (o.v[n] || 0) + x.v[n];
      }
      if (tem) out[t] = o;
    }
    for (const m of lista) if (m.mod) { out.res += m.mod.rv; out.resVV += m.t2.vv; }
    out.viradas = lista.filter((m) => m.mod && m.mod.virada).length;
    return out;
  }

  // Regressão ponderada: % do finalista A no 2º turno explicado pelo 1º turno
  // (% de A, % dos demais candidatos), pela variação da abstenção e pela UF.
  function ajustarModelo() {
    const ufs = [...new Set(MUN.map((m) => m.uf))].sort();
    const base = MUN.filter((m) => m.t1 && m.t2 && m.t1.vv > 0 && m.t2.vv > 0 && m.t1.e > 0 && m.t2.e > 0);
    const k = 3 + ufs.length;
    const XtX = Array.from({ length: k }, () => new Float64Array(k)), Xty = new Float64Array(k);
    const linha = (m) => {
      const x = new Float64Array(k);
      x[0] = sh(m.t1, A); x[1] = outros1(m.t1) / m.t1.vv; x[2] = m.t2.a / m.t2.e - m.t1.a / m.t1.e;
      x[3 + ufs.indexOf(m.uf)] = 1;
      return x;
    };
    for (const m of base) {
      const x = linha(m), y = sh(m.t2, A), w = m.t2.vv;
      for (let i = 0; i < k; i++) { if (!x[i]) continue; Xty[i] += w * x[i] * y; for (let j = 0; j < k; j++) XtX[i][j] += w * x[i] * x[j]; }
    }
    const beta = resolver(XtX, Xty);
    let sst = 0, sse = 0, sw = 0, ym = 0;
    for (const m of base) { sw += m.t2.vv; ym += m.t2.vv * sh(m.t2, A); }
    ym /= sw;
    const res = [];
    for (const m of base) {
      const x = linha(m); let yh = 0; for (let i = 0; i < k; i++) yh += beta[i] * x[i];
      const y = sh(m.t2, A), r = y - yh;
      sse += m.t2.vv * r * r; sst += m.t2.vv * (y - ym) ** 2;
      m.mod = { esp: yh, r, rv: r * m.t2.vv };
      res.push(m);
    }
    // escala robusta: dispersão entre municípios + ruído esperado pelo tamanho
    const absr = res.map((m) => Math.abs(m.mod.r)).sort((a, b) => a - b);
    const mad = 1.4826 * absr[Math.floor(absr.length / 2)];
    const ruido = res.map((m) => { const p = sh(m.t2, A); return p * (1 - p) / m.t2.vv; }).sort((a, b) => a - b);
    const s0 = Math.max(1e-6, mad * mad - ruido[Math.floor(ruido.length / 2)]);
    for (const m of res) {
      const p = sh(m.t2, A);
      m.mod.z = m.mod.r / Math.sqrt(s0 + p * (1 - p) / m.t2.vv);
      m.mod.dabst = m.t2.a / m.t2.e - m.t1.a / m.t1.e;
      const lider1 = Object.entries(m.t1.v).sort((a, b) => b[1] - a[1])[0];
      const venc2 = (m.t2.v[A] || 0) >= (m.t2.v[B] || 0) ? A : B;
      m.mod.lider1 = lider1 && lider1[0];
      m.mod.venc2 = venc2;
      m.mod.virada = lider1 && lider1[1] > 0 && lider1[0] !== venc2;
    }
    return { beta, r2: 1 - sse / sst, n: res.length, s: Math.sqrt(s0), ufs };
  }

  function resolver(M, y) { // eliminação de Gauss com pivoteamento parcial
    const n = y.length, a = M.map((r, i) => [...r, y[i]]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      [a[c], a[p]] = [a[p], a[c]];
      if (Math.abs(a[c][c]) < 1e-12) continue;
      for (let r = 0; r < n; r++) {
        if (r === c) continue; const f = a[r][c] / a[c][c];
        if (f) for (let j = c; j <= n; j++) a[r][j] -= f * a[c][j];
      }
    }
    return a.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]));
  }

  // ---------- escopo (Brasil > região > UF > município) ----------
  function listaDe(esc) {
    if (esc.tipo === "br") return MUN;
    if (esc.tipo === "rg") return MUN.filter((m) => m.rg === esc.id);
    if (esc.tipo === "uf") return MUN.filter((m) => m.uf === esc.id);
    return [POR_ID.get(esc.id)].filter(Boolean);
  }
  function nomeDe(esc) {
    if (esc.tipo === "br") return "Brasil";
    if (esc.tipo === "rg") return esc.id === "Exterior" ? "Exterior" : "Região " + esc.id;
    if (esc.tipo === "uf") return D.uf[esc.id] || esc.id;
    const m = POR_ID.get(esc.id); return m ? `${m.nome} (${m.uf})` : "";
  }
  function filhos(esc) {
    if (esc.tipo === "br") return REGIOES.flatMap((r) => Object.keys(REGIAO).filter((u) => REGIAO[u] === r))
      .filter((u) => MUN.some((m) => m.uf === u)).map((u) => ({ esc: { tipo: "uf", id: u }, nome: D.uf[u] || u, sigla: u }));
    if (esc.tipo === "rg") return Object.keys(REGIAO).filter((u) => REGIAO[u] === esc.id)
      .map((u) => ({ esc: { tipo: "uf", id: u }, nome: D.uf[u] || u, sigla: u }));
    const uf = esc.tipo === "uf" ? esc.id : POR_ID.get(esc.id).uf;
    return MUN.filter((m) => m.uf === uf).map((m) => ({ esc: { tipo: "mun", id: m.id }, nome: m.nome, sigla: m.uf, m }));
  }
  function pai(esc) {
    if (esc.tipo === "mun") return { tipo: "uf", id: POR_ID.get(esc.id).uf };
    if (esc.tipo === "uf") return { tipo: "rg", id: REGIAO[esc.id] };
    return { tipo: "br", id: "BR" };
  }
  const tDe = () => (S.turno === "t1" ? "t1" : TEM_T2 ? "t2" : "t1");

  // ---------- métricas do mapa ----------
  function metricas() {
    const t = tDe(), lista = [];
    if (S.turno === "cmp" && TEM_T2) {
      lista.push(
        { id: "dA", nome: `Variação de ${CAND[A].nome} (p.p.)`, desc: `Quanto a fatia de ${CAND[A].nome} nos votos válidos mudou do 1º para o 2º turno.`,
          val: (x) => sh(x.t2, A) - sh(x.t1, A), tipo: "div", cor: [B, A], fmt: pp, dom: 0.3 },
        { id: "dB", nome: `Variação de ${CAND[B].nome} (p.p.)`, desc: `Quanto a fatia de ${CAND[B].nome} nos votos válidos mudou do 1º para o 2º turno.`,
          val: (x) => sh(x.t2, B) - sh(x.t1, B), tipo: "div", cor: [A, B], fmt: pp, dom: 0.3 },
        { id: "z", nome: "Fora do padrão", desc: `Diferença entre o resultado de ${CAND[A].nome} no 2º turno e o que o 1º turno da própria cidade indicava (veja a explicação mais abaixo). Cores fortes = mais longe do esperado.`,
          val: (x) => (x.mod ? x.mod.r : x.resVV ? x.res / x.resVV : NaN), tipo: "div", cor: [B, A], fmt: pp, dom: 0.08 },
        { id: "virada", nome: "Viradas", desc: "Municípios onde quem liderou o 1º turno perdeu o 2º turno, na cor do vencedor do 2º turno.",
          val: (x) => (x.mod ? (x.mod.virada ? 1 : 0) : x.viradas), tipo: "virada", fmt: (v) => (v === 1 ? "Virou" : v === 0 ? "Manteve" : fmt(v)) },
        { id: "dabst", nome: "Variação da abstenção (p.p.)", desc: "Quanto a abstenção subiu ou caiu entre os turnos.",
          val: (x) => x.t2.a / x.t2.e - x.t1.a / x.t1.e, tipo: "divn", fmt: pp, dom: 0.08 },
      );
    } else {
      lista.push({ id: "venc", nome: t === "t2" ? "Vencedor e margem" : "Mais votado", desc: t === "t2"
        ? `Cor do vencedor em cada município; quanto mais forte, maior a vantagem.`
        : `Cor do candidato mais votado em cada município; quanto mais forte, maior a sua fatia.`,
        val: (x) => (t === "t2" ? sh(x.t2, A) : lider(x.t1)), tipo: t === "t2" ? "venc2" : "venc1", fmt: (v) => (t === "t2" ? pct(v) : v ? CAND[v.n].nome + " " + pct(v.p) : "—") });
      const cands = Object.values(CAND).filter((c) => (t === "t2" ? FIN.includes(c.n) : true)).sort((a, b) => a.k - b.k).slice(0, 8);
      for (const c of cands) lista.push({ id: "p" + c.n, nome: `% de ${c.nome}`, desc: `Fatia de ${c.nome} nos votos válidos.`, val: (x) => sh(x[t], c.n), tipo: "seq", corSeq: c.cor, fmt: pct });
      lista.push(
        { id: "abst", nome: "Abstenção", desc: "Eleitores que não foram votar, em % do eleitorado.", val: (x) => x[t].a / x[t].e, tipo: "seqn", fmt: pct },
        { id: "bn", nome: "Brancos e nulos", desc: "Votos brancos e nulos, em % de quem compareceu.", val: (x) => (x[t].vb + x[t].vn) / x[t].c, tipo: "seqn", fmt: pct },
      );
    }
    return lista;
  }
  const lider = (t) => {
    if (!t || !t.vv) return null;
    let n = null, v = -1; for (const k in t.v) if (t.v[k] > v) { v = t.v[k]; n = k; }
    return n ? { n, p: v / t.vv } : null;
  };

  function escala(met, valores) {
    const mid = css("--mid");
    if (met.tipo === "venc2") {
      const s = d3.scaleLinear().domain([0.2, 0.5, 0.5, 0.8]).range([css(CAND[B].cor), mixa(css(CAND[B].cor), mid, 0.82), mixa(css(CAND[A].cor), mid, 0.82), css(CAND[A].cor)]).interpolate(d3.interpolateLab).clamp(true);
      return (v) => (isFinite(v) ? s(v) : null);
    }
    if (met.tipo === "venc1") return (v) => (v ? d3.interpolateLab(mid, css(CAND[v.n].cor))(Math.min(1, Math.max(0.18, (v.p - 0.2) / 0.5))) : null);
    if (met.tipo === "virada") return (v, x) => (v === 1 && x && x.mod ? css(CAND[x.mod.venc2].cor) : v === 0 ? mid : null);
    if (met.tipo === "seq" || met.tipo === "seqn") {
      const fim = met.tipo === "seq" ? css(met.corSeq) : css("--fg-2");
      const vs = valores.filter(isFinite).sort((a, b) => a - b);
      const lo = vs.length ? d3.quantileSorted(vs, 0.02) : 0, hi = vs.length ? d3.quantileSorted(vs, 0.98) : 1;
      const s = d3.scaleLinear().domain([lo, hi]).range([mixa(fim, mid, 0.9), fim]).interpolate(d3.interpolateLab).clamp(true);
      s.lo = lo; s.hi = hi;
      const f = (v) => (isFinite(v) ? s(v) : null); f.lo = lo; f.hi = hi; return f;
    }
    // divergentes: neutro no zero
    const [cn, cp] = met.tipo === "divn" ? [css("--accent"), css("--warn")] : [css(CAND[met.cor[0]].cor), css(CAND[met.cor[1]].cor)];
    const vs = valores.filter(isFinite).map(Math.abs).sort((a, b) => a - b);
    const m = Math.max(0.005, Math.min(met.dom, vs.length ? d3.quantileSorted(vs, 0.97) : met.dom));
    const s = d3.scaleLinear().domain([-m, 0, m]).range([cn, mid, cp]).interpolate(d3.interpolateLab).clamp(true);
    const f = (v) => (isFinite(v) ? s(v) : null); f.lo = -m; f.hi = m; return f;
  }
  function mixa(c1, c2, t) { return d3.interpolateLab(c1, c2)(t); }

  // ---------- render ----------
  function render() {
    renderMigalha();
    renderResultado();
    renderMapa();
    renderAnalise();
    renderTabela();
    try { history.replaceState(null, "", "#" + hashDe()); } catch (e) { /* sem histórico */ }
  }

  function irPara(esc) { S.esc = esc; S.tabSort = null; render(); }

  function renderMigalha() {
    const c = $("#migalha"); c.textContent = "";
    const cadeia = []; let e = S.esc;
    while (true) { cadeia.unshift(e); if (e.tipo === "br") break; e = pai(e); }
    cadeia.forEach((x, i) => {
      if (i) c.append(el("span", { class: "sep", "aria-hidden": "true" }, "›"));
      const nm = x.tipo === "mun" ? POR_ID.get(x.id).nome : x.tipo === "rg" ? x.id : nomeDe(x);
      c.append(i === cadeia.length - 1 ? el("span", { class: "atual" }, nm) : el("button", { type: "button", onclick: () => irPara(x) }, nm));
    });
    const rg = S.esc.tipo === "rg" ? S.esc.id : S.esc.tipo === "uf" ? REGIAO[S.esc.id] : S.esc.tipo === "mun" ? POR_ID.get(S.esc.id).rg : "";
    const uf = S.esc.tipo === "uf" ? S.esc.id : S.esc.tipo === "mun" ? POR_ID.get(S.esc.id).uf : "";
    $("#sel-rg").value = rg; $("#sel-uf").value = uf;
    for (const b of document.querySelectorAll("#turnos button")) b.setAttribute("aria-pressed", String(b.dataset.t === S.turno));
  }

  function renderResultado() {
    $("#resultado").hidden = false;
    const lista = listaDe(S.esc), ag = agregar(lista), t = tDe(), x = ag[t];
    const cmp = S.turno === "cmp" && TEM_T2;
    const nome = nomeDe(S.esc);
    $("#res-titulo").textContent = `${nome} · ${cmp ? "1º e 2º turno" : t === "t1" ? "1º turno" : "2º turno"}`;
    const st = D.meta.turnos[t] || {};
    $("#res-status").textContent = st.dg ? `Totalizado em ${st.dg} ${st.hg || ""}` : "";
    const lead = $("#res-lead"); lead.textContent = "";
    const cands = $("#res-cands"); cands.textContent = "";
    const kpis = $("#res-kpis"); kpis.textContent = "";
    if (!x || !x.vv) { lead.textContent = "Sem votos apurados para este local."; return; }

    const ord = Object.keys(x.v).filter((n) => CAND[n]).sort((a, b) => x.v[b] - x.v[a]);
    const [p1, p2] = ord;
    const dif = sh(x, p1) - sh(x, p2);
    lead.append(t === "t2" ? `No 2º turno, ` : `No 1º turno, `, el("b", {}, CAND[p1].nome),
      ` ${t === "t2" ? "venceu" : "foi o mais votado"} em ${nome} com `, el("b", {}, pct(sh(x, p1))),
      ` dos votos válidos (${fmt(x.v[p1])} votos), ${(dif * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pontos à frente de ${CAND[p2].nome}` +
      ` (${fmt(x.v[p1] - x.v[p2])} votos de diferença).`);
    if (cmp) {
      const y = ag.t1, dG = sh(ag.t2, G) - sh(y, G);
      lead.append(` Entre os turnos, ${CAND[G].nome} variou ${pp(dG)} e ${CAND[G === A ? B : A].nome} ${pp(sh(ag.t2, G === A ? B : A) - sh(y, G === A ? B : A))}.`);
    }

    const max = Math.max(...ord.map((n) => sh(x, n)), cmp ? Math.max(sh(ag.t1, A), sh(ag.t1, B)) : 0);
    for (const n of ord) {
      const c = CAND[n], p = sh(x, n);
      const trilho = el("div", { class: "trilho", role: "presentation" });
      if (cmp) trilho.append(el("div", { class: "barra t1", style: `width:${(sh(ag.t1, n) / max) * 100}%;background:var(${c.cor})` }));
      trilho.append(el("div", { class: "barra", style: `width:${(p / max) * 100}%;background:var(${c.cor});${cmp ? "height:8px;top:3px" : ""}` }));
      const vencedor = t === "t2" && n === p1;
      cands.append(el("div", { class: "cand" },
        el("div", { class: "nome" }, el("span", { class: "sw", style: `background:var(${c.cor})` }), c.nome,
          vencedor ? el("span", { class: "selo" }, S.esc.tipo === "br" && c.e === "s" ? "Eleito" : "Venceu aqui") : null,
          el("small", {}, `${c.n}${c.partido ? " · " + c.partido : ""}`)),
        trilho,
        el("div", { class: "val num" }, el("b", {}, pct(p)),
          el("span", {}, cmp ? `1º turno ${pct(sh(ag.t1, n))} → ${pp(p - sh(ag.t1, n))}` : `${fmt(x.v[n])} votos`))));
    }

    const k = (rot, v, d, cls) => kpis.append(el("div", { class: "kpi" }, el("span", { class: "eyebrow" }, rot), el("span", { class: "v num" }, v), el("span", { class: "d num " + (cls || "") }, d)));
    const delta = (f) => (cmp ? f(ag.t2) - f(ag.t1) : null);
    const dtxt = (dv, rel) => (dv == null ? rel : `${pp(dv)} vs. 1º turno`);
    k("Eleitorado", fmt(x.e), `${fmt(lista.length)} município${lista.length > 1 ? "s" : ""}`);
    k("Compareceram", pct(x.c / x.e), dtxt(delta((y) => y.c / y.e), `${fmt(x.c)} pessoas`));
    k("Abstenção", pct(x.a / x.e), dtxt(delta((y) => y.a / y.e), `${fmt(x.a)} pessoas`));
    k("Votos válidos", fmt(x.vv), `${pct(x.vv / x.c)} de quem votou`);
    k("Brancos", pct(x.vb / x.c), dtxt(delta((y) => y.vb / y.c), `${fmt(x.vb)} votos`));
    k("Nulos", pct(x.vn / x.c), dtxt(delta((y) => y.vn / y.c), `${fmt(x.vn)} votos`));
  }

  // ---------- mapa ----------
  const MP = { feats: [], ufs: [], w: 0, h: 0, pick: null, proj: null, cor: null, met: null };
  function prepararMapa() {
    if (!MAPA) return;
    MP.feats = MAPA.mun.features.map((f) => ({ f, m: POR_IBGE.get(String(f.id)) })).filter((x) => x.m);
    MP.ufs = MAPA.uf.features;
  }
  function renderMapa() {
    const sec = $("#mapa"); sec.hidden = false;
    const mets = metricas();
    if (!mets.find((m) => m.id === S.metrica)) S.metrica = mets[0].id;
    const sel = $("#sel-metrica"); sel.textContent = "";
    for (const m of mets) sel.append(el("option", { value: m.id }, m.nome));
    sel.value = S.metrica;
    const met = mets.find((m) => m.id === S.metrica);
    MP.met = met;
    $("#metrica-desc").textContent = met.desc;
    const vals = MUN.map((m) => (m[tDe()] && (S.turno !== "cmp" || m.t1) ? met.val(m) : NaN)).map((v) => (typeof v === "object" ? NaN : v));
    MP.cor = escala(met, vals);
    desenharMapa();
    legenda(met);
    ranking(met);
  }

  function desenharMapa() {
    const cv = $("#cv-mapa");
    if (!MAPA || !MP.feats.length) { cv.hidden = true; return; }
    cv.hidden = false;
    const w = cv.clientWidth || 600, h = Math.round(Math.min(w * 0.95, 680)), dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + "px";
    MP.w = w; MP.h = h;
    const lista = new Set(listaDe(S.esc));
    let alvo = MP.feats.filter((x) => lista.has(x.m));
    if (S.esc.tipo === "mun") alvo = MP.feats.filter((x) => x.m.uf === POR_ID.get(S.esc.id).uf);
    if (!alvo.length) alvo = MP.feats;
    const proj = d3.geoMercator().fitExtent([[8, 8], [w - 8, h - 8]], { type: "FeatureCollection", features: alvo.map((x) => x.f) });
    MP.proj = proj;
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const pk = MP.pick || (MP.pick = document.createElement("canvas"));
    pk.width = w; pk.height = h;
    const pctx = pk.getContext("2d", { willReadFrequently: true }); pctx.clearRect(0, 0, w, h);
    const path = d3.geoPath(proj, ctx), ppath = d3.geoPath(proj, pctx);
    const fundo = css("--line"), borda = css("--panel");
    const sel = S.esc.tipo === "mun" ? POR_ID.get(S.esc.id) : null;
    MP.feats.forEach((x, idx) => {
      const dentro = lista.has(x.m) || (sel && x.m.uf === sel.uf);
      let v = NaN;
      if (x.m[tDe()] && (S.turno !== "cmp" || x.m.t1)) v = MP.met.val(x.m);
      const c = MP.cor(v, x.m) || fundo;
      ctx.beginPath(); path(x.f.geometry);
      ctx.globalAlpha = dentro ? 1 : 0.18; ctx.fillStyle = c; ctx.fill();
      ctx.globalAlpha = 1;
      if (dentro && alvo.length < 1200) { ctx.strokeStyle = borda; ctx.lineWidth = 0.4; ctx.stroke(); }
      if (dentro) { const id = idx + 1; pctx.beginPath(); ppath(x.f.geometry); pctx.fillStyle = `rgb(${id & 255},${(id >> 8) & 255},${(id >> 16) & 255})`; pctx.fill(); }
    });
    ctx.strokeStyle = css("--fg-2"); ctx.lineWidth = 0.7; ctx.globalAlpha = 0.55;
    for (const f of MP.ufs) { ctx.beginPath(); path(f.geometry); ctx.stroke(); }
    ctx.globalAlpha = 1;
    if (sel) {
      const f = MP.feats.find((x) => x.m === sel);
      if (f) { ctx.beginPath(); path(f.f.geometry); ctx.lineWidth = 2.5; ctx.strokeStyle = css("--fg"); ctx.stroke(); }
    }
  }

  function pegar(ev) {
    const cv = $("#cv-mapa"), r = cv.getBoundingClientRect();
    const x = Math.floor(ev.clientX - r.left), y = Math.floor(ev.clientY - r.top);
    if (!MP.pick || x < 0 || y < 0 || x >= MP.w || y >= MP.h) return null;
    const d = MP.pick.getContext("2d", { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
    if (d[3] < 255) return null;
    const id = d[0] + (d[1] << 8) + (d[2] << 16);
    return MP.feats[id - 1] ? MP.feats[id - 1].m : null;
  }

  function dica(ev, m) {
    const tip = $("#tip");
    if (!m) { tip.hidden = true; return; }
    tip.textContent = "";
    const t = tDe(), cmp = S.turno === "cmp" && TEM_T2;
    tip.append(el("div", {}, el("b", {}, m.nome), ` · ${m.uf}`));
    const v = MP.met.val(m);
    tip.append(el("div", { class: "linha" }, el("span", {}, MP.met.nome), el("b", { class: "num" }, typeof v === "object" ? MP.met.fmt(v) : MP.met.fmt(v))));
    const lin = (rot, val) => tip.append(el("div", { class: "linha" }, el("span", {}, rot), el("span", { class: "num" }, val)));
    if (cmp) {
      for (const n of FIN) lin(CAND[n].nome, `${pct(sh(m.t1, n))} → ${pct(sh(m.t2, n))}`);
      if (m.mod) lin("Esperado p/ " + CAND[A].nome, pct(m.mod.esp));
    } else if (m[t]) {
      const ord = Object.keys(m[t].v).sort((a, b) => m[t].v[b] - m[t].v[a]).slice(0, 3);
      for (const n of ord) lin(CAND[n].nome, pct(sh(m[t], n)));
      lin("Eleitorado", fmt(m[t].e));
    }
    tip.hidden = false;
    posicionar(tip, ev);
  }
  function posicionar(tip, ev) {
    const pw = tip.offsetWidth, ph = tip.offsetHeight, W = window.innerWidth, H = window.innerHeight;
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + pw > W - 8) x = ev.clientX - pw - 14;
    if (y + ph > H - 8) y = ev.clientY - ph - 14;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }

  function legenda(met) {
    const L = $("#legenda"); L.textContent = "";
    const sw = (cor, txt) => L.append(el("span", {}, el("span", { class: "sw", style: `background:${cor}` }), txt));
    if (met.tipo === "venc1") {
      const vistos = new Set(MUN.map((m) => { const l = m.t1 && lider(m.t1); return l && l.n; }).filter(Boolean));
      [...vistos].sort((a, b) => CAND[a].k - CAND[b].k).forEach((n) => sw(`var(${CAND[n].cor})`, CAND[n].nome));
      L.append(el("span", { class: "muted" }, "Cor mais forte = fatia maior."));
      return;
    }
    if (met.tipo === "virada") {
      FIN.forEach((n) => sw(`var(${CAND[n].cor})`, `Virou para ${CAND[n].nome}`));
      sw("var(--mid)", "Manteve o líder do 1º turno");
      return;
    }
    let lo, hi, rotLo, rotHi, cores;
    if (met.tipo === "venc2") { lo = 0.2; hi = 0.8; cores = [0.2, 0.35, 0.5, 0.65, 0.8].map((v) => MP.cor(v)); rotLo = `${CAND[B].nome} 80%`; rotHi = `${CAND[A].nome} 80%`; }
    else { lo = MP.cor.lo; hi = MP.cor.hi; cores = d3.range(0, 1.0001, 0.25).map((f) => MP.cor(lo + (hi - lo) * f)); rotLo = met.fmt(lo); rotHi = met.fmt(hi); }
    const grad = `linear-gradient(90deg, ${cores.join(",")})`;
    L.append(el("div", { class: "rampa-wrap" }, el("div", { class: "rampa", style: `background:${grad}` }),
      el("div", { class: "rampa-ticks num" }, el("span", {}, rotLo), met.tipo.startsWith("div") || met.tipo === "venc2" ? el("span", {}, met.tipo === "venc2" ? "empate" : "0") : null, el("span", {}, rotHi))));
    if (met.tipo === "div" || met.tipo === "divn") L.append(el("span", { class: "muted" }, met.tipo === "divn" ? "Verde = abstenção caiu; laranja = subiu." : `Para o lado de ${CAND[met.cor[1]].nome} ou de ${CAND[met.cor[0]].nome}.`));
  }

  function ranking(met) {
    const box = $("#ranking"); box.textContent = "";
    const fs = filhos(S.esc).map((f) => {
      const x = f.m || agregar(listaDe(f.esc));
      let v = (x[tDe()] && (S.turno !== "cmp" || x.t1)) ? met.val(x) : NaN;
      return { ...f, x, v };
    });
    const num = (v) => (v && typeof v === "object" ? v.p : v);
    fs.sort((a, b) => (num(b.v) ?? -Infinity) - (num(a.v) ?? -Infinity) || 0);
    const vals = fs.map((f) => Math.abs(num(f.v))).filter(isFinite);
    const mx = Math.max(...vals, 1e-9);
    $("#rank-titulo").textContent = `${met.nome} · ${S.esc.tipo === "br" || S.esc.tipo === "rg" ? "por estado" : "por município"}`;
    fs.forEach((f, i) => {
      const v = num(f.v), atual = S.esc.tipo === "mun" && f.esc.id === S.esc.id;
      const cor = MP.cor(f.v, f.m || f.x) || "var(--line)";
      box.append(el("button", { type: "button", onclick: () => irPara(f.esc), "aria-current": atual ? "true" : null, style: atual ? "background:var(--accent-soft)" : null },
        el("span", { class: "pos num" }, i + 1),
        el("span", { style: "min-width:0" }, el("div", { class: "nm" }, f.esc.tipo === "uf" ? `${f.nome}` : f.nome),
          el("div", { class: "mini", style: `width:${isFinite(v) ? Math.max(2, (Math.abs(v) / mx) * 100) : 0}%;background:${cor}` })),
        el("span", { class: "num small" }, met.fmt(f.v))));
    });
  }

  // ---------- análise entre turnos ----------
  function renderAnalise() {
    const sec = $("#analise");
    if (!TEM_T2) { sec.hidden = true; return; }
    sec.hidden = false;
    const lista = listaDe(S.esc).filter((m) => m.t1 && m.t2), ag = agregar(lista);
    if (!ag.t1 || !ag.t2) { sec.hidden = true; return; }
    ponte(ag);
    const ctxLista = S.esc.tipo === "mun" ? MUN.filter((m) => m.uf === POR_ID.get(S.esc.id).uf && m.mod) : lista.filter((m) => m.mod);
    const destaque = S.esc.tipo === "mun" ? POR_ID.get(S.esc.id) : null;
    dispersao($("#cv-disp1"), ctxLista, destaque, {
      x: (m) => sh(m.t1, A), y: (m) => sh(m.t2, A), xl: `${CAND[A].nome} no 1º turno`, yl: `${CAND[A].nome} no 2º turno`, diag: true,
    });
    $("#disp1-titulo").textContent = `${CAND[A].nome}: 1º turno × 2º turno`;
    $("#disp1-cap").textContent = `Cada ponto é um município${S.esc.tipo === "br" ? "" : " de " + (S.esc.tipo === "mun" ? D.uf[destaque.uf] : nomeDe(S.esc))}, do tamanho do seu eleitorado. Acima da linha tracejada, ${CAND[A].nome} cresceu no 2º turno; abaixo, perdeu espaço. Pontos em destaque estão fora do padrão (mais de 3 desvios).`;
    const O = (m) => outros1(m.t1) / m.t1.vv;
    dispersao($("#cv-disp2"), ctxLista, destaque, {
      x: O, y: (m) => sh(m.t2, G) - sh(m.t1, G), xl: "Votos dos eliminados no 1º turno (% dos válidos)", yl: `Crescimento de ${CAND[G].nome} (p.p.)`, yfmt: pp, zero: true,
    });
    $("#disp2-titulo").textContent = `Votos dos eliminados × crescimento de ${CAND[G].nome}`;
    $("#disp2-cap").textContent = `Onde os candidatos eliminados tiveram mais votos, sobrou mais voto para disputar no 2º turno. Se os pontos sobem da esquerda para a direita, ${CAND[G].nome} cresceu justamente onde havia mais voto de eliminados para herdar.`;
    textoModelo();
    tabelaAtipicos(ctxLista.filter((m) => S.esc.tipo === "mun" || lista.includes(m)));
  }

  function ponte(ag) {
    const box = $("#ponte"); box.textContent = "";
    const t1 = ag.t1, t2 = ag.t2, O1 = outros1(t1);
    const partes1 = [[A, t1.v[A] || 0], [B, t1.v[B] || 0], ["outros", O1], ["bn", t1.vb + t1.vn], ["abst", t1.a]];
    const partes2 = [[A, t2.v[A] || 0], [B, t2.v[B] || 0], ["bn", t2.vb + t2.vn], ["abst", t2.a]];
    const cor = (k) => (k === A || k === B ? `var(${CAND[k].cor})` : k === "outros" ? "var(--outros)" : k === "bn" ? "var(--line-strong)" : "var(--mid)");
    const rot = (k) => (k === A || k === B ? CAND[k].nome : k === "outros" ? "Outros candidatos" : k === "bn" ? "Brancos e nulos" : "Não votou");
    const mx = Math.max(t1.e, t2.e);
    const barra = (titulo, partes, tot) => {
      const tr = el("div", { class: "trilho" });
      let acc = 0;
      for (const [k, v] of partes) {
        const s = el("div", { class: "seg-b", style: `left:calc(${(acc / mx) * 100}% + 1px);width:calc(${(v / mx) * 100}% - 2px);background:${cor(k)}` });
        s.addEventListener("mousemove", (ev) => { const tip = $("#tip"); tip.textContent = ""; tip.append(el("b", {}, rot(k)), el("div", { class: "num" }, `${fmt(v)} (${pct(v / tot)} do eleitorado)`)); tip.hidden = false; posicionar(tip, ev); });
        s.addEventListener("mouseleave", () => ($("#tip").hidden = true));
        tr.append(s); acc += v;
      }
      box.append(el("div", { class: "ponte-linha" }, el("b", {}, titulo), tr, el("span", { class: "v num small" }, fmt(tot) + " eleitores")));
    };
    barra("1º turno", partes1, t1.e);
    barra("2º turno", partes2, t2.e);
    const leg = el("div", { class: "legenda" });
    for (const k of [A, B, "outros", "bn", "abst"]) leg.append(el("span", {}, el("span", { class: "sw", style: `background:${cor(k)}` }), rot(k)));
    box.append(leg);

    const dA = (t2.v[A] || 0) - (t1.v[A] || 0), dB = (t2.v[B] || 0) - (t1.v[B] || 0);
    const dBN = (t2.vb + t2.vn) - (t1.vb + t1.vn), dAb = t2.a - t1.a, dE = t2.e - t1.e;
    const tx = $("#ponte-texto"); tx.textContent = "";
    tx.append(`No 1º turno, os candidatos eliminados somaram `, el("b", {}, fmt(O1) + " votos"), `. No 2º turno, `,
      el("b", {}, CAND[A].nome), ` teve ${sinal(dA)} votos e `, el("b", {}, CAND[B].nome), ` ${sinal(dB)}. `,
      `Brancos e nulos variaram ${sinal(dBN)} e as abstenções ${sinal(dAb)}${dE ? ` (o eleitorado mudou ${sinal(dE)})` : ""}. `,
      `A conta fecha: ganho dos dois finalistas (${sinal(dA + dB)}) = votos dos eliminados (${fmt(O1)}) − mais brancos e nulos (${sinal(dBN)}) − mais abstenções (${sinal(dAb)})${dE ? ` + variação do eleitorado (${sinal(dE)})` : ""}.`);
    if (O1 > 0) {
      const ganho = dA + dB;
      tx.append(` Se nenhum eleitor tivesse trocado de lado, ${CAND[A].nome} teria herdado cerca de `, el("b", {}, pct(Math.max(0, dA) / Math.max(1, ganho))),
        ` desse saldo e ${CAND[B].nome} cerca de `, el("b", {}, pct(Math.max(0, dB) / Math.max(1, ganho))), `. Na prática, parte dos eleitores também muda de lado ou deixa de votar, por isso esta é a leitura mais simples, não a única.`);
    }
  }

  function dispersao(cv, lista, destaque, o) {
    const w = cv.clientWidth || 500, h = Math.round(Math.min(420, Math.max(260, w * 0.75))), dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + "px";
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const m = { l: 52, r: 12, t: 10, b: 40 };
    const pts = lista.map((mu) => ({ mu, x: o.x(mu), y: o.y(mu) })).filter((p) => isFinite(p.x) && isFinite(p.y));
    if (!pts.length) return;
    const xe = d3.extent(pts, (p) => p.x), ye = d3.extent(pts, (p) => p.y);
    if (o.diag) { const lo = Math.min(xe[0], ye[0]), hi = Math.max(xe[1], ye[1]); xe[0] = ye[0] = lo; xe[1] = ye[1] = hi; }
    const X = d3.scaleLinear().domain(xe).nice().range([m.l, w - m.r]);
    const Y = d3.scaleLinear().domain(ye).nice().range([h - m.b, m.t]);
    const R = d3.scaleSqrt().domain([0, d3.max(pts, (p) => p.mu.t2.e)]).range([1.2, w < 500 ? 12 : 18]);
    const ink = css("--muted"), grid = css("--line"), fg = css("--fg-2");
    ctx.font = "11px " + css("--font-body"); ctx.fillStyle = ink; ctx.strokeStyle = grid; ctx.lineWidth = 1;
    const yf = o.yfmt || ((v) => pct(v, 0)), xf = (v) => pct(v, 0);
    for (const t of Y.ticks(5)) { ctx.beginPath(); ctx.moveTo(m.l, Y(t) + 0.5); ctx.lineTo(w - m.r, Y(t) + 0.5); ctx.stroke(); ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(o.yfmt ? pp(t, 0) : yf(t), m.l - 6, Y(t)); }
    for (const t of X.ticks(5)) { ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(xf(t), X(t), h - m.b + 6); }
    ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.fillText(o.xl, (m.l + w - m.r) / 2, h - 14);
    ctx.save(); ctx.translate(12, (m.t + h - m.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = "middle"; ctx.fillText(o.yl, 0, 0); ctx.restore();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = css("--line-strong"); ctx.beginPath();
    if (o.diag) { ctx.moveTo(X(xe[0]), Y(xe[0])); ctx.lineTo(X(xe[1]), Y(xe[1])); }
    if (o.zero && Y.domain()[0] < 0) { ctx.moveTo(m.l, Y(0)); ctx.lineTo(w - m.r, Y(0)); }
    ctx.stroke(); ctx.setLineDash([]);
    const base = css("--outros"), alerta = css("--warn"), ring = css("--panel");
    pts.sort((a, b) => b.mu.t2.e - a.mu.t2.e);
    for (const p of pts) {
      const atip = p.mu.mod && Math.abs(p.mu.mod.z) > 3;
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), R(p.mu.t2.e), 0, 2 * Math.PI);
      ctx.globalAlpha = atip ? 0.9 : 0.45; ctx.fillStyle = atip ? alerta : base; ctx.fill();
      ctx.globalAlpha = 1; ctx.lineWidth = 0.6; ctx.strokeStyle = ring; ctx.stroke();
    }
    if (destaque) {
      const p = pts.find((q) => q.mu === destaque);
      if (p) { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), R(p.mu.t2.e) + 3, 0, 2 * Math.PI); ctx.lineWidth = 2.5; ctx.strokeStyle = css("--fg"); ctx.stroke(); ctx.fillStyle = css("--fg"); ctx.textAlign = "left"; ctx.font = "600 12px " + css("--font-body"); ctx.fillText(destaque.nome, X(p.x) + R(p.mu.t2.e) + 6, Y(p.y)); }
    }
    const qt = d3.quadtree(pts, (p) => X(p.x), (p) => Y(p.y));
    cv.onmousemove = (ev) => {
      const r = cv.getBoundingClientRect(), q = qt.find(ev.clientX - r.left, ev.clientY - r.top, 24);
      const tip = $("#tip");
      if (!q) { tip.hidden = true; cv.style.cursor = "default"; return; }
      cv.style.cursor = "pointer"; tip.textContent = "";
      tip.append(el("div", {}, el("b", {}, q.mu.nome), ` · ${q.mu.uf}`),
        el("div", { class: "linha" }, el("span", {}, o.xl), el("span", { class: "num" }, pct(q.x))),
        el("div", { class: "linha" }, el("span", {}, o.yl), el("span", { class: "num" }, o.yfmt ? o.yfmt(q.y) : pct(q.y))),
        el("div", { class: "linha" }, el("span", {}, "Eleitorado"), el("span", { class: "num" }, fmt(q.mu.t2.e))));
      tip.hidden = false; posicionar(tip, ev);
    };
    cv.onmouseleave = () => ($("#tip").hidden = true);
    cv.onclick = (ev) => { const r = cv.getBoundingClientRect(), q = qt.find(ev.clientX - r.left, ev.clientY - r.top, 24); if (q) irPara({ tipo: "mun", id: q.mu.id }); };
  }

  function textoModelo() {
    const b = MODELO.beta, tx = $("#modelo-texto"); tx.textContent = "";
    const atip = MUN.filter((m) => m.mod && Math.abs(m.mod.z) > 3).length;
    tx.append(`Para cada município, estimamos quanto ${CAND[A].nome} "deveria" ter no 2º turno olhando só para o 1º turno da própria cidade: `,
      `quanto ${CAND[A].nome} teve, quanto tiveram os candidatos eliminados, quanto a abstenção mudou e em que estado fica a cidade. `,
      `A regra foi ajustada com os ${fmt(MODELO.n)} municípios ao mesmo tempo e explica `, el("b", {}, pct(MODELO.r2)), ` da variação do resultado. `,
      `Em média, cada ponto que ${CAND[A].nome} teve no 1º turno virou ${(b[0]).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ponto no 2º, e os eleitores dos eliminados se dividiram como o estado inteiro se dividiu. `,
      `Um município "fora do padrão" é aquele cujo resultado real ficou longe dessa estimativa, levando em conta que cidades pequenas variam mais por acaso. `,
      `No país, `, el("b", {}, `${fmt(atip)} municípios`), ` ficaram a mais de 3 desvios do esperado. `,
      el("b", {}, "Fora do padrão não quer dizer fraude"), `: costuma refletir um prefeito ou liderança local que apoiou um dos lados, uma campanha forte na cidade, mudanças no transporte de eleitores ou um 1º turno com candidato muito local. É um ponto de partida para olhar mais de perto, não uma conclusão.`);
  }

  function tabelaAtipicos(lista) {
    const tab = $("#tab-atip"); tab.textContent = "";
    const modo = $("#sel-atip").value;
    let ls = lista.filter((m) => m.mod);
    if (modo === "votos") ls.sort((a, b) => Math.abs(b.mod.rv) - Math.abs(a.mod.rv));
    else if (modo === "z") ls.sort((a, b) => Math.abs(b.mod.z) - Math.abs(a.mod.z));
    else if (modo === "abst+") ls.sort((a, b) => b.mod.dabst - a.mod.dabst);
    else if (modo === "abst-") ls.sort((a, b) => a.mod.dabst - b.mod.dabst);
    else ls = ls.filter((m) => m.mod.virada).sort((a, b) => b.t2.e - a.t2.e);
    const tot = ls.length; ls = ls.slice(0, 50);
    $("#atip-titulo").textContent = modo === "virada" ? `Viradas (${fmt(tot)} municípios)` : "Municípios fora do padrão";
    const cab = ["Município", "UF", "Eleitores", `${CAND[A].nome} 1º`, `${CAND[A].nome} esperado`, `${CAND[A].nome} 2º real`, "Diferença", "Votos fora do esperado", "Desvios", "Abstenção (var.)"];
    tab.append(el("thead", {}, el("tr", {}, cab.map((c, i) => el("th", { class: i < 2 ? "txt" : "" }, c)))));
    const tb = el("tbody");
    for (const m of ls) {
      const z = m.mod.z, forte = Math.abs(z) > 3;
      tb.append(el("tr", { onclick: () => irPara({ tipo: "mun", id: m.id }) },
        el("td", { class: "txt" }, m.nome, forte ? el("span", { class: "selo alerta" }, "atípico") : null), el("td", { class: "txt" }, m.uf),
        el("td", { class: "num" }, fmt(m.t2.e)), el("td", { class: "num" }, pct(sh(m.t1, A))), el("td", { class: "num" }, pct(m.mod.esp)),
        el("td", { class: "num" }, pct(sh(m.t2, A))), el("td", { class: "num" }, pp(m.mod.r)), el("td", { class: "num" }, sinal(m.mod.rv)),
        el("td", { class: "num" }, (z > 0 ? "+" : "") + z.toLocaleString("pt-BR", { maximumFractionDigits: 1 })), el("td", { class: "num" }, pp(m.mod.dabst))));
    }
    if (!ls.length) tb.append(el("tr", {}, el("td", { colspan: cab.length, class: "txt muted" }, "Nenhum município nesta seleção.")));
    tab.append(tb);
  }

  // ---------- tabela completa ----------
  function renderTabela() {
    $("#tabela").hidden = false;
    const t = tDe(), cmp = S.turno === "cmp" && TEM_T2;
    const fs = filhos(S.esc).map((f) => ({ ...f, x: f.m || agregar(listaDe(f.esc)) })).filter((f) => f.x[t]);
    $("#tab-titulo").textContent = S.esc.tipo === "br" || S.esc.tipo === "rg" ? `Estados · ${nomeDe(S.esc)}` : `Municípios · ${D.uf[S.esc.tipo === "uf" ? S.esc.id : POR_ID.get(S.esc.id).uf]}`;
    const cands = cmp ? FIN : Object.values(CAND).filter((c) => (t === "t2" ? FIN.includes(c.n) : true)).sort((a, b) => a.k - b.k).slice(0, 6).map((c) => c.n);
    const cols = [
      { nm: S.esc.tipo === "br" || S.esc.tipo === "rg" ? "Estado" : "Município", txt: true, v: (f) => f.nome },
      { nm: "Eleitorado", v: (f) => f.x[t].e, f: fmt },
      { nm: "Abstenção", v: (f) => f.x[t].a / f.x[t].e, f: pct },
      { nm: "Brancos+nulos", v: (f) => (f.x[t].vb + f.x[t].vn) / f.x[t].c, f: pct },
    ];
    for (const n of cands) {
      if (cmp) {
        cols.push({ nm: `${CAND[n].nome} 1º`, v: (f) => sh(f.x.t1, n), f: pct, cor: CAND[n].cor });
        cols.push({ nm: `${CAND[n].nome} 2º`, v: (f) => sh(f.x.t2, n), f: pct, cor: CAND[n].cor });
        cols.push({ nm: `Var. ${CAND[n].nome}`, v: (f) => sh(f.x.t2, n) - sh(f.x.t1, n), f: pp });
      } else cols.push({ nm: CAND[n].nome, v: (f) => sh(f.x[t], n), f: pct, cor: CAND[n].cor });
    }
    if (cmp) cols.push({ nm: "Var. abstenção", v: (f) => f.x.t2.a / f.x.t2.e - f.x.t1.a / f.x.t1.e, f: pp });
    else cols.push({ nm: "Vencedor", txt: true, v: (f) => { const l = lider(f.x[t]); return l ? CAND[l.n].nome : ""; }, tag: (f) => { const l = lider(f.x[t]); return l ? CAND[l.n].cor : null; } });

    if (!S.tabSort || S.tabSort.i >= cols.length) S.tabSort = { i: 1, dir: -1 };
    const filtro = ($("#tab-busca").value || "").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    let linhas = fs.filter((f) => !filtro || f.nome.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").includes(filtro));
    const c = cols[S.tabSort.i];
    linhas.sort((a, b) => { const va = c.v(a), vb = c.v(b); return (typeof va === "string" ? va.localeCompare(vb, "pt-BR") : (va ?? -Infinity) - (vb ?? -Infinity)) * S.tabSort.dir; });

    const tab = $("#tab-locais"); tab.textContent = "";
    tab.append(el("thead", {}, el("tr", {}, cols.map((col, i) => el("th", {
      class: col.txt ? "txt" : "", "aria-sort": i === S.tabSort.i ? (S.tabSort.dir > 0 ? "ascending" : "descending") : null, tabindex: "0",
      onclick: () => { S.tabSort = { i, dir: S.tabSort.i === i ? -S.tabSort.dir : col.txt ? 1 : -1 }; renderTabela(); },
      onkeydown: (e) => { if (e.key === "Enter") e.target.click(); },
    }, col.cor ? el("span", { class: "tag", style: `background:var(${col.cor})` }) : null, col.nm)))));
    const tb = el("tbody");
    for (const f of linhas) {
      tb.append(el("tr", { onclick: () => irPara(f.esc) }, cols.map((col) => {
        const v = col.v(f);
        return el("td", { class: col.txt ? "txt" : "num" }, col.tag && col.tag(f) ? el("span", { class: "tag", style: `background:var(${col.tag(f)})` }) : null, col.f ? col.f(v) : v);
      })));
    }
    tab.append(tb);
  }

  // ---------- navegação e eventos ----------
  function hashDe() {
    const e = S.esc, t = S.turno;
    if (e.tipo === "br") return t;
    if (e.tipo === "mun") { const m = POR_ID.get(e.id); return `${t}-${m.uf}-${m.ibge || m.i}`; }
    return `${t}-${e.id}`;
  }
  function lerHash() {
    const h = decodeURIComponent((location.hash || "").slice(1));
    if (!h) return;
    const [t, a, b] = h.split("-").reduce((acc, p, i) => { if (i < 2) acc.push(p); else acc[acc.length - 1] += "-" + p; return acc; }, []);
    if (["t1", "t2", "cmp"].includes(t)) S.turno = t;
    if (!a) return;
    const resto = h.slice(t.length + 1);
    if (REGIOES.includes(resto)) { S.esc = { tipo: "rg", id: resto }; return; }
    const [uf, cod] = resto.split("-");
    if (cod) { const m = POR_IBGE.get(cod) || MUN[+cod]; if (m) S.esc = { tipo: "mun", id: m.id }; return; }
    if (D.uf[uf]) S.esc = { tipo: "uf", id: uf };
    void b;
  }

  function montarFiltros() {
    const rg = $("#sel-rg"); rg.append(el("option", { value: "" }, "Todas as regiões"));
    for (const r of REGIOES) if (MUN.some((m) => m.rg === r)) rg.append(el("option", { value: r }, r));
    rg.onchange = () => irPara(rg.value ? { tipo: "rg", id: rg.value } : { tipo: "br", id: "BR" });
    const uf = $("#sel-uf"); uf.append(el("option", { value: "" }, "Todos os estados"));
    Object.keys(D.uf).filter((u) => MUN.some((m) => m.uf === u)).sort((a, b) => D.uf[a].localeCompare(D.uf[b], "pt-BR"))
      .forEach((u) => uf.append(el("option", { value: u }, `${D.uf[u]} (${u})`)));
    uf.onchange = () => irPara(uf.value ? { tipo: "uf", id: uf.value } : { tipo: "br", id: "BR" });
    const dl = $("#lista-mun"), chave = new Map();
    for (const m of MUN) { const k = `${m.nome} (${m.uf})`; chave.set(k.toLowerCase(), m); dl.append(el("option", { value: k })); }
    const busca = $("#busca");
    const tentar = () => { const m = chave.get(busca.value.trim().toLowerCase()); if (m) { busca.value = ""; busca.blur(); irPara({ tipo: "mun", id: m.id }); } };
    busca.addEventListener("change", tentar); busca.addEventListener("input", tentar);
    for (const b of document.querySelectorAll("#turnos button")) b.onclick = () => { S.turno = b.dataset.t; S.metrica = null; S.tabSort = null; render(); };
    if (!TEM_T2) { for (const b of document.querySelectorAll('#turnos button:not([data-t="t1"])')) b.disabled = true; S.turno = "t1"; }
    $("#sel-metrica").onchange = (e) => { S.metrica = e.target.value; renderMapa(); };
    $("#sel-atip").onchange = () => renderAnalise();
    $("#tab-busca").oninput = () => renderTabela();
    const cv = $("#cv-mapa");
    cv.addEventListener("mousemove", (ev) => { const m = pegar(ev); cv.style.cursor = m ? "pointer" : "default"; dica(ev, m); });
    cv.addEventListener("mouseleave", () => ($("#tip").hidden = true));
    cv.addEventListener("click", (ev) => { const m = pegar(ev); if (m) { $("#tip").hidden = true; irPara({ tipo: "mun", id: m.id }); } });
    let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { desenharMapa(); renderAnalise(); }, 150); });
    if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => render());
    new MutationObserver(() => render()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  function notas() {
    const n = $("#notas"), m = D.meta;
    const t1 = m.turnos.t1 || {}, t2 = m.turnos.t2 || {};
    $("#fonte").textContent = `Fonte: Tribunal Superior Eleitoral (TSE), divulgação oficial de resultados. ` +
      `1º turno: ${t1.data || ""}${t1.dg ? ", totalização de " + t1.dg + " " + (t1.hg || "") : ""}.` +
      (t2.eleicao ? ` 2º turno: ${t2.data || ""}${t2.dg ? ", totalização de " + t2.dg + " " + (t2.hg || "") : ""}.` : "");
    n.append(
      el("p", {}, "De onde vêm os dados: arquivos públicos do TSE em ", el("a", { href: m.fonte, target: "_blank", rel: "noopener" }, "resultados.tse.jus.br"),
        `, os mesmos usados pelo site e pelo aplicativo oficial de resultados. Baixamos o total de cada um dos ${fmt(MUN.length)} municípios (incluindo cidades no exterior) nos dois turnos. A soma dos municípios é conferida com o total oficial do país e de cada estado.`),
      el("p", {}, "Mapas: malhas municipais do IBGE. Municípios do exterior aparecem nas tabelas, mas não no mapa."),
      el("p", {}, "Percentuais de candidatos são sobre os votos válidos, como na divulgação oficial. Abstenção é sobre o eleitorado; brancos e nulos, sobre quem compareceu."),
      el("p", {}, "Os dados por seção eleitoral (boletins de urna) também são públicos no TSE e permitem descer ainda mais, até a urna. Este painel para no município."));
  }

  // ---------- início ----------
  async function iniciar() {
    try {
      const [p, g] = await Promise.all([
        fetch("dados/painel.json").then((r) => { if (!r.ok) throw new Error("painel.json: " + r.status); return r.json(); }),
        fetch("dados/mapa.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      preparar(p); MAPA = g; prepararMapa();
      montarFiltros(); notas(); lerHash();
      $("#carregando").hidden = true; $("#glossario").hidden = false;
      render();
    } catch (e) {
      const c = $("#carregando"); c.classList.add("erro");
      c.textContent = "Não foi possível carregar os dados. Recarregue a página. (" + e.message + ")";
    }
  }
  iniciar();
})();
