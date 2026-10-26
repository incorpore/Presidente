/* Utilitários de gráfico do painel: escalas, cores, projeção do mapa e busca de ponto.
   Pequeno e sem dependências, para o painel abrir sem baixar bibliotecas. */
(() => {
  "use strict";

  // ---------- cores (interpolação no espaço OKLab) ----------
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  function rgb(s) {
    s = String(s).trim();
    if (s[0] === "#") {
      if (s.length === 4) s = "#" + [...s.slice(1)].map((c) => c + c).join("");
      const n = parseInt(s.slice(1, 7), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m = s.match(/[\d.]+/g);
    return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
  }
  function oklab([r, g, b]) {
    r = lin(r / 255); g = lin(g / 255); b = lin(b / 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function deOklab([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const c = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    return "rgb(" + c.map((v) => Math.round(Math.max(0, Math.min(1, gam(v))) * 255)).join(",") + ")";
  }
  function interpolateLab(a, b) {
    const A = oklab(rgb(a)), B = oklab(rgb(b));
    return (t) => deOklab([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t));
  }

  // ---------- escalas ----------
  function scaleLinear() {
    let dom = [0, 1], ran = [0, 1], interp = null, clamp = false;
    const s = (v) => {
      if (v == null || !isFinite(v)) return undefined;
      let i = 0;
      while (i < dom.length - 2 && v > dom[i + 1]) i++;
      const d0 = dom[i], d1 = dom[i + 1];
      let t = d1 === d0 ? 0 : (v - d0) / (d1 - d0);
      if (clamp) t = Math.max(0, Math.min(1, t));
      const r0 = ran[i], r1 = ran[i + 1];
      if (typeof r0 === "number" && !interp) return r0 + (r1 - r0) * t;
      return (interp || interpolateLab)(r0, r1)(t);
    };
    s.domain = (d) => (d ? ((dom = d.slice()), s) : dom.slice());
    s.range = (r) => (r ? ((ran = r.slice()), s) : ran.slice());
    s.interpolate = (f) => ((interp = f), s);
    s.clamp = (c) => ((clamp = !!c), s);
    s.ticks = (n = 10) => ticks(dom[0], dom[dom.length - 1], n);
    s.nice = (n = 10) => {
      const st = passo(dom[0], dom[dom.length - 1], n);
      if (st) { dom[0] = Math.floor(dom[0] / st) * st; dom[dom.length - 1] = Math.ceil(dom[dom.length - 1] / st) * st; }
      return s;
    };
    return s;
  }
  function scaleSqrt() {
    let dom = [0, 1], ran = [0, 1];
    const s = (v) => ran[0] + (ran[1] - ran[0]) * (dom[1] > 0 ? Math.sqrt(Math.max(0, v) / dom[1]) : 0);
    s.domain = (d) => ((dom = d), s);
    s.range = (r) => ((ran = r), s);
    return s;
  }
  function passo(a, b, n) {
    const span = Math.abs(b - a);
    if (!span) return 0;
    const raw = span / Math.max(1, n), p = 10 ** Math.floor(Math.log10(raw)), e = raw / p;
    return (e >= 7.07 ? 10 : e >= 3.16 ? 5 : e >= 1.41 ? 2 : 1) * p;
  }
  function ticks(a, b, n) {
    const st = passo(a, b, n);
    if (!st) return [a];
    const out = [];
    for (let v = Math.ceil(a / st) * st; v <= b + st * 1e-9; v += st) out.push(Math.round(v / st) * st);
    return out;
  }

  // ---------- estatística ----------
  const extent = (arr, f = (x) => x) => {
    let lo = Infinity, hi = -Infinity;
    for (const x of arr) { const v = f(x); if (v < lo) lo = v; if (v > hi) hi = v; }
    return [lo, hi];
  };
  const max = (arr, f = (x) => x) => extent(arr, f)[1];
  const range = (a, b, st = 1) => { const o = []; for (let v = a; v < b; v += st) o.push(v); return o; };
  const quantileSorted = (arr, p) => {
    if (!arr.length) return NaN;
    const i = (arr.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return arr[lo] + (arr[hi] - arr[lo]) * (i - lo);
  };

  // ---------- mapa: Mercator ajustado à caixa e desenho no canvas ----------
  const RAD = Math.PI / 180;
  const merc = ([lon, lat]) => [lon * RAD, Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2))];
  function cada(geom, f) { // percorre todos os pontos
    const c = geom.coordinates;
    if (geom.type === "Polygon" || geom.type === "MultiLineString") c.forEach((r) => r.forEach(f));
    else if (geom.type === "MultiPolygon") c.forEach((p) => p.forEach((r) => r.forEach(f)));
    else if (geom.type === "LineString") c.forEach(f);
  }
  function geoMercator() {
    let k = 1, tx = 0, ty = 0;
    const p = (pt) => { const [x, y] = merc(pt); return [tx + k * x, ty - k * y]; };
    p.fitExtent = ([[x0, y0], [x1, y1]], fc) => {
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (const f of fc.features) cada(f.geometry, (pt) => {
        const [x, y] = merc(pt);
        if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > d) d = y;
      });
      if (!isFinite(a)) return p;
      k = Math.min((x1 - x0) / (b - a || 1), (y1 - y0) / (d - c || 1));
      tx = x0 + ((x1 - x0) - k * (b - a)) / 2 - k * a;
      ty = y0 + ((y1 - y0) - k * (d - c)) / 2 + k * d;
      return p;
    };
    return p;
  }
  function geoPath(proj, ctx) {
    const anel = (r, fechar) => {
      r.forEach((pt, i) => { const [x, y] = proj(pt); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      if (fechar) ctx.closePath();
    };
    return (g) => {
      if (g.type === "Polygon") g.coordinates.forEach((r) => anel(r, true));
      else if (g.type === "MultiPolygon") g.coordinates.forEach((p) => p.forEach((r) => anel(r, true)));
      else if (g.type === "MultiLineString") g.coordinates.forEach((r) => anel(r, false));
      else if (g.type === "LineString") anel(g.coordinates, false);
    };
  }

  // ---------- ponto mais próximo (para a dica dos gráficos de dispersão) ----------
  function quadtree(pts, fx, fy) {
    const xy = pts.map((p) => [fx(p), fy(p), p]);
    return {
      find(x, y, r = Infinity) {
        let best = null, bd = r * r;
        for (const [px, py, p] of xy) { const d = (px - x) ** 2 + (py - y) ** 2; if (d < bd) { bd = d; best = p; } }
        return best;
      },
    };
  }

  window.gr = { interpolateLab, scaleLinear, scaleSqrt, extent, max, range, quantileSorted, geoMercator, geoPath, quadtree };
})();
