# Presidente 2026 em Dados

Painel com os resultados oficiais da eleição para Presidente de 2026, no 1º e no
2º turno, para o Brasil, cada região, cada estado e cada um dos municípios
(inclusive as cidades do exterior). Feito para ser lido por qualquer pessoa.

## O que dá para fazer

- **Resultado** de qualquer local: votos e percentual de cada candidato,
  eleitorado, comparecimento, abstenção, brancos e nulos.
- **Mapa por município**, com vencedor e margem, percentual de cada candidato,
  abstenção, brancos e nulos. Clique em uma cidade para abri-la.
- **Comparar turnos**: quanto cada finalista cresceu, onde a abstenção subiu,
  e onde o líder do 1º turno perdeu o 2º (viradas).
- **Para onde foi cada eleitor**: a conta completa entre os turnos — votos dos
  eliminados, brancos e nulos, abstenção e o ganho de cada finalista.
- **Municípios fora do padrão**: uma estimativa, feita com o 1º turno de cada
  cidade, de quanto cada finalista deveria ter no 2º turno; a lista mostra onde o
  resultado real ficou mais longe disso. Fora do padrão não quer dizer fraude:
  é um ponto de partida para investigar.
- **Tabela completa**, ordenável e com busca.

## Como abrir

O painel é estático. Basta servir a pasta `web/`:

```sh
python3 -m http.server -d web 8000
# abra http://localhost:8000
```

Também funciona no GitHub Pages apontando para a pasta `web/`.

## De onde vêm os dados

| Arquivo | Origem |
|---|---|
| `data/presidente_2026.json` | Resultados por município, UF e Brasil, dos dois turnos, baixados de `resultados.tse.jus.br` (a API pública do site e do aplicativo oficial do TSE). |
| `data/raw/` | Arquivos de configuração do TSE (lista de eleições e de municípios) e exemplos dos arquivos brutos. |
| `data/geo/` | Malhas municipais e estaduais do IBGE (`servicodados.ibge.gov.br`). |
| `web/dados/` | Versões compactas para o painel, geradas por `scripts/build_web.py`. |

O script `scripts/build_web.py` confere se a soma dos municípios bate com o total
oficial do Brasil e de cada UF e mostra qualquer diferença no log.

## Atualizar

O workflow **Atualizar dados do TSE** (`.github/workflows/dados.yml`) baixa tudo
de novo e grava no repositório. Rode pela aba *Actions* (botão *Run workflow*),
ou localmente:

```sh
python3 scripts/fetch_tse.py --ano 2026   # resultados do TSE
python3 scripts/build_web.py 2026         # arquivos do painel
```

Os códigos das eleições (6257 e 6258 em 2026) são descobertos automaticamente no
arquivo de configuração do TSE; para outra eleição use `--t1` e `--t2`.
