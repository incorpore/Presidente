#!/usr/bin/env python3
"""Diagnóstico: testa os formatos de arquivo da API de resultados do TSE.

Para uma eleição, tenta vários nomes de arquivo conhecidos (Brasil, uma UF e
um município) e grava em data/raw/probe/ o que respondeu, para conferirmos o
layout. Uso: python3 scripts/probe_tse.py 6257 6258
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = "https://resultados.tse.jus.br/oficial/ele2026"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "raw", "probe")
os.makedirs(OUT, exist_ok=True)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception as e:
        return str(e), b""


for cd in sys.argv[1:]:
    e6 = cd.zfill(6)
    alvos = []
    for pasta in ("dados-simplificados", "dados"):
        for abr in ("br", "sp", "sp71072", "ac01120"):
            uf = abr[:2]
            for cargo in ("c0001", "c1"):
                for suf in ("r", "v", "f", "u", "e", "ab", "t", "s"):
                    alvos.append(f"{BASE}/{cd}/{pasta}/{uf}/{abr}-{cargo}-e{e6}-{suf}.json")
    alvos.append(f"{BASE}/{cd}/config/{e6}-cs.json")
    for u in alvos:
        st, body = get(u)
        if st == 200:
            nome = u.split(f"/{cd}/")[1].replace("/", "__")
            with open(os.path.join(OUT, nome), "wb") as f:
                f.write(body)
            print("OK ", len(body), u, flush=True)
        else:
            print(st, u, flush=True)
