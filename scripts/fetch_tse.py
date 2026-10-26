#!/usr/bin/env python3
"""Baixa os resultados oficiais de Presidente (1º e 2º turno) do TSE.

Fonte: API pública de divulgação de resultados do TSE
(https://resultados.tse.jus.br/oficial/...), a mesma usada pelo app
"Resultados" e pelo site oficial. Coleta os totais de cada município
(inclusive os do exterior) e grava um JSON compacto em data/.

Uso:
    python3 scripts/fetch_tse.py [--ano 2026] [--t1 CODIGO] [--t2 CODIGO]

Sem --t1/--t2, os códigos das eleições são descobertos automaticamente
no arquivo de configuração público do TSE (ele-c.json).
Somente biblioteca padrão do Python.
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://resultados.tse.jus.br/oficial"
CARGO = "0001"  # Presidente
UA = "Mozilla/5.0 (painel-eleicoes; dados abertos TSE)"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")

REGIAO = {
    "AC": "Norte", "AP": "Norte", "AM": "Norte", "PA": "Norte", "RO": "Norte", "RR": "Norte", "TO": "Norte",
    "AL": "Nordeste", "BA": "Nordeste", "CE": "Nordeste", "MA": "Nordeste", "PB": "Nordeste",
    "PE": "Nordeste", "PI": "Nordeste", "RN": "Nordeste", "SE": "Nordeste",
    "DF": "Centro-Oeste", "GO": "Centro-Oeste", "MT": "Centro-Oeste", "MS": "Centro-Oeste",
    "ES": "Sudeste", "MG": "Sudeste", "RJ": "Sudeste", "SP": "Sudeste",
    "PR": "Sul", "RS": "Sul", "SC": "Sul",
    "ZZ": "Exterior",
}


def get_json(url, tries=6):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                raise
        except Exception as e:  # rede instável: tenta de novo
            last = e
        time.sleep(min(2 ** i, 30))
    raise RuntimeError(f"falha ao baixar {url}: {last}")


def save_raw(name, obj):
    os.makedirs(RAW, exist_ok=True)
    with open(os.path.join(RAW, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def to_int(v):
    if v in (None, ""):
        return 0
    return int(str(v).replace(".", "").split(",")[0])


def discover(ano):
    """Procura no ele-c.json as eleições do ano que têm o cargo Presidente (1º e 2º turno)."""
    cfg = get_json(f"{BASE}/comum/config/ele-c.json")
    save_raw("ele-c.json", cfg)
    t1 = t2 = None
    for pl in cfg.get("pl", []):
        if pl.get("c") != f"ele{ano}":
            continue
        for e in pl.get("e", []):
            cargos = {int(cp.get("cd", 0)) for a in e.get("abr", []) for cp in a.get("cp", [])}
            if int(CARGO) not in cargos:
                continue
            if str(e.get("t")) == "1" and t1 is None:
                t1 = (e["cd"], pl.get("dt"))
            elif str(e.get("t")) == "2" and t2 is None:
                t2 = (e["cd"], pl.get("dt"))
    return t1, t2


def fetch_turno(ano, cd):
    e6 = str(cd).zfill(6)
    mun_cfg = get_json(f"{BASE}/ele{ano}/{cd}/config/mun-e{e6}-cm.json")
    save_raw(f"mun-e{e6}-cm.json", mun_cfg)

    jobs = []
    for abr in mun_cfg["abr"]:
        uf = abr["cd"].lower()
        for m in abr.get("mu", []):
            jobs.append((uf, m))

    def one(job):
        uf, m = job
        url = f"{BASE}/ele{ano}/{cd}/dados-simplificados/{uf}/{uf}{m['cd']}-c{CARGO}-e{e6}-r.json"
        try:
            return job, get_json(url)
        except urllib.error.HTTPError as e:
            return job, {"_erro": e.code}

    out = []
    with cf.ThreadPoolExecutor(max_workers=int(os.environ.get("WORKERS", "24"))) as ex:
        for k, (job, data) in enumerate(ex.map(one, jobs), 1):
            out.append((job, data))
            if k % 500 == 0:
                print(f"  e{e6}: {k}/{len(jobs)} municípios", flush=True)

    br = get_json(f"{BASE}/ele{ano}/{cd}/dados-simplificados/br/br-c{CARGO}-e{e6}-r.json")
    save_raw(f"br-c{CARGO}-e{e6}-r.json", br)
    ufs = {}
    for abr in mun_cfg["abr"]:
        uf = abr["cd"].lower()
        try:
            ufs[uf.upper()] = get_json(f"{BASE}/ele{ano}/{cd}/dados-simplificados/{uf}/{uf}-c{CARGO}-e{e6}-r.json")
        except urllib.error.HTTPError:
            pass
    if out:
        save_raw(f"exemplo-municipio-e{e6}.json", out[0][1])
    return out, br, ufs


def resumo(r):
    """Campos agregados de um arquivo -r.json do TSE."""
    return {
        "e": to_int(r.get("e")),      # eleitorado apto
        "c": to_int(r.get("c")),      # comparecimento
        "a": to_int(r.get("a")),      # abstenções
        "vv": to_int(r.get("vv") or r.get("vvc")),  # votos válidos
        "vb": to_int(r.get("vb")),    # brancos
        "vn": to_int(r.get("tvn") or r.get("vn")),  # nulos (total)
        "s": to_int(r.get("s")),      # seções
        "st": to_int(r.get("st")),    # seções totalizadas
        "md": r.get("md"),            # status de divulgação
        "dg": r.get("dg"), "hg": r.get("hg"),  # data/hora da totalização
    }


def candidatos(r):
    out = []
    for c in r.get("cand", []):
        out.append({
            "n": c.get("n"), "nm": c.get("nm"), "cc": c.get("cc"),
            "e": c.get("e"), "st": c.get("st"), "v": to_int(c.get("vap")),
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ano", default=os.environ.get("ANO", "2026"))
    ap.add_argument("--t1", default=os.environ.get("ELEICAO_T1"))
    ap.add_argument("--t2", default=os.environ.get("ELEICAO_T2"))
    args = ap.parse_args()

    t1 = (args.t1, None) if args.t1 else None
    t2 = (args.t2, None) if args.t2 else None
    if not (t1 and t2):
        d1, d2 = discover(args.ano)
        t1, t2 = t1 or d1, t2 or d2
    print("eleições:", t1, t2, flush=True)
    if not t1:
        sys.exit("não encontrei o código da eleição do 1º turno; veja data/raw/ele-c.json e use --t1")

    turnos = {"t1": t1}
    if t2:
        turnos["t2"] = t2

    meta = {
        "ano": int(args.ano),
        "gerado": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "fonte": f"{BASE}/ele{args.ano}/",
        "turnos": {},
    }
    cands, totais, municipios = {}, {}, {}
    for tk, (cd, data) in turnos.items():
        print(f"baixando {tk} (eleição {cd})", flush=True)
        rows, br, ufs = fetch_turno(args.ano, cd)
        meta["turnos"][tk] = {"eleicao": cd, "data": data, **{k: br.get(k) for k in ("dg", "hg", "md")}}
        cands[tk] = candidatos(br)
        totais[tk] = {"BR": resumo(br) | {"cand": {c["n"]: c["v"] for c in candidatos(br)}}}
        for uf, r in ufs.items():
            totais[tk][uf] = resumo(r) | {"cand": {c["n"]: c["v"] for c in candidatos(r)}}
        erros = 0
        for (uf, m), r in rows:
            key = uf.upper() + m["cd"]
            mun = municipios.setdefault(key, {
                "uf": uf.upper(), "tse": m["cd"], "ibge": m.get("cdi"), "nm": m.get("nm"),
                "cap": m.get("c") == "S", "rg": REGIAO.get(uf.upper(), "?"),
            })
            if "_erro" in r:
                erros += 1
                continue
            mun[tk] = resumo(r) | {"cand": {c["n"]: c["v"] for c in candidatos(r)}}
        print(f"  {tk}: {len(rows)} municípios, {erros} sem dados", flush=True)

    out = {"meta": meta, "candidatos": cands, "totais": totais,
           "municipios": sorted(municipios.values(), key=lambda m: (m["uf"], m["nm"] or ""))}
    path = os.path.join(ROOT, "data", f"presidente_{args.ano}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("gravado", path, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    main()
