# arXiv query syntax and category cheat sheet

Read this when crafting precise arXiv queries (anything beyond plain keywords).

## Field prefixes

| Prefix | Searches | Example |
|---|---|---|
| `ti:` | title | `ti:"attention is all you need"` |
| `au:` | author | `au:"lecun"` or `au:lecun_y` |
| `abs:` | abstract | `abs:"chain-of-thought"` |
| `co:` | comment | `co:"NeurIPS 2025"` |
| `cat:` | category | `cat:cs.CL` |
| `all:` | all fields (default) | `all:transformer` |
| `submittedDate:` | date range | `submittedDate:[20260101000000 TO 20260201000000]` |

- Boolean: `AND`, `OR`, `ANDNOT` (uppercase), group with parentheses.
- Phrases: wrap in double quotes. Without quotes each term is matched separately.
- A query string passed to `search.py` that contains a `:` is sent verbatim; otherwise each whitespace-separated term becomes an `all:` term ANDed together.

## Category cheat sheet (ML/AI focus)

| Category | Area |
|---|---|
| cs.CL | NLP / LLMs |
| cs.LG | machine learning (general) |
| cs.AI | artificial intelligence (general) |
| cs.CV | computer vision |
| cs.MA | multi-agent systems |
| cs.RO | robotics |
| cs.IR | information retrieval |
| cs.SE | software engineering (coding agents) |
| cs.HC | human-computer interaction |
| stat.ML | statistics ML theory |
| cs.CR | security/privacy |
| eess.AS | speech/audio |

Full list: https://arxiv.org/category_taxonomy

## Useful patterns

- New papers in categories, last N days: `daily.py --categories cs.CL,cs.LG --days N` (sorts newest-first and filters by published date client-side — the API's `submittedDate:` range syntax is unreliable, see apis.md).
- Author's recent work: `search.py --author "Firstname Lastname" --sort-by submittedDate`.
- Title search for a paper you half-remember: `search.py 'ti:"distinctive phrase"'`.
- Exclude a noisy term: `search.py 'all:diffusion ANDNOT all:image'` (verbatim syntax).
