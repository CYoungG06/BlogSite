---
name: alphaxiv-paper-lookup
description: Look up any arxiv paper on alphaxiv.org to get a structured AI-generated overview. This is faster and more reliable than trying to read a raw PDF.
---

# AlphaXiv Paper Lookup

Look up any arxiv paper on alphaxiv.org to get a structured AI-generated overview. This is faster and more reliable than trying to read a raw PDF.

## When to Use

- User shares an arxiv URL (e.g. `arxiv.org/abs/2401.12345`)
- User mentions a paper ID (e.g. `2401.12345`)
- User asks you to explain, summarize, or analyze a research paper
- User shares an alphaxiv URL (e.g. `alphaxiv.org/overview/2401.12345`)

## Workflow

### Step 1: Extract the paper ID

Parse the paper ID from whatever the user provides:

| Input                                      | Paper ID       |
| ------------------------------------------ | -------------- |
| `https://arxiv.org/abs/2401.12345`         | `2401.12345`   |
| `https://arxiv.org/pdf/2401.12345`         | `2401.12345`   |
| `https://alphaxiv.org/overview/2401.12345` | `2401.12345`   |
| `2401.12345v2`                             | `2401.12345v2` |
| `2401.12345`                               | `2401.12345`   |

### Step 2: Fetch the machine-readable report

```bash
curl -sL "https://alphaxiv.org/overview/{PAPER_ID}.md"
```

**必须加 `-L`**:该端点会 301 重定向,不加 `-L` 拿到的只是重定向 HTML 而不是报告。

This returns the intermediate machine-readable report — a structured, detailed analysis of the paper optimized for LLM consumption. One call, plain markdown, no JSON parsing.

报告固定六节结构:Authors and Institution(s) / Broader Research Landscape / Key Objectives and Motivation / Methodology and Approach / Main Findings and Results / Significance and Potential Impact,约 16–20KB。时效很好,当天上榜的新论文一般已有报告。

If this returns 404, the report hasn't been generated for this paper yet.

### Step 3: If you need more detail, fetch the full paper text

If the report doesn't contain the specific information the user is asking about (e.g. a particular equation, table, or section), fetch the full paper text:

```bash
curl -sL "https://alphaxiv.org/abs/{PAPER_ID}.md"
```

This returns the full extracted text of the paper as markdown. Only use this as a fallback — the report is usually sufficient.

If this returns 404, the full text hasn't been processed yet. As a last resort, direct the user to the PDF at `https://arxiv.org/pdf/{PAPER_ID}`.

## Error Handling

- **301**: 必须 `curl -L` 跟随重定向。
- **404 on Step 2**: Report not generated for this paper yet.
- **404 on Step 3**: Full text not yet extracted for this paper.

## Notes

- No authentication required — these are public endpoints.
- 报告是英文 AI 体、不含图;用作解读文章素材时要核对关键数字(偶有转述误差),
  图片需另从 arXiv HTML/PDF 获取,正文应重写而非照译。
