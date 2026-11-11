# 示例种子 vault 验证报告（DSH-20261112-12）

> 脚本：`scripts/seed-demo-vault.mjs`（种子）+ `scripts/verify-three-flows.mjs`（验证）· 输出原样粘贴，未手写改写
> 任务缘起：-08 的结论是「三条链路全部无法验证」——不是代码问题，是真实 vault 没有可验证样本。本任务造出样本。

## 一、结论

| 链路 | 种子 vault 结论 | 相比 -08（真实 vault）的变化 |
| --- | --- | --- |
| 知识流（拆解→向量化→嵌入→检索→归因） | **已验证通过**（exit 0） | 从「无法验证」→ 可验证：拆解/向量化/嵌入/检索四环全部 ✅ |
| 风格流（指纹库→启用→强度→注入） | **已验证通过**（exit 0） | 从「无法验证」→ 可验证：四环全部 ✅（可注入 3 枚） |
| 约束流（考据→设定→审核→绑定→注入） | **已验证通过**（exit 0） | 从「无法验证」→ 可验证：五环全部 ✅（approved + 2 条来源） |

- 验证脚本退出码 **0**（三条全通）；「归因」环节仍为 ❔——它依赖**写作后**的 rag_sources 运行时数据，静态样本永远覆盖不了，这与 UI 口径一致，不是种子缺陷。
- 真实 vault 重跑（路径勘误后）仍为「无法验证 ×3 / exit 2」——种子不碰真实 vault，真实环境的样本仍待用户产出数据。

## 二、种子清单（--json 真实输出）

```json
{
  "out": "C:\\Users\\admin\\AppData\\Local\\Temp\\nw-demo-vault",
  "count": 12,
  "files": [
    ".obsidian/plugins/novel-writer-ai/data.json",
    "写作知识库/知识库索引.md",
    "写作知识库/晨星志/晨星志.txt",
    ".obsidian/plugins/novel-writer-ai/data/knowledge-vectors/index.json",
    "元文件/04-项目总控/写作指纹库/template-fingerprints.json",
    ".obsidian/plugins/novel-writer-ai/data/fingerprint-library/global-fingerprints.json",
    "长篇小说/晨星外传/元文件/04-项目总控/写作指纹库/project-fingerprints.json",
    "长篇小说/晨星外传/元文件/04-项目总控/写作指纹库/fingerprint-intensity-config.json",
    "长篇小说/晨星外传/.project",
    "长篇小说/晨星外传/01-世界架构/世界观总览.md",
    "长篇小说/晨星外传/05-同人设定库/晨星设定.md",
    "长篇小说/晨星外传/05-同人设定库/_资料/晨星志/sources.json"
  ]
}
```

幂等性：连续运行两次，第二次输出与第一次一致（「写入 12 个文件（幂等覆盖，未删除任何已有文件）」）。
写保护：--out 指向含 `package.json` 的目录时被拒绝（报错原文见下，路径已省略中间层级）——

```text
❌ 拒绝把种子写进仓库/vault 本体：…\Temp\probe-repo-guard
   请用 --out 指定一个空目录（默认 <tmpdir>/nw-demo-vault）。
```

## 三、验证脚本真实输出（种子 vault，exit 0）

```text
三条链路运行层验证 · 2026/11/12 03:40:49（UTC: 2026-11-11T19:40:49.729Z）
vault: C:/Users/admin/AppData/Local/Temp/nw-demo-vault
项目: 长篇小说/晨星外传（选择方式: newest-.project）
说明: 项目 长篇小说/晨星外传 → 长篇小说/晨星外传/05-同人设定库/晨星设定.md
设置: 向量提供方=ollama 模型=bge-m3 主 API=未配置 向量 Key=未配置
嵌入探测: Ollama 可用，已安装 bge-m3

【知识流】已验证通过
  ✅ 拆解：1 本已拆解
  ✅ 向量化：1 本就绪
  ✅ 嵌入模型：Ollama 可用，已安装 bge-m3
  ✅ 检索：向量库已加载 1 本
  ❔ 归因：写作后可在统计页核对 rag_sources

【风格流】已验证通过
  ✅ 指纹库：可注入 3（另有模板 1 仅作来源）
  ✅ 启用：3 枚已启用
  ✅ 强度：全部 > 0
  ✅ 注入：特征与示例都会注入

【约束流】已验证通过
  ✅ 考据：2 条来源
  ✅ 设定：文件存在
  ✅ 审核：已通过人工审核
  ✅ 绑定：已绑定到当前项目
  ✅ 注入：约束会进入 prompt


退出码: 0（0=三条全通 / 1=有断点或降级 / 2=无法判定）
```

## 四、路径勘误（本次任务抓出的真 bug）

`verify-three-flows.mjs` 此前把**模板/项目层**指纹目录拼成 `元文件/04-项目总控/fingerprint-library/`，
而 `shared/paths.ts` 的真实常量是 **`PROJECT_FINGERPRINT_LIBRARY_DIR = 写作指纹库`**
（只有全局层用 `fingerprint-library`）。本任务的「生成内容必须用真实路径常量推导」恰好暴露了它——
若不修正，种子会按错误路径放指纹，验证脚本将看不到它们，报告就会把「脚本读不到」误判成「数据不存在」。
已修正并在代码处留 `@paths` 勘误注释。

对 -08 报告的影响：真实 vault 两个旧路径下都无指纹文件，故「风格流无法验证」的结论不变；其数据来源表中的路径描述已随之勘误。

## 五、各链路「已验证 / 无法验证」的边界（不得夸大）

| 环节 | 状态 | 说明 |
| --- | --- | --- |
| 嵌入模型可用性 | 已验证 | `GET http://localhost:11434/api/tags` 真实探测，模型清单命中 `bge-m3` |
| 检索数据一致性 | 已验证 | 知识库索引 1 本 ↔ 向量库索引 1 本，id 对齐（无孤儿） |
| 归因（rag_sources） | 无法验证 | 依赖写作后的运行时落盘，任何静态样本都覆盖不了 |
| 向量相似度质量 | 无法验证 | 种子不生成真实向量（需 embedding 调用），「vectorStatus: done」只验证状态位与索引对齐 |
| 实际注入到 prompt | 无法验证 | 需要真实 AI 调用与 prompt-ledger 对照，属运行时行为 |
| 考据来源真实性 | 无法验证 | sources.json 的 2 条来源是种子数据，不校验目标 URL 可达性 |

## 六、种子内容与真实格式的对应

| 种子文件 | @paths 常量/解析方 | 说明 |
| --- | --- | --- |
| `写作知识库/知识库索引.md` | DEFAULT_KNOWLEDGE_BASE_DIR / KB_INDEX_FILE；frontmatter JSON `books[]` | 与 KnowledgeBaseManager.loadIndex 同构 |
| `写作知识库/晨星志/晨星志.txt` | kbBookSourceFile（目录与文件名都走 sanitizeName） | 演示文风文本，非用户作品 |
| `…/data/knowledge-vectors/index.json` | pluginDataDir() + KB_VECTORS_DIR | 向量库索引（books[].bookId 对齐） |
| `元文件/04-项目总控/写作指纹库/template-fingerprints.json` | PJ_CONTROL_DIR + PROJECT_FINGERPRINT_LIBRARY_DIR + TEMPLATE_FINGERPRINTS_FILE | 模板层仅来源，不参与注入 |
| `…/data/fingerprint-library/global-fingerprints.json` | pluginDataDir() + FINGERPRINT_LIBRARY_DIR + GLOBAL_FINGERPRINTS_FILE | 全局层 2 枚启用 |
| `<项目>/元文件/04-项目总控/写作指纹库/project-fingerprints.json` | projectFingerprintsFile() | 项目层 1 枚启用 |
| `…/写作指纹库/fingerprint-intensity-config.json` | FINGERPRINT_INTENSITY_CONFIG_FILE | `{fp_demo_p1:{intensity:0.8}}`（强度 > 0） |
| `<项目>/.project` | pjProjectMeta()；parseProjectMeta 解析 `## 类型` / `## 同人设定路径` | fanfic 绑定入口 |
| `<项目>/01-世界架构/世界观总览.md` | pjWorldview() / SUBDIR_WORLDVIEW_FILE | 项目骨架一处（其余骨架文件名与三链路无关，未造） |
| `<项目>/05-同人设定库/晨星设定.md` | pjFanficFile()；readFanficRules 解析 `审核状态:` 与 `- **核心规则**：` | approved + 实质规则 |
| `<项目>/05-同人设定库/_资料/晨星志/sources.json` | pjFanficResearchDir() | 2 条来源（CanonResearchService.loadCache 同构） |

## 七、复现

```bash
cd .obsidian/plugins/novel-writer-ai
node scripts/seed-demo-vault.mjs
node scripts/verify-three-flows.mjs --vault "$TEMP/nw-demo-vault"
```

## 八、已知局限

- 种子的 `vectorStatus: done` 只证明「状态位 + 索引对齐」，不证明向量本身可用（无 embedding 调用）。
- 验证脚本读考据缓存路径未过 sanitizeName（真实实现有）；种子作品名「晨星志」不含需净化字符不受影响，
  但作品名含 `/` 等字符时两处路径可能分叉——已记为技术债，随「verify 改 vitest 直 import」一并处理。
- 种子写死 2026-01-02 时间戳，多次重跑内容完全一致（幂等）。
