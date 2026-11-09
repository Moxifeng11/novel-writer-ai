# 自动交叉审计 — 依赖 / 包体 / 性能 / 首屏 ⑤

> 日期：2026-11-10 · 基线：`64600c6` · 维度：⑤ 依赖/包体/性能/首屏
> 方法：两个独立视角并行取证（① 依赖与包体/release 资产；② onload/保存热路径/首屏），交叉核对后合并。
> 本轮修复：**依赖卫生 P1 已修**（幽灵依赖 + wait-on + CI permissions），回归门禁 `dependency-hygiene.test.ts` 已实跑。台账第 16 轮。

## 一、Findings

| # | 级别 | 位置 | 问题 | 触发条件 | 影响 | 状态 / 修法 |
|---|---|---|---|---|---|---|
| DH-1 | **P1** | eslint.config.mjs:20-21 + package.json | `eslint-plugin-no-unsanitized`、`@microsoft/eslint-plugin-sdl` 被 lint 配置直接 import，但未声明（靠 obsidianmd 插件传递提升）；`wait-on` 全仓 0 引用仍占位 | npm 提升策略变化 / 干净 clone / npm ci 严格模式 | **`npm run lint`（Obsidian 市场审核规则载体）断裂 → 审核门禁失效** | **本轮已修**：按提升版本精确声明（no-unsanitized@4.1.5、sdl@1.1.0）、移除 wait-on（lockfile -254 行）；回归门禁 `tests/unit/architecture/dependency-hygiene.test.ts`（3 条：裸 import ⊆ devDependencies、wait-on 不回潜、ci.yml 顶层 permissions） |
| DH-2 | P1→P2 | ci.yml（无 permissions 键） | GITHUB_TOKEN 落仓库默认权限，过宽 | CI 运行 | 供应链攻击面 | **本轮已修**：顶层 `permissions: contents: read`（release.yml 早已最小化，不受影响） |
| DH-3 | P2 | package.json:38 `audit:deps` | `npm audit --omit=dev --audit-level=high` 在「零 dependencies」架构下审计集合恒空 → 结构性永不可能失败；dev 侧历史 advisory（esbuild/vite/playwright）全被排除 | 每次审计 | 「生产依赖安全审计」是正确的空 assurance，但名不符实 | 未修 → fix queue。建议：改全量 audit + 显式豁免清单，或改名 `audit:prod` 注明空集合语义（改全量可能立刻红，需逐条豁免，不宜本轮做） |
| B-1 | P2 | .bundle-baseline.json | main.js 4,933,425 B = 5MB 自设目标的 94.1%，余量 302KiB；B3-B8 一次性 +61KB 后微批速率 ~2.2KB/日，中性估计 2-4 个月触线 | 继续按批加功能 | 触线后需大规模拆包/压缩 | 未修 → fix queue（优先项：esbuild minify 评估——当前构建未压缩，一改即 -40%+，但需评估栈帧可读性） |
| B-2 | P3 | workers/ 发布口径 | 勘误 2026-11-09 审计 W-2：workers **在 zip 内**（release.yml:90），三文件直装时才缺失，且有两级守卫优雅降级（Notice + 握手期 error 监听）——是文档化取舍非缺陷 | 三文件安装（社区市场路径） | 大文档拆解/质检回落主线程卡顿 | 非缺陷，维持现状；如要根治需 worker 内联 Blob 或市场诉求变更 |
| B-3 | P3 | styles-src 26 文件 | 同一 selector 散落多文件靠级联顺序生效：`.nw-scope`×56、`.novel-writer-fw-workspace`×34、`.nw-create-project-modal`×31 | CSS 重构/审核 | 脆弱点（与历史层叠审计一致） | 未修 → 既有 CSS 分批重构批次处理 |
| W-3 | P2 | main.ts:770-840 | onload 串行部分修复：embedding 探测/模板脚手架已异步化；仍剩 ① engine-registry 四个 manager init 串行可 Promise.all（engine-registry.ts:1384-1387）；② 命令/视图注册（:840/:898）被 settings/cache 加载挡住 | 冷启动 | 首次可用延迟 | 未修 → fix queue（改动面 >50 行） |
| W-7 | P2 | main.ts:1794-1840 + co-writing-view.ts:369-380 | 保存→实体重检部分修复：哈希/冷却闸门已加，但**每次实质保存仍触发 1 次 AI 实体检测**（main.ts 路径无冷却），另监控卡渲染每次最多 5 次 `app.vault.getFiles()` 全库数组构造（monitor-cards.ts:221 + co-writing-view.ts:3201） | 每 2s 防抖保存 | AI 成本 + 热路径 O(全库) | 未修 → fix queue（main.ts 路径加冷却闸门 ≈ 对齐 live-analysis；monitor-cards 单次快照传入） |
| W-8 | P2 | scripts/check-hotpath-scans.mjs:23-35 | 门禁白名单 10 模块 0 违规，但白名单外保存/落盘热路径仍有全库扫描：monitor-cards.ts:221、entity-state-manager.ts:356/496（回退）、chapter-state-snapshot-service.ts:50/65（每章落盘）、foreshadow-manager.ts:115/133（modify 800ms）、title-bar-controller.ts:66（每次 renderInContainer 重复 detectProjects） | 见各触发 | 热路径 O(全库) | 未修 → fix queue（先把 W-7/快照/monitor-cards 纳入白名单或修掉，再扩门禁） |
| W-9 | P3 | metrics-panel.ts:161、monitor-cards.ts:317、step-render-controller.ts:113、full-writer-view.ts:1831 | empty+全量重建 DOM 模式仍成立（保存链与步骤切换） | 每 2s 保存 / 每次点步骤 | 渲染抖动 | 未修 → fix queue（增量渲染改造，大改动面） |
| W-10 | P3 | chapter-outline-tree-modal.ts:130 | 大纲 Modal 默认全卷全章展开 | 打开 Modal | 打开延迟（非首屏） | 未修 → fix queue（默认折叠首卷） |
| S-1 | P3 | onOpen（full-writer-view.ts:994-996） | 热重载恢复链 restore→loadContext→render 三段串行（前两者可并行）；full-writer-view.ts:1840-1842 上下文未就绪时二次 gatherAll；title-bar 每次 renderInContainer 重复 detectProjects | 打开工作台 | 首屏延迟 | 未修 → fix queue（与 W-3 同批） |

## 二、已排除项（交叉确认）

- **B-2/W-2 勘误**：workers 在发布 zip 内（release.yml:90），check-release.mjs:158-172 反向禁止 workers 成为独立资产（社区目录规范），SHA256SUMS 覆盖 worker 产物——2026-11-09 审计 W-2 描述「workers 缺席发布」不准确，降级为文档化取舍（三文件安装降级路径有 Notice + 握手守卫）。
- **styles.css 基线勘误**：盘上 551,489 raw ≠ 基线 550,923 是 566 个 CRLF 混入，check-bundle 的 lfBytes 口径下精确一致，门禁真实通过。
- **零运行时依赖成立**：package.json 无 dependencies 字段，main.js 内 `require(` 仅 obsidian ×206——无第三方可裁。
- @typescript-eslint/eslint-plugin（经 typescript-eslint 元包转发）、@vitest/coverage-v8（provider:v8 按名解析）、@types/node（tsconfig types）均不可删。

## 三、本轮实跑结果

- `npm install`：幽灵依赖按提升版本精确落盘（no-unsanitized@4.1.5 / sdl@1.1.0），wait-on 连带剪枝（lockfile -254 行）。
- `tests/unit/architecture/dependency-hygiene.test.ts`：3 条全过；`npm run lint` 0 error（新声明插件与提升版本一致，lint 行为零变化）。

## 四、待用户拍板项

- **DH-3（audit:deps 结构性空转）**：改全量 dev audit 可能立即暴露历史 advisory 并使 preflight 变红，需要逐条豁免清单——是否接受一次性成本？本轮未动。
- **B-1（main.js 触 5MB 自设线）**：是否启用 esbuild minify（预计 -40%+，但产物不可读/栈帧难定位）？属发布策略，待拍板。
