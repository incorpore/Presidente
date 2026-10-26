#!/usr/bin/env python3
"""Gera os arquivos compactos usados pelo painel (web/dados/).

Entrada:  data/presidente_<ano>.json (scripts/fetch_tse.py)
Saída:    web/dados/painel.json  resultados por município, em colunas
(a malha do mapa, web/dados/mapa.json, sai de scripts/build_geo.py)

Também confere se a soma dos municípios bate com o total oficial do TSE
para o Brasil e para cada UF, e imprime qualquer diferença.
Somente biblioteca padrão do Python.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANO = sys.argv[1] if len(sys.argv) > 1 else "2026"
OUT = os.path.join(ROOT, "web", "dados")

UF_NOME = {
    "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas", "BA": "Bahia", "CE": "Ceará",
    "DF": "Distrito Federal", "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão",
    "MT": "Mato Grosso", "MS": "Mato Grosso do Sul", "MG": "Minas Gerais", "PA": "Pará",
    "PB": "Paraíba", "PR": "Paraná", "PE": "Pernambuco", "PI": "Piauí", "RJ": "Rio de Janeiro",
    "RN": "Rio Grande do Norte", "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima",
    "SC": "Santa Catarina", "SP": "São Paulo", "SE": "Sergipe", "TO": "Tocantins", "ZZ": "Exterior",
}
CAMPOS = ("e", "c", "a", "vb", "vn", "vv")


def main():
    with open(os.path.join(ROOT, "data", f"presidente_{ANO}.json"), encoding="utf-8") as f:
        d = json.load(f)
    turnos = [t for t in ("t1", "t2") if t in d["candidatos"]]

    # candidatos em ordem de votos no 1º turno
    t1c = sorted(d["candidatos"]["t1"], key=lambda c: -c["v"])
    cand = [{"n": c["n"], "nm": c["nm"], "cc": c.get("cc"), "v1": c["v"]} for c in t1c]
    fin = []
    if "t2" in turnos:
        fin = [c["n"] for c in sorted(d["candidatos"]["t2"], key=lambda c: -c["v"])]
        for c in cand:
            c2 = next((x for x in d["candidatos"]["t2"] if x["n"] == c["n"]), None)
            if c2:
                c["v2"] = c2["v"]
                c["e"] = c2.get("e")
    nums = [c["n"] for c in cand]

    cols = ["uf", "nm", "ibge", "cap"]
    for t in turnos:
        cols += [f"{k}{t[1]}" for k in CAMPOS]
        cols += [f"v{t[1]}_{n}" for n in (nums if t == "t1" else fin)]
    rows = []
    sem = {t: 0 for t in turnos}
    for m in d["municipios"]:
        r = [m["uf"], m["nm"], m.get("ibge") or "", 1 if m.get("cap") else 0]
        for t in turnos:
            tt = m.get(t)
            if not tt:
                sem[t] += 1
                r += [None] * (len(CAMPOS) + len(nums if t == "t1" else fin))
                continue
            r += [tt.get(k, 0) for k in CAMPOS]
            r += [tt["cand"].get(n, 0) for n in (nums if t == "t1" else fin)]
        rows.append(r)

    # conferência: soma dos municípios x totais oficiais
    print("municípios:", len(rows), "sem dados:", sem)
    ix = {c: i for i, c in enumerate(cols)}
    difs = []
    for t in turnos:
        tot = d["totais"][t]
        for alvo in ["BR"] + sorted(k for k in tot if k != "BR"):
            sel = rows if alvo == "BR" else [r for r in rows if r[0] == alvo]
            for k in CAMPOS:
                s = sum(r[ix[f"{k}{t[1]}"]] or 0 for r in sel)
                o = tot[alvo].get(k, 0)
                if s != o:
                    print(f"  diferença {t} {alvo} {k}: municípios={s} oficial={o}")
                    difs.append({"t": t, "local": alvo, "campo": k, "soma": s, "oficial": o})
        print(f"  {t}: conferência concluída")

    totais = {t: {uf: {k: v for k, v in x.items() if k in CAMPOS or k == "cand"}
                  for uf, x in d["totais"][t].items()} for t in turnos}
    painel = {"meta": d["meta"], "cand": cand, "fin": fin, "uf": UF_NOME,
              "totais": totais, "conferencia": difs, "cols": cols, "rows": rows}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "painel.json"), "w", encoding="utf-8") as f:
        json.dump(painel, f, ensure_ascii=False, separators=(",", ":"))

    for n in os.listdir(OUT):
        print(n, os.path.getsize(os.path.join(OUT, n)), "bytes")


if __name__ == "__main__":
    main()
