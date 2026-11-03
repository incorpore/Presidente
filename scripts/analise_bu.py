#!/usr/bin/env python3
"""Análise dos boletins de urna de Presidente, seção por seção.

Entrada: data/bu/secoes_<turno>_<UF>.csv.gz (scripts/fetch_bu.py)
Saída:   web/dados/bu.json  números para o painel
         data/bu/alertas.csv  lista completa de seções que chamam atenção

O que é verificado:
1. Liberação sem digital: eleitores com biometria cadastrada que votaram
   habilitados por outro meio (por exemplo o ano de nascimento), por estado,
   município e seção, e se isso anda junto com o voto em algum candidato
   (comparando seções da mesma cidade e a mesma seção entre os turnos).
2. Consistência de cada boletim: comparecimento + abstenção = aptos,
   votos = comparecimento, comparecimento <= aptos, liberados sem digital <=
   comparecimento.
3. Padrões raros: comparecimento de 100%, um candidato com todos os votos,
   urna usada em mais de uma seção, horários fora do comum, urnas que não
   foram apuradas normalmente e seções que não existem nos dois turnos.
Somente biblioteca padrão do Python.
"""
import csv
import glob
import gzip
import json
import os
import re
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BU = os.path.join(ROOT, "data", "bu")
A, B = "13", "22"  # Lula, Flávio Bolsonaro
LIM = 300  # alertas guardados por tipo no painel


def i(x):
    try:
        return int(x)
    except (TypeError, ValueError):
        return 0


def ler():
    sec = {}
    for p in sorted(glob.glob(os.path.join(BU, "secoes_*_*.csv.gz"))):
        t, uf = re.search(r"secoes_(\d)_([A-Z]{2})", p).groups()
        with gzip.open(p, "rt", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                k = (uf, r["mun"].zfill(5), r["zona"], r["secao"])
                v = {c[2:]: i(x) for c, x in r.items() if c.startswith("v_")}
                sec.setdefault(k, {})["t" + t] = {
                    "nm": r["nm"], "local": r["local"], "aptos": i(r["aptos"]), "comp": i(r["comp"]),
                    "abst": i(r["abst"]), "nh": i(r["nh"]), "agreg": r.get("agreg", ""), "tipo": r["tipo_urna"],
                    "urna": r["urna"], "ab": r["abertura"], "enc": r["encerr"], "v": v,
                }
    return sec


def validos(x):
    return sum(q for n, q in x["v"].items() if n not in ("95", "96"))


def inclinacao(pares):
    """Inclinação de y em x depois de tirar a média de cada grupo (efeito dentro do grupo)."""
    g = defaultdict(list)
    for grp, x, y, w in pares:
        g[grp].append((x, y, w))
    sxy = sxx = 0.0
    n = 0
    for lst in g.values():
        sw = sum(w for _, _, w in lst)
        if len(lst) < 2 or not sw:
            continue
        mx = sum(x * w for x, _, w in lst) / sw
        my = sum(y * w for _, y, w in lst) / sw
        for x, y, w in lst:
            sxy += w * (x - mx) * (y - my)
            sxx += w * (x - mx) ** 2
            n += 1
    return (sxy / sxx if sxx else 0.0), n


def corr(xs, ys):
    n = len(xs)
    if n < 3:
        return 0.0
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    return sxy / (sxx * syy) ** 0.5 if sxx and syy else 0.0


def main():
    sec = ler()
    print(len(sec), "seções")
    alertas = defaultdict(list)

    def alerta(tipo, k, t, detalhe, peso=0):
        x = sec[k][t]
        alertas[tipo].append({"tipo": tipo, "turno": t[1], "uf": k[0], "mun": k[1], "nm": x["nm"], "zona": k[2],
                              "secao": k[3], "aptos": x["aptos"], "comp": x["comp"], "detalhe": detalhe, "peso": peso})

    tot = {t: defaultdict(int) for t in ("t1", "t2")}
    uf = defaultdict(lambda: {t: defaultdict(int) for t in ("t1", "t2")})
    mun = defaultdict(lambda: {t: defaultdict(int) for t in ("t1", "t2")})
    urnas = {t: defaultdict(list) for t in ("t1", "t2")}
    horas = {t: defaultdict(int) for t in ("t1", "t2")}
    tipos = {t: defaultdict(int) for t in ("t1", "t2")}

    for k, s in sec.items():
        for t, x in s.items():
            vt = sum(x["v"].values())
            for agg in (tot[t], uf[k[0]][t], mun[(k[0], k[1])][t]):
                agg["secoes"] += 1
                agg["aptos"] += x["aptos"]
                agg["comp"] += x["comp"]
                agg["nh"] += x["nh"]
                agg["A"] += x["v"].get(A, 0)
                agg["B"] += x["v"].get(B, 0)
                agg["vv"] += validos(x)
            mun[(k[0], k[1])][t]["nm"] = x["nm"]
            tipos[t][x["tipo"]] += 1
            if x["urna"] and x["urna"] not in ("-1", "0"):
                urnas[t][x["urna"]].append(k)
            horas[t][("ab", x["ab"][:2])] += 1
            horas[t][("enc", x["enc"][:2])] += 1

            # 2. consistência do boletim
            if x["comp"] + x["abst"] != x["aptos"]:
                alerta("conta_aptos", k, t, f"comparecimento {x['comp']} + abstenções {x['abst']} ≠ aptos {x['aptos']}", 1e6)
            if vt != x["comp"]:
                alerta("conta_votos", k, t, f"votos {vt} ≠ comparecimento {x['comp']}", 1e6)
            if x["comp"] > x["aptos"]:
                alerta("acima_aptos", k, t, f"comparecimento {x['comp']} > aptos {x['aptos']}", 1e6)
            if x["nh"] > x["comp"]:
                alerta("nh_acima", k, t, f"liberados sem digital {x['nh']} > comparecimento {x['comp']}", 1e6)
            # 3. padrões raros
            if x["tipo"] and x["tipo"].lower() != "apurada":
                alerta("urna_tipo", k, t, f"tipo de urna: {x['tipo']}", x["comp"])
            if x["aptos"] >= 50 and x["comp"] == x["aptos"]:
                alerta("comp_100", k, t, f"todos os {x['aptos']} aptos votaram", x["aptos"])
            vv = validos(x)
            if t == "t2" and vv >= 50 and (x["v"].get(A, 0) == vv or x["v"].get(B, 0) == vv):
                quem = "Lula" if x["v"].get(A, 0) == vv else "Flávio Bolsonaro"
                alerta("unanime", k, t, f"todos os {vv} votos válidos para {quem}", vv)
            if x["comp"] >= 30:
                p = x["nh"] / x["comp"]
                if p >= 0.30:
                    alerta("nh_alto", k, t, f"{x['nh']} de {x['comp']} ({p:.0%}) liberados sem digital", p * 1000 + x["nh"] / 1000)
            hab = x["ab"][:2]
            hen = x["enc"][:2]
            if hab and (hab < "06" or hab > "10"):
                alerta("horario", k, t, f"abertura às {x['ab']}", 1)
            if hen and (hen < "16" or hen >= "20"):
                alerta("horario", k, t, f"encerramento às {x['enc']}", 1)

    for t in ("t1", "t2"):
        for u, ks in urnas[t].items():
            if len(ks) > 1:
                k = ks[0]
                alerta("urna_repetida", k, t, f"urna {u} aparece em {len(ks)} seções: " + ", ".join(f"{a}/{b}/{c}/{d}" for a, b, c, d in ks[:5]), len(ks))
    for k, s in sec.items():
        if len(s) == 1:
            t = next(iter(s))
            alerta("so_um_turno", k, t, f"seção só aparece no {t[1]}º turno", s[t]["comp"])

    # 1. liberação sem digital x voto
    efeitos = {}
    for t in ("t1", "t2"):
        pares = []
        for k, s in sec.items():
            x = s.get(t)
            if not x or x["comp"] < 30:
                continue
            vv = validos(x)
            if not vv:
                continue
            pares.append(((k[0], k[1]), x["nh"] / x["comp"], x["v"].get(A, 0) / vv, x["comp"]))
        b, n = inclinacao(pares)
        xs = [p[1] for p in pares]
        ys = [p[2] for p in pares]
        efeitos[t] = {"inclinacao_mesma_cidade": b, "secoes": n, "corr_bruta": corr(xs, ys)}
    # mesma seção, 1º -> 2º turno: a variação da liberação sem digital anda junto com a variação de Lula?
    dx, dy, pares = [], [], []
    for k, s in sec.items():
        if "t1" in s and "t2" in s and s["t1"]["comp"] >= 30 and s["t2"]["comp"] >= 30:
            v1, v2 = validos(s["t1"]), validos(s["t2"])
            if not (v1 and v2):
                continue
            x = s["t2"]["nh"] / s["t2"]["comp"] - s["t1"]["nh"] / s["t1"]["comp"]
            y = s["t2"]["v"].get(A, 0) / v2 - s["t1"]["v"].get(A, 0) / v1
            dx.append(x)
            dy.append(y)
            pares.append(((k[0], k[1]), x, y, s["t2"]["comp"]))
    b, n = inclinacao(pares)
    efeitos["variacao"] = {"inclinacao_mesma_cidade": b, "secoes": n, "corr_bruta": corr(dx, dy)}

    # faixas de liberação sem digital (2º turno): resultado de Lula em cada faixa
    faixas = []
    for lo, hi in ((0, .02), (.02, .05), (.05, .10), (.10, .20), (.20, .30), (.30, 1.01)):
        f = defaultdict(int)
        for s in sec.values():
            x = s.get("t2")
            if x and x["comp"] >= 30 and lo <= x["nh"] / x["comp"] < hi:
                f["secoes"] += 1
                f["comp"] += x["comp"]
                f["nh"] += x["nh"]
                f["A"] += x["v"].get(A, 0)
                f["vv"] += validos(x)
        faixas.append({"de": lo, "ate": min(hi, 1), **f})

    def resumo(a):
        return {k: v for k, v in a.items() if k != "nm"}

    saida = {
        "total": {t: resumo(tot[t]) for t in tot},
        "uf": {u: {t: resumo(v[t]) for t in v} for u, v in sorted(uf.items())},
        "mun": {f"{u}-{m}": [v["t1"].get("nm", v["t2"].get("nm"))] + [v[t].get(c, 0) for t in ("t1", "t2") for c in ("secoes", "aptos", "comp", "nh", "A", "B", "vv")]
                for (u, m), v in mun.items()},
        "efeitos": efeitos,
        "faixas_nh": faixas,
        "tipos_urna": {t: dict(tipos[t]) for t in tipos},
        "horarios": {t: {f"{a}-{h}": n for (a, h), n in sorted(horas[t].items())} for t in horas},
        "alertas_total": {k: len(v) for k, v in alertas.items()},
        "alertas": {k: sorted(v, key=lambda a: -a["peso"])[:LIM] for k, v in alertas.items()},
    }
    os.makedirs(os.path.join(ROOT, "web", "dados"), exist_ok=True)
    with open(os.path.join(ROOT, "web", "dados", "bu.json"), "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(BU, "alertas.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["tipo", "turno", "uf", "cod_municipio", "municipio", "zona", "secao", "aptos", "comparecimento", "detalhe"])
        for tipo, lst in sorted(alertas.items()):
            for a in sorted(lst, key=lambda a: -a["peso"]):
                w.writerow([tipo, a["turno"], a["uf"], a["mun"], a["nm"], a["zona"], a["secao"], a["aptos"], a["comp"], a["detalhe"]])

    for t in ("t1", "t2"):
        x = tot[t]
        print(f"{t}: {x['secoes']} seções, aptos {x['aptos']}, comp {x['comp']}, sem digital {x['nh']} ({x['nh'] / max(1, x['comp']):.2%})")
    print("efeitos:", json.dumps(efeitos))
    print("faixas:", json.dumps(faixas))
    print("tipos de urna:", json.dumps(saida["tipos_urna"], ensure_ascii=False))
    print("alertas:", json.dumps(saida["alertas_total"]))


if __name__ == "__main__":
    main()
