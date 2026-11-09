# 自动交叉审计 · 维度⑤ 依赖 / 包体 / 性能 / 首屏

- 日期：2026-11-09
- 触发：无 Trae 消息（分支 B2）；上一轮为代码批次 C-6，本轮按轮换做维度⑤
- 审计方式：**两个独立只读视角交叉取证**——A 视角依赖/构建产物/包体（56 次工具调用，含 esbuild metafile 内存复算）；B 视角启动/首屏/热路径/DOM（194 次工具调用，含 `check-hotpaths` 实跑）。ZCode 复核并修复 1 项可锁定的 P1 影响面。
- 结论：**P1 2 项（本轮修 1 项，1 项进 fix queue）**、P2 8 项、P3 5 项；已排除 8 类「疑似问题」。**无 P0。**
- **交叉核对**：A 实测 `main.js` 4,861,517B、模块求值约 108ms；B 引用 `docs/PERFORMANCE.md` 的 89ms。两者测量口径不同（本机冷/热、是否含 Obsidian 宿主），不构成冲突；本轮以 A 的构建产物字节与 B 的热路径调用链为准。

## 一、已修（本轮，P1 影响面，带测试）

| ID | 位置 | 问题 | 触发条件 | 影响 | 修法 |
|---|---|---|---|---|---|
| W-1 | `services/worker-manager.ts:243-283` | 握手期只监听 `message`；三文件安装（社区目录/BRAT）没有 `workers/`，`new Worker(url)` 不抛错、只异步 `error`，旧实现必须等 5s 超时才降级 | 社区目录安装后首次拆解/质量任务 | 首个任务固定多等 5 秒，期间主线程无反馈；用户以为卡死 | 握手期同时监听 `error`，立即 `terminate` 并 reject「Worker 脚本加载失败」；握手完成/超时统一清理监听与定时器；新增单测证明 error 后**不推进 5s 定时器**即失败 |

测试：`tests/unit/services/worker-manager.test.ts` +1（`Worker 握手期 error：立即失败，不等待 5 秒超时`），12/12 通过。

## 二、Fix queue（未修）

| ID | 严重度 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| W-2 | P1 | `.github/workflows/release.yml:85-91/120-122`、`scripts/check-release.mjs:158-171`、`shared/plugin-worker-url.ts:33-55` | 三文件渠道不含 `workers/`，worker 路径永远指向不存在的文件；zip 里两个 worker 790,529B 与主包 99% 重复，占发布 payload 12.8% | 二选一：①社区版按需从 Release 下载并按 SHA256 校验；②移除 zip 内 workers 并明确“后台线程仅 zip 安装可用”；同时给 worker 设体积上限 |
| W-3 | P1 | `main.ts:765-893`、`engine/engine-registry.ts:1384-1387`、`engine/knowledge-vector-store.ts:287-339` | onload 串行 `EngineRegistry.initialize()`（含向量库逐 JSON 读、56 次模板 `adapter.exists`、RulesService 全库 `getFiles`），命令注册在 835、视图注册在 893，全部 I/O 完成后才可用 | 命令/视图/ribbon 提前注册；向量库懒加载；模板探测改一次 `adapter.list` 或并行；规则迁移加版本短路；加 `performance.mark` 与冷启动门禁（目标 onload <500ms） |
| W-4 | P2 | `.bundle-baseline.json`、`scripts/build.js`、`manifest.json:9` | main.js 4,861,517B，距 5MB 上限仅 2.77%；内联数据 404,797B（8.3%：知识库 215KB、模板 76KB、changelog 61KB、二维码 52KB）；esbuild 无显式 target | 低风险先减 ~120KB（changelog 91→20 条、二维码 WebP/PNG8、模板 gzip）；显式 `target:['es2020']`、`sourcemap:false`；check:release 增加 main ≤4.9MB / styles ≤550KB 硬上限 |
| W-5 | P2 | `scripts/build-styles.mjs:8-13`、`styles.css:384/14467` | styles.css 未压缩：注释 66,977B（12.3%）、被覆盖声明 25,193B、未引用类约 9,042B、同 SVG data URI 重复两次 | 构建产物加 CSS 轻量压缩（保层叠顺序）：先删注释/未引用/精确重复 → ≤467KB，再 minify → ~400KB；基线同步 |
| W-6 | P2 | `package.json:38`、`.github/workflows/ci.yml:30-31`、`release.yml:11-15/32-36` | `audit:deps = npm audit --omit=dev`，生产依赖为 0 恒过；release 在 `contents:write` + attestation 权限下先执行 devDependencies install scripts；CI 无顶层 permissions | 改 `npm audit --audit-level=high`（含 dev，exception 清单）；`npm ci --ignore-scripts` 实测构建；build/publish 拆 job，build 只读；CI 顶部 `permissions: contents: read` |
| W-7 | P2 | `main.ts:939-959/1789-1840`、`engine/entity-state-manager.ts:198-326` | 正文自动保存（约每 2s）防抖 3s 后触发整章 AI 实体状态重检；`applyStateChanges` 每条变更 `findAll()` 可放大为多次全库 `getFiles` | 只处理外部修改或加“每章 60s 冷却 + 新增 ≥300 字”；读取截断 6000 字；一次目录列表构建 `name→file` Map |
| W-8 | P2 | `scripts/check-hotpath-scans.mjs:23-68`、`shared/file-system-port.ts:284-297`、`ui/project-utils.ts:277-314` | 门禁只查 11 个文件的直接调用；`getChaptersForProject()` 单次 2 次全库遍历，阶段刷新可放大 4 次；`listFiles()` 已索引目录仍 `getFiles().filter` | 章节列表改目录遍历；`listFiles` 用 folder.children；门禁补间接 helper 或对 `file-system-port` 设白名单例外 |
| W-9 | P2 | `ui/co-writing-view.ts:597/3248-3343`、`ui/co-writing/monitor-cards.ts:221-320` | 每次守卫刷新全库 `getFiles()` 后整块 `empty()` 重建 5 张卡，展开态/滚动/焦点丢失 | 传目录列表或按章缓存 `name→TFile`；节点复用/文本 patch，数据未变不重建；目标保存路径 0 次全库扫描 |
| W-10 | P2 | `ui/chapter-outline-tree-modal.ts:129-1027`、`ui/full-writer/project-selector-controller.ts:830-881`、`ui/views/knowledge-base-view.ts:1104-1283` | 大纲树默认全展开、每章 5+ 监听；章节选择器一次建全部按钮；知识库搜索后全量重建卡片 | 默认只展开当前卷；编辑/拖拽局部 patch；选择器分页/窗口化；知识库首屏 100 本；目标 1000 章首开 DOM ≤1500 行 |
| W-11 | P2 | `tests/e2e/perf-smoke.spec.ts:24-101`、`ci.yml:115/158-184` | perf-smoke 默认 skip、CI 从不设 `E2E_PERF=1`；阈值宽松且无 onload/首屏/nodes 判定 | 独立 nightly/perf job 设 `E2E_PERF=1`；基线 JSON + 3 次中位数；增加命令注册 <1s、视图首开 <300ms、空闲堆增量 <80MB 门禁 |
| W-12 | P2 | `ui/full-writer/project-selector-controller.ts:261-560`、`ui/agent-workbench-view.ts:394-900` | 项目选择页对项目重复 `getProjectMeta`；Agent 文件树刷新清空路径缓存，`@` 输入重新全库 `getMarkdownFiles` | 复用 `metaOf`；`getProjectMeta` 按 path+mtime 会话缓存；`@` 缓存改增量索引 |
| W-13 | P3 | `services/writing-stats-service.ts:129-292`、`main.ts:1535-1581` | 首次 layoutReady 扫描和每次正文保存都读整章正文；frontmatter 的 `word_count` 仅作兜底 | 优先 frontmatter + mtime 校验；首扫分片/空闲执行并持久化；未结算正文才回退读盘 |
| W-14 | P3 | `package.json:79-92`、`eslint.config.mjs:12-44` | `wait-on` 零引用（39 包）、`vite` 无直接引用、`@typescript-eslint/eslint-plugin` 冗余；esbuild 0.25 与 vite 0.28 双版本 | 删除三个直接声明；esbuild 升 0.28 + overrides；lock 目标 ≤410 包 |
| W-15 | P3 | `shared/changelog-data.ts:1-5`、`shared/support-qr.generated.ts` | changelog 91 条全量内联；二维码 JPEG base64 膨胀 33% | changelog 保留最近 20 条（-42KB）；二维码 WebP/PNG8（-35KB）；模板 gzip（-45KB） |
| W-16 | P3 | `release.yml`、`check-release.mjs:120-146`、`workflows` | release 缺 `check:bundle/check:secrets/check:obsidian-api`；资产只有最小体积；Node 只锁 20、runner 浮动 | release 补三道门禁；资产加最大上限；Node 固定 20.x.y、runner 固定 ubuntu-24.04 |
| W-17 | P3 | `scripts/build.js:32-53`、`tsconfig.json:3` | esbuild target 未显式设置，与 ES2020/minAppVersion 1.4 脱节；未来默认 target 变化会静默改字节 | 显式 `target:['es2020']`、`sourcemap:false`，重跑基线并记录增量 |

## 三、已排除（复核后确认无问题）

| 项 | 证据 |
|---|---|
| 生产依赖 | `dependencies` 为空，esbuild metafile 无 node_modules 输入，main.js 仅 external `require('obsidian')` |
| main.js minify/charset/sourcemap | build.js 已 minify + `charset:'utf8'`，无 sourcemap 产物；node --check 通过 |
| 模板资源膨胀 | 56 文件 73,129B → 内联 76,234B（+4.2%），无字体资源 |
| CSS 外部资源 | 无 `@import`、无外部字体；精确重复规则块仅 695B |
| worker 间重复 | 两个 worker 共享字符串字面量 0，各自依赖不同引擎 |
| Actions 供应链锚定 | ci/release 的 Actions 均已 SHA 锚定；Dependabot 分组按月 |
| 知识库视图首开 | 书籍来自内存 Map，`onOpen` 只 `getAllBooks()`；网格渲染问题归 W-10 |
| 工作台首开 gatherAll | 无章节直接回项目页；有章节时受 5 分钟 TTL + 多层缓存 |
| 宠物动画/监控弹窗/SVG | 动画走合成层；监控 500ms 局部 patch；SVG 不反复读写布局属性 |

## 四、门禁与基线

- 本轮改了 `services/worker-manager.ts` 与单测，`preflight:release` 全绿；`main.js` 体积变化按 note 更新基线。
- W-3/W-4/W-5 涉及启动顺序、包体压缩与构建链，单批影响面大，留待专门批次；本轮不调整任何性能阈值。
- 下一维度：① Obsidian 生命周期/API 兼容（新一轮轮换起点）。
