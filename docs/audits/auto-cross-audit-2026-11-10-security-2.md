# 自动交叉审计 — 安全（密钥/注入/权限/外部输入）③

> 日期：2026-11-10 · 基线：`fbda324` · 维度：③ 安全（密钥/注入/权限/外部输入）
> 方法：两个独立视角并行取证（① SEC-1..SEC-7 逐条对照当前 HEAD 复核 + 密钥面全扫；② 对近期新增代码做安全盲审），交叉核对后合并。
> 本轮修复：**openPromises 状态精确枚举（自身上轮修复的子串误判回归）、SEC-7 文件大小硬限三入口、NW-SEC-1 摘要路径 sanitize（防御）**。台账第 22 轮。

## 一、Findings

### SEC 系列复核（对照 2026-11-09 security-followup）

| 编号 | 原级别 | 判定 | 要点 |
|---|---|---|---|
| SEC-1 | P1 | **部分修复** | 核心读写删已封死（isSafeVersionMeta + 5 个应用点 + 测试在位）；**残留**：backup-center-service.collectVersions 不过滤伪造条目，modal 对 sourcePath 直接 adapter.read（读取泄漏到对比 UI）、onSaveVersion 的 contentKey 未净化可写穿越目录；修法 ≈20 行 → fix queue 首候选 |
| SEC-2 | P2 | 部分修复 | svg-charts safeNum/safeColor 代码在位（28 处使用），但**对抗性单测缺失**；补 2 个用例 ≈30 行 → fix queue |
| SEC-3 | P2 | **已修复** | isSafeBookId + isBookAlive 过滤 + 双段 sanitize，测试在位 |
| SEC-4 | P2 | **已修复** | dsh-launch 项目目录限制 + 双 DeepSeek 才注入 Key，测试在位 |
| SEC-5 | P2 | **已修复** | host-tools READ_ONLY_COMMAND_PATTERN 白名单，测试在位 |
| SEC-6 | P2 | 仍开放 | IPv6 半边（fc00::/7、fe80::/10、::ffff: 映射）≈10 行可修；3xx 逐跳受 Obsidian requestUrl 平台限制，记录为平台限制 → fix queue |
| SEC-7 | P2 | **本轮已修** | MAX_SOURCE_FILE_SIZE 导出为共用常量；kb-manager addBook 超限从 warn+继续改**硬拒绝**；batch-import-modal 本地文件读前跳过；knowledge-base-modals file.text() 前拒绝（三入口） |
| SEC-11 | P3 | 仍开放 | engine-registry 迁移时 data.json 原样复制为 .bak（无口令用户即明文 Key 副本），备份条目描述写「含密文」与实际不符；≈10 行 → fix queue |

### 近期新增代码盲审（NW 系列）

| 编号 | 级别 | 位置 | 问题 | 状态 |
|---|---|---|---|---|
| NW-SEC-1 | Low | shared/paths.ts:417 pjChapterDigestFile | chapterKey 未 sanitize 直拼路径（现网调用方均传「第N章」不可触发，防御性加固） | **本轮已修**（sanitizeName 1 行，与 pjCharFile 同先例） |
| NW-SEC-2 | Low | ledger-parse.ts findTable | 病态表格输入 O(n²) 前向扫描（本机 DoS） | 未修 → fix queue（表头候选预扫描或前视窗口） |
| NW-SEC-3 | Low | chapter-digest.ts loadRecentChapterDigests | 大目录全量 read 后仅留 3 条 | 未修 → fix queue（排序预筛后只 read 最近 count 个） |
| NW-SEC-4 | Low | graph-validation-trigger | 在途（已 fire）的 runGraphValidation 卸载时无 abort，5s 窗口内报告仍落盘 | 未修 → fix queue（AbortSignal 参数 + 写盘前检查） |
| NW-SEC-5 | Info | association-resolver/overflow-recovery | 注入 prompt 的台账/正文文本无指令围栏（创作类影响有限） | 未修 → fix queue（「以下为资料」围栏） |
| NW-SEC-6 | Info | chapter-digest parseChapterDigest | 动态构造 RegExp 的模式性隐患（key 全为常量字面量，现网无风险） | 未修 → fix queue（escapeRegExp 或 indexOf） |
| NW-SEC-7 | Info | ledger-io 模块级 cache | 多项目常驻有界内存 | 排除（可选 LRU） |
| NW-SEC-8 | Info | overflow-recovery compressionCache | 32 位 FNV 碰撞时压缩文本张冠李戴（正确性非注入） | 未修 → fix queue（cacheKey 加长度+首尾片段） |

### 本轮新修（安全 + 自身回归）

| # | 级别 | 位置 | 问题 | 修法 |
|---|---|---|---|---|
| OP-1 | P1 | ledger-index.ts openPromises | **上轮 F-3b 修复引入的状态子串误判**：`/兑现|已解决|放弃|resolved|dropped/` 会把「未兑现/未放弃/未解决」误判为已关闭——正向承诺被静默丢弃 | 精确枚举 CLOSED 集合（resolved/dropped/已兑现/已解决/已放弃/已回收，lowercase+trim）；回归 +1 条（三个否定表述全保留） |
| SEC-7 | P2 | kb-manager + 两 UI 入口 | 超大源文件 warn+继续 → 全量读入拖垮内存 | addBook 硬拒绝；两 UI 入口读前 size 检查跳过/拒绝；MAX_SOURCE_FILE_SIZE 导出共用 |

## 二、已排除项（交叉确认）

- **正则注入**：新增模块（entity-index/graph-validator/association-resolver/ledger 系）零 `new RegExp(`；relationship-engine 动态 RegExp 的 key 均为常量。
- **原型污染**：范围内无 JSON.parse 结果展开进共享对象；updateDigestIndex 把解析数组当不透明记录。
- **密钥面**：全源码无 log/Notice/error 回显 Key；providerKeys 仅设置存取/掩码 UI；data.json 保存前经 resolveSecret aes256 加密（无口令明文是用户拍板 B 既有取舍，UI 有风险文案）；备份导出有 secret-redaction。近期提交未恶化。
- **路径注入**：新代码写点逐一核对——settlement-table-writer 全数字、graph-validator 报告路径固定、ledger-write 不碰 fs、pjStoryLedgerIndex 仅固定文件名；SEC-1 sweep 确认 pjFanficResearchDir/kbBookDir/bookId 均有 sanitize 或双层过滤。
- **资源限制总体排除**：listFolderFiles maxDepth/maxFiles、EntityRecheckGate maxEntries=200、compressionCache 上限 200、http-request 有界重试。例外已列 NW-SEC-2/3。
- W-7 闸门与 F-1/F-2 生命周期修复本身经盲审确认语义正确（checkedHash/seenHash 分离有效、_entityRecheckAbort 新编辑与 unload 均 abort）。

## 三、本轮实跑结果

- 定向 30 passed（含 openPromises 新增否定表述用例 1 条）。
- `tsc --noEmit` = 0。

## 四、待用户拍板项

- SEC-1 残留（backup-center 读取泄漏 + saveVersion 穿越写）与 SEC-6 重定向逐跳（平台限制）——前者是下一安全批次首候选，本轮未动（≤50 行可修，放 fix queue 排序）。
- SEC-11（data.json.bak 明文副本文案）是否顺带修：≈10 行，属既有用户拍板 B（无口令明文）的展示问题。
