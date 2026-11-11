# 三条链路运行层验证（真实 vault 数据）

> 任务：DSH-20261112-08 · 脚本：`scripts/verify-three-flows.mjs` · 生成方式：脚本输出原样粘贴（未手写改写）
> 判定口径：镜像 `shared/link-status-compute.ts` 的三条 `compute*FlowStatus`（.mjs 不能 import TS，故按行镜像，函数上方标 `@mirror`）。

## 一、结论

| 链路 | 结论 | 依据 |
| --- | --- | --- |
| 知识流（拆解→向量化→嵌入→检索→归因） | **无法验证** | 知识库索引 0 本（`写作知识库/知识库索引.md`），无真实书籍可判定；向量库另有 1 本孤儿数据 |
| 风格流（指纹库→启用→强度→注入） | **无法验证** | 三层指纹文件全部不存在（模板/全局/项目均 0 枚），无指纹可判定 |
| 约束流（考据→设定→审核→绑定→注入） | **无法验证** | vault 内没有任何 `.project`（脚本深度 6 扫描 0 命中），没有项目可验证 |

- 脚本退出码 **2**（无断点，但至少一条链路无法判定）；没有把「没数据」写成「已通过」。
- 唯一被真实探测证实的环节：本机 Ollama 可用且已安装 `bge-m3`（`GET http://localhost:11434/api/tags`）。

## 二、脚本真实输出

```text
三条链路运行层验证 · 2026/11/12 01:56:47（UTC: 2026-11-11T17:56:47.192Z）
vault: D:/小说工坊/小说工坊
项目: （无）（选择方式: none）
说明: 没有可用项目（vault 内找不到 .project）
设置: 向量提供方=ollama 模型=bge-m3 主 API=未配置 向量 Key=未配置
嵌入探测: Ollama 可用，已安装 bge-m3:latest

【知识流】无法验证（缺数据/缺模型）
  ❔ 拆解：知识库为空
  ❔ 向量化：等待拆解完成
  ✅ 嵌入模型：Ollama 可用，已安装 bge-m3:latest
  ✅ 检索：向量库已加载 1 本
  ❔ 归因：写作后可在统计页核对 rag_sources
  结论：环节状态由空输入推导，不能当作「已验证」或「已确认断点」

【风格流】无法验证（缺数据/缺模型）
  ❔ 指纹库：还没有指纹
  ❔ 启用：等待创建指纹
  ❔ 强度：等待启用指纹
  ❔ 注入：等待启用指纹
  结论：环节状态由空输入推导，不能当作「已验证」或「已确认断点」

【约束流】无法验证（缺数据/缺模型）
  ⚠️ 考据：没有官方来源，设定只能写「待核实」
  ❌ 设定：还没有同人设定文件
  ❔ 审核：没有可审核的设定
  ❔ 绑定：等待设定文件
  ❔ 注入：等待绑定
  结论：环节状态由空输入推导，不能当作「已验证」或「已确认断点」

⚠️ 一致性问题：向量库有 1 本不在知识库索引里（kb_mrgel8mq_niign00x）

退出码: 2（0=三条全通 / 1=有断点或降级 / 2=无法判定）
```

## 三、可验证 / 无法验证 划分

| 类别 | 内容 |
| --- | --- |
| 已验证 | 嵌入服务可用性（Ollama HTTP 探测 + 模型清单命中 `bge-m3`）；向量库索引文件存在且含 1 本记录；知识库索引可解析（frontmatter JSON，books=[]）；插件设置为 ollama + `bge-m3` |
| 无法验证（缺数据） | 知识流拆解/向量化/归因；风格流四个环节；约束流五个环节 |
| 无法验证（缺模型） | 云提供方路径未走（本机用 ollama，无需 Key）；主 API 未配置，AI 生成链路本身不在本脚本验证范围 |
| 不一致（新增发现） | 知识库索引 0 本 但 向量库索引有 1 本 `kb_mrgel8mq_niign00x` → 孤儿向量 |

## 四、数据来源（逐个可复核）

| 判定项 | 读取路径 | 实测值 |
| --- | --- | --- |
| 书籍总数 / 拆解 / 向量状态 | `写作知识库/知识库索引.md`（frontmatter JSON） | `books: []` |
| 向量库书目 | `.obsidian/plugins/novel-writer-ai/data/knowledge-vectors/index.json` | `books: [{ bookId: kb_mrgel8mq_niign00x, bookName: 将夜, sampleCount: 26 }]` |
| 三层指纹 | `元文件/04-项目总控/fingerprint-library/template-fingerprints.json`、`data/fingerprint-library/global-fingerprints.json`、`<项目>/元文件/04-项目总控/fingerprint-library/project-fingerprints.json` | 三个文件均不存在 |
| 强度配置 | `<项目>/元文件/04-项目总控/fingerprint-library/fingerprint-intensity-config.json` | 无项目 → 不存在 |
| 项目清单 | 递归找 `.project`（深度 ≤6，跳过 node_modules/.trash/.rollback-backup 等） | 0 个 |
| 插件设置（非敏感） | `.obsidian/plugins/novel-writer-ai/data.json` | ollama / bge-m3 / 主 API 未配置 |
| 嵌入探测 | `GET http://localhost:11434/api/tags`（2.5s 超时） | 200，模型列表含 `bge-m3:latest` |

## 五、发现的问题（按影响排序）

1. **P2 · 孤儿向量 / 索引不一致**：`knowledge-vectors/index.json` 有 1 本，但知识库索引是空的。
   两种可能：(a) 用户清空/重建过知识库但向量库没跟着清；(b) 索引损坏后被 `rebuildIndexFromBooks` 重建为 0 本。
   影响：`knowledge-base-view` 的「检索」环节会显示「向量库已加载 1 本」，看起来链路是通的，但实际没有任何书可检索——正是本次任务要暴露的「假绿」。
   建议：单独开一轮（数据一致性）加「索引与向量库对账」提示，或在知识库打开时检测孤儿向量并给一键清理。
2. **P3 · 当前 vault 没有项目**：`.project` 0 个，三条链路的「项目级」数据（项目指纹、同人设定、绑定关系）全都无从验证。
   报告因此不能给出「风格/约束链路是否生效」的肯定结论；换到有项目的 vault 再跑本脚本即可补证。
3. **P3 · 主 API 未配置**：`data.json` 里 `apiKey` 为空 → AI 生成链路不可用（与三条数据链路无关，但会让「链路已通」产生误导）。

## 六、脚本自身逻辑自检（三态各跑一次）

用临时 fixture vault（`/tmp/nw-flow-fixture`，不落库）验证退出码语义：

| 场景 | 构造 | 实测退出码 |
| --- | --- | --- |
| 全通 | 2 本书均已拆解+向量化、向量库 2 本、三层指纹各就绪（强度 0.6）、同人设定 approved + 2 条考据来源 | **0** |
| 有断点 | 同上，但同人设定 `审核状态: pending` | **1**（断在「审核」） |
| 无法判定 | 真实 vault（本报告第二节） | **2** |

## 七、局限（不得据此下「链路正常」结论）

- 判定函数是**镜像**而非调用：`.mjs` 不能 import TS。语义变更必须同步 `shared/link-status-compute.ts`（函数上方有 `@mirror` 锚点）。
- 「归因」环节只能写作后核对 `rag_sources`，本脚本永远报 unknown（与 UI 一致）。
- Ollama 探测只证明「服务活着 + 模型已安装」，不证明向量维度匹配、不证明检索质量。
- 脚本没有 Obsidian 运行时，项目选择靠「最新 `.project`」或 `--project` 显式指定，不等价于界面的「当前活动文件所属项目」。

## 八、复现

```bash
cd .obsidian/plugins/novel-writer-ai
node scripts/verify-three-flows.mjs                 # 人类可读，默认会探测本机 Ollama
node scripts/verify-three-flows.mjs --json          # 机器可读
node scripts/verify-three-flows.mjs --no-probe      # 不探测（嵌入环节记 unknown）
node scripts/verify-three-flows.mjs --vault <path> --project <id>
```
