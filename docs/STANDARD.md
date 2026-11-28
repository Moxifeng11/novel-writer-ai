# 开发规矩与验收标准（STANDARD）

> 状态：活跃（**唯一权威的「开发规矩 + 验收标准」口径**）· 2026-11-28
> 命令清单与计数不写进本文：脚本以 `package.json` 为准，生成物见 [generated/gates.md](generated/gates.md)，台账见 [progress/program-status.json](progress/program-status.json)。
> 本文与 [CURRENT.md](CURRENT.md) 分工：CURRENT 回答「现在是什么样」，本文回答「必须怎么做、做到什么程度算完成」。

---

## 〇、元规则（规矩本身的规矩）

### 0.1 冲突仲裁顺序

出现说法冲突时，**上位覆盖下位**，不要凭直觉挑一条：

1. **代码与运行时实测行为**
2. **可执行门禁的断言**（`scripts/check-*.mjs`；门禁与本文冲突时视为本文过期，须改本文）
3. [CURRENT.md](CURRENT.md)（现状卡）
4. **本文 §1 规矩表 / §2 验收标准**
5. `handbook/*`（操作细节）
6. `audits/` 快照、`analysis/`、`_archive/`（仅追溯，永不作为现状依据）

### 0.2 改规矩的三种情形

| 情形 | 必须做的事 |
|---|---|
| **收紧**（新增/加严规矩） | ①本文 §1 加规则条目（分配 R-ID）②落地或更新门禁 ③§3 门禁表登记 ④若有既有代码违规，登记 baseline 并在 §5 建议里写明收敛计划 |
| **放宽**（删规矩或降级为建议） | ①本文写明放宽理由与被取代的条目 ②门禁同步删除或降级 ③**禁止**只删门禁不改本文（那会让规矩变成口头约定） |
| **豁免**（一次性例外） | 走 §5 显式标记，写理由；不得通过改门禁脚本、删测试、改 baseline 数值来「通过」 |

### 0.3 规矩的最小可用形态

一条规矩必须同时具备三件事，否则只是建议：

1. **可判定**：能被机械断言，或能被评审清单勾选（二选一，不能只是「注意一下」）
2. **有落点**：违规时要么门禁失败，要么 §3 表格标注「人工评审」
3. **有成本说明**：写清违规后果（数据损坏 / 线上事故 / 只是风格）

### 0.4 本文自身如何防腐

`npm run check:standard-map` 强制双向完整：

- `package.json` 里每个 `check*` 脚本**必须**出现在 §3 门禁表（漏登记 → 失败）
- §3 表里写的每个脚本**必须**真实存在于 `package.json`（幽灵门禁 → 失败）
- §1/§2/§3/§5 章节骨架必须存在（被削成空壳 → 失败）

即：新增门禁不登记文档 = 过不了 preflight。这是把「固化文档随码更新」用在规矩文档自己身上（另见 §1 的 R-O3）。

---

## 一、规矩清单

> 每条格式：**规则** / 强制方式 / 违规后果。`门禁` 指 preflight 内会失败；`人工评审` 指 [08-code-review.md](handbook/08-code-review.md) 勾选项。

### A 数据与写入安全（最高优先级：损坏用户数据不可逆）

| ID | 规则 | 强制方式 | 违规后果 |
|---|---|---|---|
| R-D1 | 正文只经 `engine/body-writer.ts` 写入；不得绕过它直写章节正文 | 门禁 `check:write-entry` | 数据损坏 |
| R-D2 | 同路径「读-改-写」必须在同一写锁内（`withWriteLock`），快照与写入不得分离 | 人工评审 | 并发覆盖丢内容 |
| R-D3 | 覆盖用户既有内容前必须有备份/版本（`_versions` 或 journal） | 人工评审 | 不可逆丢失 |
| R-D4 | 重复执行必须幂等（章名/内容哈希/结构化键去重） | 人工评审 | 重复条目污染 |
| R-D5 | 失败必须可回滚；存在部分失败时不得以「成功」收尾 | 人工评审 + `check:relationship-authority`（关系类） | 半成品被当完成 |
| R-D6 | 关系/伏笔/时间线只有一个权威写入源，其余为派生 | 门禁 `check:relationship-authority` | 双写互相覆盖 |
| R-D7 | 索引内 `.md` 不得用 `vault.adapter.write` 直写（除隐藏/data 目录并注明理由） | 人工评审 | metadataCache 陈旧 |

### B 分层与模块边界

| ID | 规则 | 强制方式 | 违规后果 |
|---|---|---|---|
| R-A1 | 分层不得反向依赖（ui→engine→shared 方向，详见 `handbook/02-architecture.md`） | 门禁 `check:deps` | 架构腐化、循环依赖 |
| R-A2 | 跨层共享的**纯常量/纯类型**下沉 `shared/`；services 不得运行时 import engine | 门禁 `check:deps` | 同上 |
| R-A3 | 共享态（引擎实例）必须经 `EngineRegistry` 注册，不得各处 `new` | 门禁 `check-engines` | 状态分裂、内存翻倍 |
| R-A4 | 命令必须三处同步：命令定义 + 内部注册 + 命令面板注册 | 门禁 `check:command-handlers` | 命令面板点了没反应 |

### C 类型与代码质量

| ID | 规则 | 强制方式 | 违规后果 |
|---|---|---|---|
| R-C1 | `tsc --noEmit` 零错误 | 门禁 `typecheck` | 构建失败 |
| R-C2 | `any` 只能减少不能增加；新增需显式理由 | 门禁 `check:any` | 类型逃逸 |
| R-C3 | 公开导出必须有 JSDoc（含 `@example` 的公共入口） | 门禁 `check:jsdoc` | 接口不可发现 |
| R-C4 | catch 块不得静默吞错：要么处理、要么 `// silent-ok: 理由` 显式豁免 | 门禁 `check:silent-failures` | 故障不可见 |
| R-C5 | 热路径（`getFiles`/全库遍历等）不得在每次调用重复全扫描 | 门禁 `check:hotpaths` | 卡顿 |
| R-C6 | 不新增工具类/巨型文件；超限需拆分 | 门禁 `check:utility` | 维护成本 |
| R-C7 | 大视图（>200 行逻辑）必须有对应测试导入 | 门禁 `check:view-tests` | 回归无保护 |

### D 并发与生命周期

| ID | 规则 | 强制方式 | 违规后果 |
|---|---|---|---|
| R-L1 | 长任务必须有取消/超时路径；取消后 UI 与计数必须恢复 | 人工评审 | 队列卡死 |
| R-L2 | **计数型状态机在异常路径必须守恒**（`activeCount` 类：`++` 后所有退出路径都要 `--`） | 人工评审 + 单测 | 永久死锁（本仓实踩） |
| R-L3 | 定时器/Worker/子进程/事件监听必须在 `dispose()` 或 `finally` 中释放 | 人工评审 | 内存泄漏 |
| R-L4 | 长生命周期对象不得无上限累积（缓存要有容量与淘汰） | 人工评审 | 内存无界增长 |
| R-L5 | 终态后不得再持有大对象（正文原文等），要及时释放 | 人工评审 | 内存无界增长 |

### E 测试

| ID | 规则 | 强制方式 | 违规后果 |
|---|---|---|---|
| R-T1 | 测试是**行为契约**：断言可观察行为，不断言实现细节 | 门禁 `check:test-standard`（可机械校验的四条） | 假绿 |
| R-T2 | 修复 bug 必须带回归测试；测试在修复前必须**能失败** | 人工评审 | 复发 |
| R-T3 | 不得只测死路径：被「修复」的入口必须有生产调用方 | 人工评审（交叉 `check:any`/死代码审查） | 修复落在死路径（本仓实踩） |
| R-T4 | 影响真实运行时的改动，除单测外必须有实测证据（探针/实机） | §2 任务级 DoD | 单测绿但真机不通 |
| R-T5 | 不得删除测试来「通过」；确需删须在本文 §5 登记理由 | 人工评审 | 覆盖静默流失 |
| R-T6 | 覆盖率门限只在发布前作为门槛，不以覆盖率替代行为断言 | 门禁 `check:coverage`（发布前） | 数字游戏 |

### F 文档

| ID | 规则 | 强制方式 | 违规后果 |
|---|---|---|---|
| R-O1 | 每份文档头部必须有 `> 状态：`（活跃/参考/历史），能自证「还算不算现状」 | 门禁 `check:docs` | 历史被当现状 |
| R-O2 | 现状类文档不得写死易漂移计数（用例数/门禁数），只能指向真相源 | 门禁 `check:docs` | 文档腐化（本仓实踩） |
| R-O3 | **活文档**（`*-flow`/`*-map`/`*-reference`/`*-guide`）必须随码更新：引用失效即失败；历史记述用 `<!-- anchor-ok: 理由 -->` 豁免；过期活文档改名 `*-snapshot.md` 降级 | 门禁 `check:doc-anchors` | 后续优化读到过期结论而偏移 |
| R-O4 | 文档索引必须登记新文档（`docs/README.md`）；手册/ADR 逐文件强制 | 门禁 `check:docs` | 文档不可发现 |
| R-O5 | 生成物（`docs/generated/*`、`PROGRAM-STATUS.md`）禁止手改 | 门禁 `check:docs` / `check:program` | 漂移失败 |
| R-O6 | 新增/改名命令、事件、设置键、frontmatter 字段必须同步 `handbook/04-interface-contracts.md` | 门禁 `check:linked-scenarios` | 契约失真 |
| R-O7 | **登记承诺必须与实际校验一致**：文档不得声称「否则会失败」而门禁并不校验 | 人工评审（改门禁时同步改表述） | 假承诺（本仓实踩） |

### G 界面与文案

| ID | 规则 | 强制方式 | 违规后果 |
|---|---|---|---|
| R-U1 | UI 文案走 `t()` + `i18n/messages/*`，中文字面量只减不增 | 门禁 `check:i18n` | 无法国际化 |
| R-U2 | 引擎/UI 消息码必须经生成器同步 | 门禁 `check:engine-msg` | 文案漂移 |
| R-U3 | 引擎层中文只允许「保留声明」内的白名单 | 门禁 `check:cjk-keep` | 分层混乱 |
| R-U4 | 样式必须来自 `styles-src/` 拼接，不得内联 | 门禁 `check:styles`、`check:inline-styles`、`check:css` | 主题失效 |

### H 依赖与平台

| ID | 规则 | 强制方式 | 违规后果 |
|---|---|---|---|
| R-P1 | 只用 Obsidian 公开 API；私有/未文档化 API 需登记理由 | 门禁 `check:obsidian-api` + `check:obsidian-review` | 审核不通过 |
| R-P2 | 移动端不得依赖桌面能力（Node/文件系统原语） | 人工评审 + 门禁 `check:obsidian-review` | 移动端崩溃 |
| R-P3 | 密钥不得硬编码或入仓 | 门禁 `check:secrets` | 凭据泄漏 |
| R-P4 | 内联 worker 生成物必须与源码一致 | 门禁 `check:workers-inline` | 行为不一致 |
| R-P5 | 内置模板资源与生成物一致 | 门禁 `check:templates` | 首装初始化失败 |
| R-P6 | PromptManager 默认步骤模板必须与引擎 canonical 同源 | 门禁 `check:template-parity` | 用户编辑覆盖真模板（本仓实踩） |

### W 提交与协作

| ID | 规则 | 强制方式 | 违规后果 |
|---|---|---|---|
| R-W1 | 提交前 `npm run preflight` 必须 EXIT=0 | 门禁 `preflight` 全链 | 破坏主干 |
| R-W2 | 提交信息必须说明「改了什么 / 为什么 / 如何验证」；不得只写「fix」 | 人工评审 | 无法追溯 |
| R-W3 | 一次提交只做一件事；重构与行为变更分离 | 人工评审 | 回溯困难 |
| R-W4 | 任务完成必须给出 evidence（提交号 + 测试名/探针输出），写到任务板或台账 | §2 任务级 DoD | 无法验收 |
| R-W5 | 不得擅自 `tag` / 发 Release / 执行破坏性 E2E（需用户明确确认） | 流程约定（AGENTS.md） | 误发布 |
| R-W6 | 三个 harness 的写范围由任务板租约互斥；不得越界改他人 scope | 门禁 `check:automation` + 任务板 | 互相覆盖 |

---

## 二、验收标准（Definition of Done）

三档，逐档叠加。**下一档通过不能替代上一档**；也不得用「计划完成」「待办清空」当作完成证据。

### L1 改动级（每次提交）

全部满足才算可以提交：

1. `npm run typecheck` 通过
2. 受影响范围测试通过（新增/修改代码有对应测试；修 bug 有回归测试且修复前能失败）
3. `npm run preflight` **EXIT=0**
4. 基线类指标（any/CSS/体积/JSDoc/静默失败…）**未增长**；确需增长则 `--update-baseline --note "理由"` 并在 PR/提交说明里写清
5. 未触碰红线：不删测试、不改门禁脚本绕过、不硬编码密钥、不擅自 bump 版本

> **不算完成的情形**：测试只覆盖死路径；探针 skip 当通过；门禁靠新增 baseline 项「变绿」。

### L2 任务级（任务板 / 台账中的一个 task）

L1 全部 + 以下：

1. **acceptance 逐条勾对**：任务声明里写的每条验收条件都有对应证据（测试文件:用例名 / 探针输出 / 实机观察）
2. **evidence 字符串**：至少含「提交号 + 断言来源」，写入任务板 `done --evidence` 或 `program-status.json`
3. **行为证据**：影响运行时的改动要有一手实测（`check:prod` / `check:func` / `check:decon` / 实机截图），不能只有单测
4. **文档同步**：涉及命令/契约/规矩/活文档的改动，对应文档已更新（R-O3/R-O4/R-O6）
5. **无遗留脏状态**：不留半截 TODO、不把「暂时注释掉」留在主干、不新增未登记豁免

> **不算完成的情形**：单测全绿但真机未测；文档写完但门禁不认；把 `skip` 当 `pass` 汇报。

### L3 发布级（打 tag / 发 Release 前，需用户确认）

L2 全部 + 以下：

1. `npm run preflight:release`（含覆盖率门限）
2. 真实实例三探针：`check:prod`（真实 AI 调用）/ `check:func` / `check:decon` **全部 pass，无 skip**
3. `CHANGELOG.md` + `docs/releases/vX.Y.Z.md` + `program-status.json` 三处一致
4. `check:release -- --tag vX.Y.Z` 通过；manifest/versions/worker 资产一致
5. 用户明确确认（`tag`/Release 不由 agent 单方面发起）

### 验收反例清单（本仓实踩，禁止重演）

| 反例 | 为什么它骗过了检查 | 正确做法 |
|---|---|---|
| 修复落在死路径 | 单测只测死路径，全绿 | 先确认入口有生产调用方（R-T3） |
| 写了没接上 | 模块写好了、引擎没引用，单测直测模块 | 加接线断言（探针/契约测试） |
| 设了不生效 | 设置项有 UI，无消费点 | 设置项必须登记消费方（`handbook/04`） |
| 规则没门禁 | 文档写了「否则会失败」，实际不校验 | R-O7 + `check:standard-map` |
| 护栏挡住目标 | 安全护栏本身成为功能障碍 | 护栏要带「如何合法越过」的出口 |
| 计数不守恒 | 只在正常路径测 | 异常路径单测（R-L2） |
| 探针假绿/假红 | eval 不 await、按行计数环境报错 | 探针按「插件相关/环境性」分类 |

---

## 三、门禁总表

> 每个 `check*` 脚本都必须在表中出现（`check:standard-map` 强制）。「时机」列：**提交前** = 在 `preflight` 链内；**发布前** = 只在 `preflight:release`；**按需** = 手动/专项运行。

| 门禁 | 守的规矩 | 时机 |
|---|---|---|
| `typecheck` | R-C1 类型零错误 | 提交前 |
| `lint` | R-C1 静态规则 | 提交前 |
| `test` | R-T1 行为契约 | 提交前 |
| `build` | 构建可用性（产物可生成） | 提交前 |
| `check:deps` | R-A1 分层不反向依赖 | 提交前 |
| `check-engines` | R-A3 共享态走注册表 | 提交前 |
| `check:command-handlers` | R-A4 命令三处同步 | 提交前 |
| `check:write-entry` | R-D1 正文唯一写入口 | 提交前 |
| `check:relationship-authority` | R-D6 关系权威源唯一 | 提交前 |
| `check:any` | R-C2 any 预算棘轮 | 提交前 |
| `check:jsdoc` | R-C3 导出注释覆盖 | 提交前 |
| `check:silent-failures` | R-C4 静默失败 | 提交前 |
| `check:hotpaths` | R-C5 热路径扫描 | 提交前 |
| `check:utility` | R-C6 工具类规则 | 提交前 |
| `check:view-tests` | R-C7 大视图需测试 | 提交前 |
| `check:test-standard` | R-T1 测试标准（机械四条） | 提交前 |
| `check:docs` | R-O1/R-O2/R-O4/R-O5 文档索引/状态头/不写死计数 | 提交前 |
| `check:doc-anchors` | R-O3 活文档随码更新 | 提交前 |
| `check:standard-map` | §0.4 本文与门禁双向完整 | 提交前 |
| `check:program` | R-O5 台账渲染一致 | 提交前 |
| `check:linked-scenarios` | R-O6 联动场景登记 | 提交前 |
| `check:changelog` | 变更日志结构 | 提交前 |
| `check:i18n` | R-U1 中文棘轮 | 提交前 |
| `check:engine-msg` | R-U2 消息码生成 | 提交前 |
| `check:cjk-keep` | R-U3 引擎中文白名单 | 提交前 |
| `check:styles` | R-U4 样式拼接 | 提交前 |
| `check:inline-styles` | R-U4 禁内联样式 | 提交前 |
| `check:css` | R-U4 CSS 语法+预算（`--strict` 阻断） | 提交前 |
| `check:obsidian-api` | R-P1 Obsidian API 规范 | 提交前 |
| `check:obsidian-review` | R-P1/R-P2 官方审查规则 | 提交前 |
| `check:review-warn` | 审查 warn 棘轮 | 提交前 |
| `check:secrets` | R-P3 密钥扫描 | 提交前 |
| `check:workers-inline` | R-P4 worker 内联一致 | 提交前 |
| `check:templates` | R-P5 内置模板资源一致 | 提交前 |
| `check:template-parity` | R-P6 步骤模板同源 | 提交前 |
| `check:automation` | R-W6 协作台账 | 提交前 |
| `check:support-qr` | 生成物一致（支持二维码） | 提交前 |
| `check:bundle` | 体积（报告模式；`--strict` 阻断） | 提交前 |
| `check:release` | L3 发布资产一致 | 提交前 |
| `check:project-standard` | 项目数据结构标准（`handbook/07-project-standard.md`） | 按需 |
| `check:coverage` | R-T6 覆盖率门限 | 发布前 |
| `check:release:remote` | L3 远端发布核对 | 发布前 |
| `check:published` | L3 已发布版本核对 | 按需 |
| `check:prod` | L2/L3 真实 AI 调用冒烟（消耗 token） | 按需 |
| `check:func` | L2 功能级接线探针（零 token） | 按需 |
| `check:decon` | L2 拆解链路探针（零 token） | 按需 |

> 「按需」不表示可以不做：L2/L3 验收里被引用的探针必须实际跑过并贴输出。

---

## 四、豁免机制（唯一合法通道）

| 机制 | 用在哪 | 形态 | 约束 |
|---|---|---|---|
| **棘轮基线** | `check:any` / `check:css` / `check:bundle` / `check:jsdoc` / `check:coverage` / 静默失败 | `.x-baseline.json` | 只允许**下降**；上升必须 `--update-baseline --note "理由"`；`--strict` 可恢复阻断自查 |
| **静默失败豁免** | 确属有意降级的 catch | `// silent-ok: 理由`（必须在 catch 同行） | 理由为空 = 失败 |
| **活文档历史豁免** | 活文档里引用已删除路径的历史记述 | `<!-- anchor-ok: 理由 -->` | 必须同行为历史记述；不得覆盖当前事实 |
| **进程内豁免** | 一次性紧急绕过 | 无 | **不存在**。禁止改脚本、删测试、跳过 preflight 后提交 |

**红线**：任何豁免都必须在提交说明里出现；连续两轮以豁免换绿视为规矩失效，须回到 §0.2 走「放宽容」流程。

---

## 五、待收敛的例外（登记，非永久）

| 项 | 现状 | 收敛方向 |
|---|---|---|
| `check:bundle` / `check:css` 预算为报告模式 | 用户已决定不阻断（体积硬约束阻塞开发） | 发版前用 `--strict` 自查 |
| 协作任务板 evidence 依赖人工填写 | 无机械校验「evidence 非空且有提交号」 | 可在 `board.mjs done` 加正则校验（待排期） |
| `audits/` 内活文档与快照同目录 | 靠文件名后缀区分（`-flow/-map/-reference/-guide` vs 其余） | 若继续增多，迁至 `docs/reference/` 与 `docs/audits/` 分目录 |

---

## 六、相关入口

| 想了解 | 看 |
|---|---|
| 现在是什么样 | [CURRENT.md](CURRENT.md) |
| 分层怎么落 | [handbook/02-architecture.md](handbook/02-architecture.md) |
| 新增模块检查表 | [handbook/03-module-development.md](handbook/03-module-development.md) |
| 接口契约登记 | [handbook/04-interface-contracts.md](handbook/04-interface-contracts.md) |
| 测试怎么写 | [handbook/05-testing.md](handbook/05-testing.md) |
| 门禁怎么跑/失败怎么办 | [handbook/06-gates-and-release.md](handbook/06-gates-and-release.md) |
| 评审勾什么 | [handbook/08-code-review.md](handbook/08-code-review.md) |
| 注释标准 | [handbook/09-comment-standard.md](handbook/09-comment-standard.md) |
| 文档分类与更新时机 | [handbook/10-documentation-policy.md](handbook/10-documentation-policy.md) |
| 分发质量台账 | [progress/program-status.json](progress/program-status.json) |
