# 自动交叉审计 · 维度④ 覆盖率盲区与测试契约

- 日期：2026-11-09
- 触发：无 Trae 消息（分支 B2）；上一轮为代码批次 B4，本轮按轮换做维度④
- 审计方式：**两个独立只读视角交叉取证**——A 视角读覆盖率产物 + 高风险路径映射（112 次工具调用）；B 视角审计测试契约、弱断言、门禁与 CI（89 次工具调用）。ZCode 对 P1 逐条复核，本轮修 3 项可锁定的测试/门禁缺口。
- 结论：**P1 7 项（本轮修 3 项）**、P2 8 项、P3 3 项；已排除 10 类「疑似问题」。**无 P0。**
- **交叉核对纠偏**：A 报「UI 聚合覆盖率 9.43%」，B 提到「pure-helpers 把 UI 从 5.97% 抬到约 12%」——后者是历史口径；以本轮 `test:cov` 的 9.43% 为准。两份报告都指向同一结论：UI 聚合阈值 10% 仍低于当前值，无法阻止新增整块无测试代码。

## 一、已修（本轮，P1，均带测试/可复跑）

| ID | 位置 | 问题 | 触发条件 | 影响 | 修法 |
|---|---|---|---|---|---|
| C-1 | `tests/e2e/lifecycle.spec.ts:25-105` | v4.80.0 清零运行时 `<style>` 后，测试仍以 `style[id^="novel-writer-"] === 0` 作为「样式回收」证据——该值任何时点都恒为 0 | 删除/破坏 `main.ts` 的 `disposeAll()` 或 ThemeManager 未注册为 disposable | `--nw-app-bg` / `--nw-panel-nav` 残留在 `documentElement`，禁用再启用后主题/布局串味，E2E 仍全绿 | 禁用后断言两个 CSS 变量为空；重新启用后断言非空（`theme-manager.test.ts` 只锁假 Map 记帐，补真实接线） |
| C-2 | `tests/e2e/full-journey.spec.ts:119-128`、`tests/e2e/utils/e2e-workflow.ts:437-441` | 导出 TXT 只断言「文件存在且 size > 0」 | 导出只写项目头/空章节，正文全丢 | 数据损失级回归无法被捕获 | 读取导出文件，取正文去标题后的前 40 字（忽略空白）断言必须包含；本轮实测导出正确 |
| C-3 | `scripts/check-obsidian-api.mjs:35/93-125`、`tests/unit/architecture/obsidian-api-policy.test.ts:133+` | ① `SCAN_DIRS` 不含 `utils/`；② `static-style-assignment` 用整行 `exclude /\$\{/`，同一行「静态赋值 + 动态模板」会漏报 | `utils/helpers.ts` 新增 console/fetch/内联样式；`el.style.color='red'; const x=\`${w}px\`;` | 社区目录 Error 类写法可绕过门禁；utils 是运行时目录且被 engine 大量引用 | ① 加入 `utils`；② 改为按命中片段判断 RHS 是否为字面量（含插值模板不报）；补 `utils/bad.ts`、同行混合、`createEl('style')` 夹具；闸门复跑 0 违规 |

验证：`obsidian-api-policy.test.ts` 9/9；`playwright --project=lifecycle` 2/2；`full-journey` 1/1；`check:obsidian-api` 全规则 0。

## 二、Fix queue（未修）

| ID | 严重度 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| C-4 | P1 | `ui/write-chapter-modal.ts:187`（`doWriteChapter`）、`:591/741-764`；`ui/command-ui-executor.ts:373-379` | 正文写入编排层 statements 0.2% / branches 0%；`chapter-generation-unify.test.ts` 只是源码字符串断言 | 抽可注入编排函数，fake App/vault/AIEngine 断言 BodyWriter 路径、abort、结算失败不标 settled、快照/ledger 各一次；另补 `ai-api-stream` SSE/取消夹具 |
| C-5 | P1 | `engine/settlement-engine.ts:534/668-681/1422-1490/935-1140`；`engine/mode-unit-settlement.ts`（0/22） | 结算回滚与 NEW_* 分支未验证；现有测试只覆盖一次部分回滚 | 多指令报告 + 按步骤注入写失败，断言 journal 逆序、`rollback.failed`、`snapshotIncomplete → rollbackFailed`、新建文件删除计数 |
| C-6 | P1（已修） | `engine/step-runner.ts:1346-1367`、`engine/quality/gate-snapshot.ts:87`（原 0/38） | 质量门禁装配从未在单测执行；内部 catch 只 log.warn | 已新增 `step-runner-quality-gate.test.ts`（调用一次/未通过不阻断/抛错仍完成）与 `gate-snapshot.test.ts`（5 例）；同时修正地点解析被全角 `｜` 污染的问题（`gate-snapshot.ts:99`） |
| C-7 | P1 | `engine/analysis-report-engine.ts:103/361/1209/1256/1354` | branches 7.25%（29/400）；报告解析后直接写多类实体文件 | fake-vault 覆盖每种 EntityChange/ForeshadowChange/TimelineEvent、字段映射、pending 不落盘、幂等重放 |
| C-8 | P1 | `.github/workflows/ci.yml:114-115/158-184`、`release.yml` | E2E 仅 `--list`，真实 job 依赖 `vars.OBSIDIAN_PATH`，发布流水线也不跑 E2E | 至少把 mock-AI 全旅程放进 tag 发布门禁；无 `OBSIDIAN_PATH` 时发布分支显式失败而非静默 skip |
| C-9 | P2 | `tests/e2e/utils/obsidian-app.ts:74-84`、`package.json:21` | E2E 使用预构建 `main.js`，不校验新鲜度 | `test:e2e` 先 `npm run build`，或比较 `main.js` 与 `main.ts/ui` mtime |
| C-10 | P2 | `engine/context-manager.ts:2478-2515`、`engine/foreshadow-manager.ts:871-925` | 整文件读改写 + 锁内重读无并发回归保护（context 23.5%，foreshadow 37.9%） | fake-vault 并发交错、删除后写失败、重复揭示不重复行 |
| C-11 | P2 | `ui/services/agent-port.ts:541-618`、`engine/agent/harness/host-tools.ts:728-766` | `delete_file`/`move_file` 真实执行端口 0% 覆盖 | fake adapter：默认回收站 vs permanent、非 TFile rename 回退、正文路径走 BodyWriter、路径穿越拒绝 |
| C-12 | P2 | `shared/settings-migrator.ts:246-280`、`engine/project-migration-service.ts:67-214` | 迁移失败分支与项目 plan/migrate 成功路径未测 | 版本断档/迁移抛错断言 `completed=false` 且不写 schemaVersion；项目迁移成功/部分失败/回滚 |
| C-13 | P2 | `engine/chapter-utils.ts:107-212/334-357` | legacy 章节文件迁移未测，误判会生成重复正文 | fake TFolder/TFile：裸名→标题化、目标已存在不覆盖、无法识别返回 null、幂等 |
| C-14 | P2 | `vitest.config.ts:19-40` | `coverage.include` 漏 `main.ts`、`utils/**`；`engine/**/*-worker.ts` 被整体排除（含真实 handler 分发） | 纳入或显式声明排除理由；worker 排除收窄到构建产物，handler 单独测 |
| C-15 | P2 | `vitest.config.ts:53-100` | per-glob 为聚合阈值且极低（ui 9/10/10/8），新增整块无测试代码仍可通过 | 引入 changed-lines/diff coverage 或新增文件 per-file 基线；聚合阈值保留兜底 |
| C-16 | P3 | `core/crypto-service.ts:328-330/342-344/358-359`、`ui/password-modal.ts` | v1 畸形密文/无口令回调/取消口令分支未测 | 补三例断言：返回原值 + 提示、无回调返回 null、会话口令走 decryptWithoutPrompt |
| C-17 | P3 | `tests/unit/ui/pure-helpers-coverage.test.ts:2407-2416`、`tests/unit/ui/smart-chart.test.ts:368` | 死语句/仅 `not.toThrow()` 的弱断言 | 删除死语句；断言渲染结果或回调副作用 |
| C-18 | P3 | `shared/validators/normalizers-entity.ts`（0/108） | 无调用方的未接线安全网 | 删除或接线后补测，不计入普通覆盖缺口 |

## 三、已排除（复核后确认无问题）

| 项 | 证据 |
|---|---|
| 写锁与正文落盘 | `shared/write-lock.ts` 100%，`engine/body-writer.ts` 96.89%/94.26%；4 个 body-writer 测试 + 并发写测试 |
| 导出构建器 | `manuscript-compiler` 98.59%、`epub-builder` 95.89%、`docx-builder` 100%、`zip-writer` 100%；E2E TXT/平台包覆盖 UI 链路 |
| 结算产物格式化 | coordinator 95%、journal 96.96%、report-parser 97.67%、markdown-table-utils 100% |
| settings 迁移正常链 | `settings-migrator` 90.21%，20+ 用例；空白仅在失败分支（C-12） |
| 路径原语 | `paths` 83.76%、`body-path` 95.65%、`file-path-guard` 98.61%、`project-root` 93.75% |
| Agent 核心循环/审批 | `agent-loop` 90.03%、`harness-engine` 92.68%、`tool-registry` 88.79%；空白在真实 destructive 端口（C-11） |
| 主写作 UI 运行时 | `full-writer-view`/`agent-workbench-view` 有 full-journey/obsidian-plugin E2E；问题是 E2E 非必跑（C-8） |
| 纯类型文件 | `agent-types`/`settlement-types` 等无运行时代码，exclude 合理 |
| `project-creation`/`project-card-interactions` skip | 显式 `describe.skip` 的旧浏览器用例，不会伪装通过 |
| `gate-snapshot` 误判 | 由 C-6 覆盖，当前不重复计 |

## 四、门禁与基线

- 本轮改了门禁脚本与 3 个测试文件，按流程跑 `preflight:release` 后提交；`check:css` 仅因新增上下文提示类 +111B 上调基线并写 note。
- 未调整任何覆盖率阈值；C-14/C-15 留待后续批次，避免本轮「用降阈值掩盖盲区」。
