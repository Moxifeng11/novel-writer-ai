# 交接给 ZCode（2026-11-25，DSH → ZCode）

> 状态：活跃 · 2026-11-25
>
> 用户决定：**后续开发工作转到 ZCode 进行**。本文给 ZCode 交接所需的最小充分信息：
> 仓库实况、本会话交付了什么、还剩什么、为什么这么定、验证命令、以及踩过的坑。
> 先读 `PROJECT-RULES.md` 的 `HANDOFF` 块 + 本文，再领任务板。

## 一、当前状态（实测）

- **master = `44bb319b`**，与 origin 同步（ahead 0），工作树干净。
- **tag `4.97.5` = `5af05d1b`**；之后只有两个 docs 提交（`42ccf21a` 发版记录、`44bb319b` 第 171 轮台账），`manifest.json` 未再变，所以 tag 与市场版本仍然对得上。
- **版本 `4.97.5` / minAppVersion `1.8.7`**；`versions.json` 已含 `"4.97.5": "1.8.7"`。
- **Release 已验**：workflow run `45422725034` success；`npm run check:release:remote` 通过（四资产体积与本地一致、`main.js`/`styles.css` attestation 校验通过）。
- **preflight:release 全绿**：1024 个测试文件 / 10621 通过 + 3 跳过；覆盖率棘轮通过。
- **目录侧（唯一未完成项）**：`node scripts/check-published.mjs --expect 4.97.5` 仍 exit 1——
  - ✓ 客户端市场清单已收录 `novel-writer-ai`
  - ✗ 插件页 `Current version` 仍是 4.97.4（`Last updated` 停在 Nov 21）
  - ✗ RSS 最新仍是 4.97.4
- 任务板 `node scripts/board.mjs next --me zcode` 当前无任务（上一轮 ZC-20261120-28 为 failed，之前 23–27 均 done）。
- 信箱：DSH 侧未读 0；已给 `all` 发 4.97.5 发版摘要。

## 二、本会话交付（4 个代码提交 + 发版提交）

| 轮次 | 提交 | 内容 |
| --- | --- | --- |
| 167 | `6f6204e9` | 正文 11 步链路补齐 **V2 5 维风格注入**（新增 `engine/style/v2-feature-section.ts` 唯一实现，7 段后追加「V2 深化特征（量化）：」，受 `globalIntensity` 约束） |
| 168 | `d848153e` | **本章四项校验软聚合**：字数/格式/视角/钩子汇总为质量面板一章一档，正文保存后自动落盘 |
| 169 | `bb6eecdc` | **四项校验按磁盘正文重算**：面板「按磁盘正文重算」按钮，覆盖协同/场景循环/续写/修订路径 |
| 170 | `b8b83348` | **四项校验精度提升**：格式偏离给出行号定位；视角判定先剔除对话引号 |
| — | `5af05d1b` | **v4.97.5 发版**：上述内容随版发布；tag `4.97.5`；Release 资产齐全 |

### 2.1 四项校验的落点（接手改动前必看）

- 模型与文案：`shared/chapter-four-checks-model.ts`（`FourCheckReport`、`buildFourCheckReport`、`renderFourCheckReport`、`describe*` 文案；文案放 shared 是为绕开 `ui/**` 中文棘轮）。
- 落盘：`services/four-check-store.ts` → `<项目>/04-项目总控/质量面板/四项校验.json`（`{version:1, chapters:{章名:report}}`，最多 500 章）。
- 步骤 7 自动记录：`engine/step-runner.ts` 的 `runFourChecks()`，正文保存 + QualityGate 之后调用；只发诊断事件、不阻断。
- 按需重算：`engine/quality/four-check-refresh.ts` 的 `FourCheckService`（**放 engine 是因为 services 层禁止依赖 engine**）；入口 `main.ts#refreshFourChecks(project, chapterName)`；UI 在 `ui/quality-loop-modal.ts`。
- 钩子判定：`engine/quality-gate.ts#detectHookCoverage`（BeatVerifier 子短语口径）+ `engine/quality/gate-snapshot.ts#buildHookBeatFromVars`（从信息规划「章末钩子」构造 `type:'hook', required:false` 节拍）。
- 字数仍是唯一硬门禁：`engine/step-definitions.ts#postCheckWordCount`（`minWords = floor(baseWords * wordMinRatio)`，默认 ratio 0.70 见 `shared/thresholds.ts`）；格式/视角/钩子只警告。
- 格式基线：`shared/body-format.ts#analyzeBodyFormat`（`BodyFormatDeviation.samples` 最多 8 条行号）；真实写盘走 `engine/body-writer.ts` + `normalizeBodyText`。
- 视角判定：`engine/consistency/extended-rules.ts#detectPerspectiveMix`（first≥3 且 third≥3 且 min/max≥0.25；先 `stripDialogueSegments` 剔 `“…”/「…」/『…』`）。

## 三、还剩什么

### P0（唯一阻塞上架）：目录扫描没覆盖 4.97.5

原因：目录站 `community.obsidian.md` 需要在**登录状态**下点一次 `Check for new releases` 才会复审；
本机 DSH 内嵌浏览器面板（右侧「浏览器」标签）已打开到插件页，但站点显示 `Sign in`（会话已失效）。
4.97.4 的先例是发版后约 1.5 小时出现 Pending，本次等到约 1 小时 40 分仍未动，判断必须手动触发。

- 判据命令：`node scripts/check-published.mjs --expect 4.97.5`（三项全绿才算上架）。
- 操作口径：登录后在账号页/插件页点 `Check for new releases`；若返回「A scan has already been run」，说明扫描已在结果队列，隔几分钟刷新再看。
- **不要**用 `tests/tmp-*` 之类的临时脚本反复撞目录站；只认 `check:published` + RSS + 市场清单。
- 相关文档：`docs/releases/community-submission.md` §〇（4.97.5 发版记录）、§〇之三之一（UIA 点法，需要时用）。
- 若用户完成登录/触发，ZCode 只需复核三项并把 `community-submission.md` 的「目录扫描跟进中」改成结论。

### P1（正文质量线，候选）

1. **四项校验历史趋势**：现在质量面板只显示当前章一档（JSON 已按章存 500 条），可以加「最近 N 章字数/格式偏离/视角/钩子」列表或迷你趋势；数据已够，不需要新采集。
2. **`autoRevisionAfterQC` 与四项校验对齐**：目前自动修订只看 QualityGate 的 `passed`；可评估把「四项校验里 format/perspective warn 连续两章」纳入是否触发定向修订的判断（会改动自动行为，先给方案再动手）。
3. **P0-3 开关收益实验**（来自 `docs/planning/2026-11-16-next-focus.md` §P0）：`sceneLoopBodyGeneration` / `coWriteStructuredConstraints` 默认关闭，连跑 3 章对比人工评分与注入量，结论写 `docs/progress/`。

### 其他长期线索

- `docs/LONG-TERM-GOAL.md`：知识流/风格流/约束流任何一条断掉都会静默退化，长期主线是「可验证」。
- `docs/audits/generation-consumption-chain-audit.md` §七：四项校验落点与验收口径已记录，后续改口径先改这里。

## 四、关键决策与理由（别反着改）

1. **四项校验只警告、不阻断**：钩子不进 `requiredBeats`（`required:false`），否则 BeatVerifier 的 `missingRequired` 会让 QualityGate `passed=false` 并触发 `autoRevisionAfterQC` 自动修订，等于给正文链路新增阻断点。
2. **协同自动保存不逐次记录四项校验**：`ui/cowrite/body-save-controller.ts` 是 2 秒防抖，编辑中途的半章正文会把报告刷成噪音；改为面板按磁盘事实重算，覆盖协同/场景循环/续写/修订。
3. **V2 5 维默认开启、受全局强度约束**：`globalIntensity:0` 整段消失；7 段注入顺序与强度语义不变（ADR `docs/design/2026-11-21-style-fingerprint-v2-canonical.md` R3/R5）。
4. **正文落盘统一 `engine/body-writer.ts`，格式契约统一 `shared/body-format.ts`**；不要再新增第三条正文写入链。
5. **`engine/quality/four-check-refresh.ts` 必须留在 engine 层**（`scripts/check-dependencies.mjs` 禁止 services → engine）；要复用得走 engine。

## 五、验证与门禁命令

```bash
npm run preflight:release        # 发版级全量门禁（含 1024 测试文件）
npm run check:release:remote     # 远端 Release 资产/attestation 校验
node scripts/check-published.mjs --expect 4.97.5   # 目录上架三项判据
npm run check:prod -- --no-ai    # 生产冒烟（skip 不算通过，exit 1 是脚本严格）
node scripts/board.mjs next --me zcode            # 领任务
```

真跑单文件测试用 `node node_modules/vitest/vitest.mjs run <files>`（不要依赖 npx 包装）。

## 六、本会话踩过的坑（避免重复）

1. **services 层禁止依赖 engine**：重算服务最初写在 `services/`，被 `check-dependencies` 打回，最终落 `engine/quality/four-check-refresh.ts`，测试在 `tests/unit/engine/quality/`。
2. **`check:engines` 白名单是按类名后缀计数的**：`FourCheckStore` 需 `allowedInstances` 上调、`FourCheckService` 需新增条目（`.engine-registry-whitelist.json`）。
3. **`check:i18n` 基线可能陈旧**：曾出现 HEAD 实际 53 条但基线 52 条报「增长」；用 AST 逐字面量比对确认后修基线，别直接改代码。
4. **`ui/**` 中文字面量棘轮只许降**；新文案放 `shared/` 或走 `uiMessage` 自带兜底。
5. **JSDoc 必须紧贴导出**：中间插入新 interface 会把上一条注释抢走，`check:jsdoc` 能定位（`--list-missing`）。
6. **`check:docs` 漂移**：改了导出/文件行数后跑 `node scripts/gen-docs.mjs --write`。
7. **bundle 基线只降不升**：功能增量导致增大时必须 `--update-baseline --note` 显式上调并写清原因。
8. **coverage 基线与 gitHead 绑定**：`gitHead` 过期会拒比，按提示 `--update-baseline --allow-decrease --note`。
9. **`coverage/` 残留会让 `check:obsidian-review` 报 parsing error**：跑 preflight 前删掉 `coverage/`。
10. **`git commit` 多行消息在 PowerShell 里会被当字面量**：写临时文件用 `git commit -F`，提交后删掉；`git add -A` 前确认没有临时文件混入。
11. **目录站判据只认 HTTP**：`check:published` + RSS + 市场清单；UIA 读面板前必须先点「刷新」，否则读到旧 DOM。
12. **DSH 内嵌浏览器登录态**：本机当前是未登录（`Sign in`），别指望它保留会话；需要登录的动作交用户。

## 七、开工清单（ZCode）

1. 读 `PROJECT-RULES.md` 的 `HANDOFF` 块（版本/提交/ahead）与本文件。
2. `node scripts/board.mjs next --me zcode`；无任务就先按 §三 P0 复核目录状态。
3. 信箱 `read_messages({ unread_only: true, mark_read: true })` 看是否有同伴留言。
4. `git status` 确认干净；`node scripts/check-published.mjs --expect 4.97.5` 记录当前三项状态。
5. 如果用户已登录目录站：触发 `Check for new releases` → 三项全绿后更新 `docs/releases/community-submission.md` 结论行 + HANDOFF + 给 `all` 发摘要。
6. 如果还没登录：继续走 §三 P1/P0-3，别空等；目录状态变化是低频事件，不要轮询。

## 八、给 Trae / 其他方的说明

- 4.97.5 已发版且资产验证通过；客户端市场清单已收录，只是版本号/扫描未更新，属目录侧滞后，不是代码问题。
- 没有新增破坏性变更；minAppVersion 仍 1.8.7。
- 后续开发在 ZCode，DSH 侧如需继续由用户再指定。
