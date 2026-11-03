#!/usr/bin/env python3
"""Baixa os boletins de urna (BU) de Presidente, seção por seção, dos dados abertos do TSE.

Fonte: Portal de Dados Abertos do TSE (dadosabertos.tse.jus.br), conjunto
"Resultados <ano> - Boletim de Urna", arquivos bweb_<turno>t_<UF>_*.zip.
Cada linha do CSV é um votável numa seção; aqui só o cargo Presidente.

Para cada seção guardamos: eleitores aptos, comparecimento, abstenções,
eleitores liberados sem a digital (QT_ELEITORES_BIOMETRIA_NH: tinham biometria,
mas foram habilitados por outro meio, como o ano de nascimento), tipo de urna,
horários de abertura e encerramento e votos de cada candidato, branco e nulo.

Saída: data/bu/secoes_<turno>_<UF>.csv.gz (uma linha por seção) e
       data/bu/colunas.txt (cabeçalho original, para conferência).

Uso: python3 scripts/fetch_bu.py [--ano 2026] [--ufs AC,AL] [--turnos 1,2]
Somente biblioteca padrão do Python.
"""
import argparse
import csv
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "bu")
CKAN = "https://dadosabertos.tse.jus.br/api/3/action"
UA = "Mozilla/5.0 (painel-eleicoes; dados abertos TSE)"
UFS = ("AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO ZZ").split()


def baixar(url, destino=None, tries=6):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=300) as r:
                if destino is None:
                    return r.read()
                with open(destino, "wb") as f:
                    while True:
                        b = r.read(1 << 20)
                        if not b:
                            break
                        f.write(b)
                return destino
        except Exception as e:  # rede instável: tenta de novo
            print(f"  tentativa {i + 1} falhou: {url}: {e}", flush=True)
            time.sleep(min(2 ** i * 5, 120))
    raise RuntimeError(f"falha ao baixar {url}")


def recursos(ano):
    """Lista os arquivos bweb do conjunto de BU no CKAN do TSE."""
    ids = [f"resultados-{ano}-boletim-de-urna", f"resultados-{ano}-boletim-de-urna-1", f"boletim-de-urna-{ano}"]
    pacote = None
    for pid in ids:
        try:
            pacote = json.loads(baixar(f"{CKAN}/package_show?id={pid}", tries=2))["result"]
            break
        except Exception:
            continue
    if pacote is None:
        busca = json.loads(baixar(f"{CKAN}/package_search?q=boletim%20de%20urna%20{ano}&rows=20"))["result"]["results"]
        for p in busca:
            print("  conjunto encontrado:", p["name"], "-", p.get("title"), flush=True)
        busca = [p for p in busca if str(ano) in p["name"] and "boletim" in p["name"]]
        if not busca:
            sys.exit("não achei o conjunto de boletins de urna no portal de dados abertos")
        pacote = busca[0]
    print("conjunto:", pacote["name"], "-", pacote.get("title"), flush=True)
    out = []
    for r in pacote["resources"]:
        url = r.get("url", "")
        m = re.search(r"bweb_(\d)t_([A-Z]{2})_", url)
        print("  recurso:", r.get("name"), url, flush=True)
        if m:
            out.append((m.group(1), m.group(2), url))
    return out


def hora(s):
    m = re.search(r"(\d{2}):(\d{2})(?::(\d{2}))?", s or "")
    return f"{m.group(1)}:{m.group(2)}" if m else ""


def processar(turno, uf, url):
    tmp = os.path.join(OUT, f"_tmp_{turno}_{uf}.zip")
    t0 = time.time()
    baixar(url, tmp)
    secoes = {}
    with zipfile.ZipFile(tmp) as z:
        nomes = [n for n in z.namelist() if n.lower().endswith(".csv")]
        for nome in nomes:
            with z.open(nome) as fb:
                rd = csv.reader(io.TextIOWrapper(fb, encoding="latin-1", newline=""), delimiter=";")
                cab = next(rd)
                ix = {c: i for i, c in enumerate(cab)}
                with open(os.path.join(OUT, "colunas.txt"), "w", encoding="utf-8") as f:
                    f.write(";".join(cab) + "\n")
                g = lambda row, c: row[ix[c]] if c in ix else ""
                for row in rd:
                    if g(row, "CD_CARGO_PERGUNTA") not in ("1", "0001"):
                        continue
                    k = (g(row, "CD_MUNICIPIO"), g(row, "NR_ZONA"), g(row, "NR_SECAO"))
                    s = secoes.get(k)
                    if s is None:
                        s = secoes[k] = {
                            "mun": g(row, "CD_MUNICIPIO"), "nm": g(row, "NM_MUNICIPIO"),
                            "zona": g(row, "NR_ZONA"), "secao": g(row, "NR_SECAO"),
                            "local": g(row, "NR_LOCAL_VOTACAO"),
                            "aptos": g(row, "QT_APTOS"), "comp": g(row, "QT_COMPARECIMENTO"),
                            "abst": g(row, "QT_ABSTENCOES"), "nh": g(row, "QT_ELEITORES_BIOMETRIA_NH"),
                            "tipo_urna": g(row, "DS_TIPO_URNA"), "urna": g(row, "NR_URNA_EFETIVADA"),
                            "abertura": hora(g(row, "DT_ABERTURA")), "encerr": hora(g(row, "DT_ENCERRAMENTO")),
                            "votos": {},
                        }
                    nr = g(row, "NR_VOTAVEL")
                    s["votos"][nr] = s["votos"].get(nr, 0) + int(g(row, "QT_VOTOS") or 0)
    os.remove(tmp)
    nums = sorted({n for s in secoes.values() for n in s["votos"]})
    campos = ["mun", "nm", "zona", "secao", "local", "aptos", "comp", "abst", "nh", "tipo_urna", "urna", "abertura", "encerr"]
    dst = os.path.join(OUT, f"secoes_{turno}_{uf}.csv.gz")
    with gzip.open(dst, "wt", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(campos + [f"v_{n}" for n in nums])
        for s in secoes.values():
            w.writerow([s[c] for c in campos] + [s["votos"].get(n, 0) for n in nums])
    print(f"  {turno}º turno {uf}: {len(secoes)} seções em {time.time() - t0:.0f}s -> {os.path.getsize(dst)} bytes", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ano", default="2026")
    ap.add_argument("--ufs", default=os.environ.get("UFS", ""))
    ap.add_argument("--turnos", default="1,2")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    ufs = set(a.ufs.split(",")) if a.ufs else set(UFS)
    turnos = set(a.turnos.split(","))
    lista = [(t, u, url) for t, u, url in recursos(a.ano) if t in turnos and u in ufs]
    print(f"{len(lista)} arquivos para processar", flush=True)
    falhas = []
    for t, u, url in sorted(lista, key=lambda x: (x[0], x[1])):
        try:
            processar(t, u, url)
        except Exception as e:
            print(f"  ERRO {t}º turno {u}: {e}", flush=True)
            falhas.append(f"{t}-{u}")
    if falhas:
        print("falharam:", ", ".join(falhas))


if __name__ == "__main__":
    main()
