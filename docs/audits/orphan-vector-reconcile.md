# 孤儿向量对账与清理（DSH-20261112-14）

> 缘起：-08 运行层验证发现「知识库索引 0 本，向量库 1 本」→ 界面「检索：已加载 1 本」的假绿（P2）。
> 本任务复现孤儿、实现索引 ↔ 向量库对账（默认只报告）、给显式清理入口（fail-closed），并修复 UI 假绿。

## 一、孤儿复现（真实 vault，两路取证）

**取证 1：verify-three-flows.mjs 输出（一致性行）**

```text
⚠️ 一致性问题：向量库有 1 本不在知识库索引里（kb_mrgel8mq_niign00x）
```

**取证 2：对账口径直读两侧数据（vault 根目录运行）**

```text
RECONCILE index=[] vectors=["kb_mrgel8mq_niign00x"]
RECONCILE orphans=["kb_mrgel8mq_niign00x"] missing=[] healthy=[]
```

结论：`data/knowledge-vectors/index.json` 含 1 本 `kb_mrgel8mq_niign00x`，
`写作知识库/知识库索引.md` 的 `books: []` 里没有它——孤儿确认，与 -08 报告一致。

## 二、实现（engine 层纯函数 + 可调用入口）

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| `reconcileVectorBooks(kbIds, vectorIds)` | `engine/knowledge-vector-reconcile.ts` | 纯函数：三类报告（孤儿/缺失/正常），去重保序，不碰文件系统 |
| `summarizeVectorReconcile(report)` | 同上 | 一句话摘要（孤儿→建议清理；缺失→建议重向量化）；无问题返回 null |
| `store.reconcileWithIndex(kbIds)` | `engine/knowledge-vector-store.ts` | 可调用入口：惰性 `ensureLoaded` 后对账，发现不一致打 warn 日志 |
| `store.removeOrphanVectors(ids, {confirmed})` | 同上 | **显式清理（fail-closed）**：`confirmed !== true` 时一个不删（全部计入 skipped）；只删「当前确实已加载」的指定 id；删除走 `removeBook`（写锁 + 落盘） |

## 三、UI 假绿修复

1. **知识库视图（书籍页签）**：`loadBooks` 异步预取对账 → `renderLinkStatus` 的
   `degradations` 注入「向量库 M 本不在知识库索引（孤儿向量，点「🔗 向量对账」可清理）」——
   链路状态整体从「已加载 N 本」的绿色降为 warn，孤儿数量与指引直接可见。
2. **工具栏新增「🔗 向量对账」按钮**：Notice 摘要（正常/缺失/孤儿三类计数）；
   存在孤儿时弹 `OperationConfirmModal`（confirmText「确认清理」/ cancelText「只报告，不清理」），
   用户明确确认才调 `removeOrphanVectors(..., { confirmed: true })`，清理后刷新列表。
3. **agent 诊断（flow-diagnosis-collectors）**：`collectKnowledge` 同样注入孤儿降级提示，
   界面看到的断点与 agent 诊断保持同一口径。

## 四、测试（13 例，`tests/unit/engine/knowledge-vector-reconcile.test.ts`）

纯函数 7 例：孤儿识别 / 缺失识别 / 正常不计 / **-08 真实场景复现（索引 0 本 + 向量库 1 本 → 全孤儿）** /
两侧全空 / 重复 id 去重保序与空串忽略 / summarize 三态。

store 层 6 例（obsidian Vault mock + 真实 KnowledgeVectorStore）：
对账列出孤儿与正常 / **未确认（confirmed 缺省）一个不删** / **confirmed:false 一个不删（fail-closed）** /
**confirmed:true 只删指定 bookId 且重启后（新实例读盘）确实消失** / 未加载 id 计入 skipped 不误删 /
批量清理混合场景只动已加载项。

运行结果：**13 passed**（`npx vitest run tests/unit/engine/knowledge-vector-reconcile.test.ts`）。

## 五、设计约束的落实（对应任务 NOTE）

- **默认只报告**：对账只产出报告与 warn 日志；唯一的删除入口在确认弹窗之后。
- **孤儿可能是「临时移走书目录」**：报告文案明示这一可能性，清理确认框二次说明后果
  （清理后如需检索请重新导入并拆解）。
- **不能靠「下次加载顺手删」**：加载路径（loadIndex 的 orphanByDir 跳过）保持原样——只跳过不删除；
  删除只能走 `removeOrphanVectors` 显式通道。
- **先读懂既有逻辑再扩展**：`isBookAlive` / `orphanByDir` 的加载期跳过语义未改动（见
  `knowledge-vector-store-book-alive.test.ts` 3 例仍全绿），新能力只做对账与显式清理。

## 六、边界与局限（不得夸大）

- 对账口径是「索引 id ↔ 向量库已加载 id」；书改名不改 bookId（book-alive 语义）不受影响。
- 孤儿清理只删向量（`removeBook`），不动知识库索引或书目录——索引侧数据永远不被本入口触碰。
- `-12` 种子 vault 的对账是「无孤儿」状态（索引↔向量 id 对齐），可作为干净对照样本。
- `verify-three-flows.mjs` 的一致性行与 UI 提示是两套实现（.mjs 镜像 vs 引擎函数），
  口径一致但代码未合并——已有技术债备案（随「verify 改 vitest 直 import」一并处理）。

## 七、复现

```bash
cd .obsidian/plugins/novel-writer-ai
npx vitest run tests/unit/engine/knowledge-vector-reconcile.test.ts   # 13 例
node scripts/verify-three-flows.mjs                                   # 真实 vault 一致性行
```
