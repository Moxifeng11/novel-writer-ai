# 基准样章评估

用途：每次修改正文提示词/流程后，用同一批 good/bad 样章跑 WQE，回答“比之前更好吗”。

## 准备样章

在 `benchmarks/quality/samples.json` 放 3-5 个你认可的章节片段（good）和 3-5 个明显差的片段（bad）。不要用同一章的改写对，避免评分器只学到“改写痕迹”。

```json
{
  "minGap": 5,
  "maxMisclassified": 1,
  "samples": [
    { "id": "good-01", "label": "good", "genre": "仙侠", "text": "正文……" },
    { "id": "bad-01", "label": "bad", "genre": "仙侠", "text": "正文……" }
  ]
}
```

- `text` 至少 100 字（WQE 的最小可评估长度）。
- good/bad 各至少 3 条；样本不足时脚本会失败并提示。
- `minGap`：good 与 bad 均分的最小差值，默认 5。
- `maxMisclassified`：允许的误分类条数，默认样本数的 20%。

## 运行

```bash
npm run eval:quality
```

输出：

- 控制台：各维度 good/bad 均分与差值；
- `benchmarks/quality/last-report.json`：Vitest JSON 报告。

## 说明

- 评分器沿用现有 `WritingQualityEngine`，不新增第二套标准。
- 这是回归护栏，不是“绝对质量”证明；最终仍以人工 rubric（具体性/场景转折/人物声音/连续性/AI 味）为准。
- 没有 `samples.json` 时，日常 `npm test` 不受影响；`eval:quality` 会跳过并提示。
