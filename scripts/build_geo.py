#!/usr/bin/env python3
"""Simplifica a malha municipal para o mapa do painel, sem abrir buracos entre vizinhos.

Entrada: data/geo/geojs-100-mun.json (malha municipal do IBGE, via github.com/tbrugz/geodata-br)
Saída:   web/dados/mapa.json com
         mun    FeatureCollection dos municípios (id = código IBGE)
         bordas MultiLineString das divisas entre estados e da fronteira do país

Cada trecho de divisa compartilhado por dois municípios é simplificado uma única
vez (Douglas-Peucker), então os dois lados continuam encaixados.
Somente biblioteca padrão do Python.
"""
import json
import os
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Q = 0.001     # grade de arredondamento (graus)
EPS = 0.012   # tolerância da simplificação (graus, ~1,2 km)


def dp(pts, eps):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    pilha = [(0, len(pts) - 1)]
    while pilha:
        a, b = pilha.pop()
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1
        n2 = dx * dx + dy * dy
        imax, dmax = -1, 0.0
        for i in range(a + 1, b):
            x, y = pts[i]
            if n2 == 0:
                d = (x - x1) ** 2 + (y - y1) ** 2
            else:
                t = ((x - x1) * dx + (y - y1) * dy) / n2
                t = max(0.0, min(1.0, t))
                d = (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2
            if d > dmax:
                imax, dmax = i, d
        if imax >= 0 and dmax > eps * eps:
            keep[imax] = True
            pilha += [(a, imax), (imax, b)]
    return [p for p, k in zip(pts, keep) if k]


def simplifica_trecho(seg, cache):
    inv = seg[0] > seg[-1] or (seg[0] == seg[-1] and seg[1] > seg[-2])
    s = seg[::-1] if inv else seg
    chave = (s[0], s[-1], len(s), s[len(s) // 2])
    if chave not in cache:
        cache[chave] = dp(s, EPS / Q)
    r = cache[chave]
    return r[::-1] if inv else r


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "geo", "geojs-100-mun.json")
    with open(src, encoding="utf-8") as f:
        gj = json.load(f)

    feats = []  # (id, [poligonos], poligono = [aneis], anel = [pontos inteiros])
    for ft in gj["features"]:
        fid = str(ft["properties"].get("id") or ft["properties"].get("codarea"))
        g = ft["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        out = []
        for p in polys:
            aneis = []
            for ring in p:
                r = []
                for x, y in ring:
                    k = (round(x / Q), round(y / Q))
                    if not r or k != r[-1]:
                        r.append(k)
                if len(r) > 1 and r[0] == r[-1]:
                    r.pop()
                if len(r) >= 3:
                    aneis.append(r)
            if aneis:
                out.append(aneis)
        feats.append((fid, out))

    donos = defaultdict(set)
    for fid, polys in feats:
        for p in polys:
            for r in p:
                for k in r:
                    donos[k].add(fid)

    cache, bordas, vistos = {}, [], set()
    saida = []
    for fid, polys in feats:
        novos = []
        for p in polys:
            aneis = []
            for r in p:
                n = len(r)
                junc = [i for i in range(n) if donos[r[i]] != donos[r[i - 1]] or donos[r[i]] != donos[r[(i + 1) % n]]]
                if not junc:  # anel inteiro com os mesmos donos: começa no menor ponto
                    i0 = r.index(min(r))
                    rr = r[i0:] + r[:i0]
                    if rr[1] > rr[-1]:
                        rr = [rr[0]] + rr[1:][::-1]
                    meio = len(rr) // 2
                    a = simplifica_trecho(rr[:meio + 1], cache)
                    b = simplifica_trecho(rr[meio:] + [rr[0]], cache)
                    novo = a[:-1] + b[:-1]
                    trechos = [rr[:meio + 1], rr[meio:] + [rr[0]]]
                else:
                    novo, trechos = [], []
                    for j, i in enumerate(junc):
                        fim = junc[(j + 1) % len(junc)]
                        seg = r[i:fim + 1] if fim > i else r[i:] + r[:fim + 1]
                        trechos.append(seg)
                        novo += simplifica_trecho(seg, cache)[:-1]
                for seg in trechos:
                    d = donos[seg[len(seg) // 2]] if len(seg) > 2 else donos[seg[0]] & donos[seg[-1]]
                    ufs = {x[:2] for x in d}
                    if len(d) == 1 or len(ufs) > 1:
                        s = simplifica_trecho(seg, cache)
                        chave = (min(s[0], s[-1]), max(s[0], s[-1]), len(s))
                        if chave not in vistos:
                            vistos.add(chave)
                            bordas.append([[x * Q, y * Q] for x, y in s])
                if len(novo) >= 3:
                    aneis.append([[x * Q, y * Q] for x, y in novo + [novo[0]]])
            if aneis:
                novos.append(aneis)
        if novos:
            saida.append({"type": "Feature", "id": fid, "properties": {},
                          "geometry": {"type": "MultiPolygon", "coordinates": novos}})

    def arred(o):
        if isinstance(o, float):
            return round(o, 3)
        if isinstance(o, list):
            return [arred(x) for x in o]
        return o

    mapa = {"mun": {"type": "FeatureCollection", "features": [{**f, "geometry": {**f["geometry"], "coordinates": arred(f["geometry"]["coordinates"])}} for f in saida]},
            "bordas": {"type": "MultiLineString", "coordinates": arred(bordas)}}
    os.makedirs(os.path.join(ROOT, "web", "dados"), exist_ok=True)
    dst = os.path.join(ROOT, "web", "dados", "mapa.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(mapa, f, separators=(",", ":"))
    npts = sum(len(r) for f in saida for p in f["geometry"]["coordinates"] for r in p)
    print(f"{len(saida)} municípios, {npts} pontos, {len(bordas)} trechos de divisa, {os.path.getsize(dst)} bytes")


if __name__ == "__main__":
    main()
