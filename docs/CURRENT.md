# 现状卡（CURRENT）

> 状态：活跃（唯一「现在是什么样」的权威入口）
> 版本：v4.96.1 · 更新：2026-11-18
> 维护规则：**发版或结构变化时必须同步本文**；本文不抄数字，数字只引用真相源。
> 读完本文再读别的文档；其他文档与本文冲突时，以本文 + 代码 + 生成物为准。

---

## 1. 这是什么

Obsidian 插件「小说工坊 AI」：长篇 / 短篇 / 剧本三域创作 + 知识库拆解 + AI Agent 工作台。
仓库是**独立 git 仓**（vault 的 `.obsidian/` 被 vault 忽略），日常开发全部在本仓内完成。

## 2. 代码结构（真实目录，2026-11-17 核对）

| 目录 | 职责 |
|---|---|
| `core/` | 命令注册、设置服务、插件生命周期装配 |
| `i18n/` | 界面文案：`index.ts` 运行时（`t()` / 语言切换）+ `messages/{zh-CN,en-US}.ts` 资源 |
| `engine/` | 业务引擎：生成、结算、质控、修订、知识库、拆解、Agent/Harness |
| `services/` | 长流程与外围服务：执行台账、Worker、模型发现、备份 |
| `shared/` | 跨层原语：路径 `paths.ts`、缓存、存储、加密、写锁、类型 |
| `domains/` | 三域模型：`kernel`（共享）、`long`、`short`、`script` |
| `ui/` | 视图、弹窗、组件、工作台（`ui/full-writer/`）、设置页、听校播放条（`ui/tts/`） |
| `types/` `utils/` `workers/` | 类型声明、工具函数、Worker 源码 |
| `styles-src/` | 样式源文件，拼接为根目录 `styles.css`（`npm run build:styles`） |
| `tests/` | unit / integration / e2e / benchmark |
| `scripts/` | 门禁、生成器、开发脚本 |

**没有 `src/`**。看到文档写 `src/...` 就是过时描述。

## 3. 质量与数字（不要手抄）

| 事实 | 唯一来源 |
|---|---|
| 版本 | `package.json` 的 `version` |
| 门禁步骤与命令 | `package.json` 的 `scripts`；可读版 `docs/generated/gates.md` |
| 文件清单与规模 | `docs/generated/code-index.md` |
| 测试/E2E 基线 | `docs/progress/program-status.json`；最近一次 `npm run preflight` 输出为实测值 |
| 体积/覆盖率/CSS/JSDoc 预算 | `.bundle-baseline.json`、`.coverage-baseline.json`、`.css-baseline.json`、`.jsdoc-baseline.json` |

提交前跑 `npm run preflight`（全量门禁）；发布前 `npm run preflight:release`。
门禁只允许指标下降/覆盖率上升；上调基线必须 `--update-baseline --note "原因"`。

## 4. 当前在做什么

| 载体 | 用途 |
|---|---|
| `docs/planning/2026-11-16-next-focus.md` | **下一步优先级**（P0 质量闭环入口 / P1 可发现性 / P2 技术债） |
| `docs/modules/INDEX.md` | 模块清单与推进顺序（一次只推进一个模块） |
| `docs/modules/<模块>.md` | 单模块现状、验收记录、待办 |
| `docs/design/2026-11-16-visual-refactor-standard.md` | 视觉重构标准（切片 A–Y） |
| `docs/planning/2026-11-18-feature-gaps.md` | 功能缺口清单（7 项，按用户价值排序；①②③④⑤⑥已交付、⑦i18n 第一期 + 第二期第一片（命令面板）/ 第二片（外观设置页）/ 第三片（模型设置页）/ 第四片（通用设置六分区）/ 第五片（写作设置五分区）/ 第六片（写作知识库分区）/ 第七片（提示词管理器设置页）/ 第八片（设置搜索 + 迷你设置弹窗外壳）/ 第九片（拆解引擎分区）/ 第十片（写作指纹库分区 + 列表行 chrome）/ 第十一片（首启与自检分区 + 自检服务）/ 第十二片（伏笔管理分区）/ 第13片（创作模式与路径分区）/ 第14片（MCP 服务分区）/ 第15片（Agent 对话分区，设置分区正文全迁完）/ 第16片（写作指纹库视图链 + 12 维标签）/ 第17片第一批（完整写作工作台主体）/ 第18片（项目选择器与工作台外壳）/ 第19片（协同写作主视图）/ 第20片（协同写作子模块 `ui/co-writing/` 全目录）/ 第21片（`ui/cowrite/` 弹窗与存储）/ 第22片（template-vars-builder 甄别式迁移）/ 第23片（场景细纲面板）/ 第24片（向导群）/ 第25片（步骤渲染与单元写作）/ 第26片（干预与执行面板）/ 第27片（批处理与章节编排，写作主流程全链路迁完）/ 第28片（写作体检条与上下文加载）/ 第29片（写作统计与桌宠块）/ 第30片（知识库视图链：`knowledgebase` 244 键，三个模块级常量改函数）/ 第31片（知识库卡片格式层：状态徽标 + 字数/时长单位 20 键）/ 第32片（知识库能力横幅 + 卡片/面板 chrome，88 键）/ 第33片（人物生成弹窗，52 键）/ 第34片（知识库四个管理弹窗，99 键）/ 第35片（新建长篇小说项目弹窗与创建服务，64 键）/ 第36片（故事结构表单与弹窗，207 键；顺带修结构卡片溢出）/ 第37片（向导步骤正文与写作台状态栏，28 键）/ 第38片（项目入口三件套：创作主页 / 模式文档弹窗 / 前期调研残留，99 键）/ 第39片（黄金开篇工坊补漏，40 键）/ 第40片（同人设定弹窗残留 + 两处样式修复，37 键） / 第41片（AI 世界元素生成器，38 键）/ 第42片（文笔润色编辑器与 AI 润色弹窗，70 键）/ 第43片（脑洞构思工坊，75 键）/ 第44片（批量导入五步向导，136 键）/ 第45片（Agent 创作工作台与阶段面板，106 键；顺带修英文快捷按钮撑破左栏）/ 第46片（引擎层用户可见运行时文案，37 键：降级气泡/审批/工具摘要/节奏建议）/ 第47片（知识库 D 类：书籍详情弹窗 + 详情渲染器与五个逻辑助手，`knowledgeDetail` 184 + `bookDetail` 365 键）/ 跨层数据①（工具目录展示映射）/ 跨层数据②（创作流程阶段名）/ 跨层数据③（设定联动状态）/ 跨层数据④（novel-format 契约描述）/ 跨层数据⑤（协同写作保存状态枚举化）已交付） |

## 5. 文档怎么读（重要）

1. **本文** → 2. `handbook/`（做法） → 3. `modules/`（某模块现状） → 4. `generated/`（数字）
5. `ARCHITECTURE.md` / `DEVELOPMENT.md` / `API.md` / `PLAN.md` 是**深度参考**，写作时点较早，可能与现状有偏差：**只取结构性结论，具体以代码为准**。
6. 其余一律是**历史**：`audits/`（含 2026-11-15 三份专项审计）、`analysis/`、`_archive/`、`releases/` 旧版、`design/` 旧方案、`PROGRAM.md`、`PLAN.md` §三/§四、`changelog/archive-*`。历史文档不作为现状依据。

### 常见误读纠正

| 容易误读 | 事实 |
|---|---|
| `PROGRAM.md` 的 G1–G7 是待办 | 61 项**全部 done**（v4.23–v4.25 已收口），本文档只是历史编排 |
| `PLAN.md` §三待办矩阵 / §四里程碑 | 2026-11-05～06 的时点快照，已由 `planning/` + `program-status.json` 取代 |
| `audits/` 里的审计当问题清单 | 审计是**当时**的取证；未修项请看 `planning/2026-11-16-next-focus.md` |
| `analysis/` 是现状分析 | 2026-11 一次性评测与取证，含大体积 JSON，只在复现实验时读 |
| `program-status.json` 的 `baseline.tests` 是精确值 | 是台账基线（±10% 校验），实测以最近一次 `preflight` 为准 |
| 文档里的 `vX.Y.Z 计划` | 写下时点的计划，不代表当前排期 |

## 6. 已废弃 / 已下线（不要再引用）

- `.trae/CURRENT-PROGRESS.md`：已弃用且被 gitignore，进度看 `program-status.json`。
- `window.novelAI` 全局挂载：已删除，并有 `global-namespace` 门禁。
- `rewrite-chapters` spec / `E2E_REWRITE`：随「九霄逆脉行」下线，无脚本消费。
- `src/` 目录、`ui/views/kb-panel.ts` 等旧文件名：不存在。
- `nw-u-*` 工具类：按切片退场改语义类，**新代码不要新增**。存量口径、剩余存量大户与清理记录见
  `docs/design/2026-11-16-visual-refactor-standard.md` §5.1（定义 46 个、零引用 0、TS 引用 142 处）。
- `ui/` 里的裸中文文案：**新代码不要新增**（`npm run check:i18n` 按文件棘轮拦增），
  界面文案一律走 `t('点分键')` + 双语言资源，见 `docs/modules/i18n.md`。
