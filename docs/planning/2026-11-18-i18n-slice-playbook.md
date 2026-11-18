# i18n 第二期「切片」作业手册（2026-11-18）

> 状态：活跃 · 2026-11-18
>
> 面向接手的 agent（当前指派给 ZCode）。目标：把 `ui/**` 里剩余的中文界面文案迁到
> `t()` + 双语资源，一片一提交，模板固定、步骤固定，照做即可。
> 规范正文见 [docs/modules/i18n.md](../modules/i18n.md)（决策、坑、backlog 都在那里）。

## 1. 一句话流程

**测量 → 迁移 → 双语资源 → 单测 → 构建+同步+实机 zh/en 截图 → 文档四处 → 三份基线 → gen:docs → preflight → 提交推送 → handoff + 信箱**

## 2. 开工前必读

- `docs/modules/i18n.md` 的 §4（决策）与 §8（交接备注）——所有踩过的坑都在里面。
- `docs/planning/2026-11-16-next-focus.md` 末尾 3~4 轮（第六十四~六十七轮）是本工作流的完整实例。
- 设计硬约束：**不得新增裸中文**（`check:i18n` 棘轮会拦）、zh/en 键与占位符逐字一致、
  en 资源**不允许出现 CJK**（`tests/unit/i18n/i18n-parity.test.ts` 硬拦，占位例句也算）。

## 3. 逐片步骤（以 `ui/settings/setup-section.ts` 为例）

### ① 测量
```powershell
node D:\nw-tmp\list-cjk.cjs ui/settings/setup-section.ts   # 逐行中文，区分注释/文案
```
若无该脚本：`Select-String -Path <file> -Pattern '[\u4e00-\u9fff]'` 也能看，
但要注意注释行（`//` `*` `/*`）不算文案，别迁注释。

### ② 迁移
- `import { t } from '@/i18n';`（需要语言分支时再 `getLocale`）。
- 文案一律 `t('<命名空间>.<camelCase 键>')`；插值用 `{name}`，不要拼字符串。
- 取消/刷新/关闭等通用词复用 `common.cancel` / `common.refresh` / `common.close`。
- **数据表里的文案改成键字段**（`labelKey`/`descKey`/`nameKey`），渲染时求值——
  不要把 `t()` 的结果预先算进模块级常量或缓存对象。
- 大文件（>500 行）用仓外脚本做精确串替换：`D:\nw-tmp\migrate-*.cjs` 的写法是
  `[[old,new],…]` 逐条 `if(!s.includes(old)){console.error('MISSING: '+old)}`，某条没命中就非零退出；
  **CRLF 文件的多行 old 串必须带 `\r\n`，长串先替换**。

### ③ 双语资源
`i18n/messages/zh-CN.ts` 与 `en-US.ts` 同步加键。检查：
```powershell
npm run check:i18n     # 键集合/占位符双向一致、0 无法解析键；不通过就别往下走
```

### ④ 单测
在既有测试文件里加一个 `describe('…双语（缺口⑦ 第二期第 N 片）')`，至少覆盖：
- zh 渲染出原文案（可用 `container.allText()` 断言）；
- `setLocale('en-US')` 后全英文、且**不出现 `<命名空间>.` 键名回退**（漏配键会显示键名）；
- `afterEach` / `afterAll` 里 `setLocale('zh-CN')` 复位。

坑：`@/main` 在 vitest 里会命中构建产物 `main.js`（报 `Cannot find module 'obsidian'`），
共享常量要走 `@/shared/xxx` 直路径；`vi.mock` 会提升，静态 import 被测模块是安全的
（也是 `check:view-tests` 想要的）。

### ⑤ 实机截图（必做，zh + en 各一张）
```powershell
npm run build
node scripts/dev-vault.mjs sync --vault=D:/nw-dev-vault     # 正斜杠！D 盘 vault 是拷贝，不是 junction
Copy-Item D:\nw-tmp\snap-i18n10.mjs D:\nw-tmp\snap-i18n<N>.mjs
#   改 outDir（D:/nw-dev-vault/_visual-i18n<N>）与 targets: [['<tabId>','<文件名>']]
node D:\nw-tmp\snap-i18n<N>.mjs zh-CN
node D:\nw-tmp\snap-i18n<N>.mjs en-US
# 同步后必须自己验一次，别信脚本的「同步成功」：
md5sum main.js D:/nw-dev-vault/.obsidian/plugins/novel-writer-ai/main.js
```
脚本流程：写开发 vault `data.json` 的 `language` → 独立 userData 启 Obsidian → 信任仓库 →
主窗口 `settingsTab.openTab(id)` → 设置窗口按 `.modal-container` 裁剪截图 → 探针统计 CJK 与键名回退。
**等待条件要写成 `p.settings && p.settingsTab`**（等插件对象出现就读 settings 会偶发
`Cannot read properties of undefined (reading 'language')`）。

验收口径：en 图里 **CJK 只允许剩 vault 数据**（书名/项目名/用户词表）；界面上出现
`settings.xxx.yyy` 字样 = 漏配键，必须修。

### ⑥ 文档四处
1. `docs/modules/i18n.md`：§1 加本片入口、§2 资源总数/命名空间/片次链/已迁移面/未迁移面、
   §3 I18N-05、§4 新决策（有就写）、§5 三行验收（门禁/单测/实机）、§6 测试与截图脚本、
   §7 勾掉本项并按需新增 backlog、§8 新坑。
2. `docs/modules/INDEX.md` 的 i18n 行（键数、棘轮数字、下一轮候选）。
3. `docs/CURRENT.md` §2/§4 的 ⑦ 状态；`docs/planning/2026-11-18-feature-gaps.md` 的 ⑦ 小节 + 「进度」段。
4. `docs/planning/2026-11-16-next-focus.md` 追加「第 N 轮」（**追加到文件末尾**，
   新轮次都在尾部；第六十四~六十七轮是模板）。

### ⑦ 三份基线（只降不升，涨了必须在 note 写原因）
```powershell
node scripts/check-i18n.mjs --update-baseline
node scripts/check-bundle.mjs --update-baseline --note 'i18n 第二期第 N 片：<分区> N 键进包'
node scripts/check-view-tests.mjs --update-baseline --note '…'   # 只有「已补测试/新增测试」时才需要
```
`check:css`/`check:bundle` 的 note **只从 `--note` 参数取**，positional 会被忽略（本仓踩过）。

### ⑧ 门禁与提交
```powershell
npm run gen:docs          # 必跑：check:jsdoc 会重写 docs/generated/jsdoc-coverage.md，顺序反了 check:docs 会报漂移
npm run preflight         # 必须 EXIT=0；日志写 D:\nw-tmp\preflight-i18n<N>.log
```
提交信息写仓外文件再 `git commit -F`（多行中文用 here-string 容易坏）：

```powershell
# 先把信息写到 D:\nw-tmp\msg-<slug>.txt，再：
git add -A; git commit -F D:\nw-tmp\msg-<slug>.txt; git push
```

### ⑨ 交接
```powershell
node scripts/handoff.mjs --from zcode --stage "…" --delivered "…" --doing "…" \
  --next-zcode "…" --next-trae "…" --next-dsh "…" --ask "无"
```
再给 `all` 发一条信箱摘要（`send_message`，只写改动/坑/下一步，不贴大段正文），
最后 `node scripts/board.mjs done <id> --me zcode --evidence "commit abc; 测试 N 条通过"` 收任务。

## 4. 队列状态

### 4.1 第一批（已完成，2026-11-18 由 ZCode 交付）

设置分区 5 片（setup / foreshadow / mode / mcp / agent）、写作指纹库视图链、写作工作台全链路、
协同写作全家族、`ui/full-writer/` 长尾、外观页统计与桌宠——共 **19 个任务 / 22 次提交**，
资源 zh/en 各 2958 条，棘轮 261 文件 / 10732 条 → 226 文件 / 8569 条。
`ui/` 界面层文案已收口，剩余 CJK 均为数据或跨层专项。

### 4.2 第二批：跨层数据专项（ZC-20261120 系列）

先甄别后迁移；三条保留判据：**落盘即契约 / 喂模型即行为 / 匹配即锚点**。
「保留」必须写进 `scripts/cjk-keep-allowlist.json`（closed set），口头豁免无效。

| 顺序 | 任务 | 目标 | 要点 |
| --- | --- | --- | --- |
| 1 | ZC-20261120-09 | `scripts/audit-cjk.mjs` | sink 检测 + 保留白名单 + `--check` 非零退出（先做，兜住后面所有迁移） |
| 2 | ZC-20261120-01 | `domains/{long,short,script}/tool-catalog.ts`、`domains/kernel/tool-catalog-aggregator.ts` | `labelKey/descKey` + 求值函数；工具 id/commandId 不动 |
| 3 | ZC-20261120-02 | `shared/creation-flow.ts` | 阶段名：稳定标识保留，展示名求值；单测证明 zh/en 流程推进一致 |
| 4 | ZC-20261120-03 | `shared/link-status-compute.ts` | 见 07：key 为唯一真源 |
| 5 | ZC-20261120-04 | `shared/novel-format.ts` | separator/indent 是结构数据，绝不翻译（见 08） |
| 6 | ZC-20261120-05 | `ui/co-writing-view.ts` | 保存状态串枚举化；`:3360` 的 `toggleClass` 比较禁止再拿中文比 |
| 7 | ZC-20261120-06 | `scripts/audit-cjk.mjs` + `docs/audits/` | 全仓 CJK 分类盘点报告 |
| 8 | ZC-20261120-07 | `shared/link-status-compute.ts` | 删中文双份字段；`formatLinkStatusForAgent()` 固定 zh 求值 |
| 9 | ZC-20261120-08 | `shared/novel-format.ts` | 展示串要给出**实际字符**（`\n\n`、`\u3000\u3000`） |
| 10 | ZC-20261120-10 | `docs/planning/` | 11 个旧弹窗退役清单（替代者 + 下线里程碑） |
| 11 | ZC-20261120-11 | `shared/ui-message.ts` + 3 个 engine 代表文件 | `{code, params}` 契约 + `resolveUiMessage()`；保留 string 兼容 |
| 12 | ZC-20261120-12 | `engine/` | 按域批量迁移 `ui-copy-in-engine`，每域一提交 |

做完一片再领下一片；不要在同一片里顺手改别的分区（写范围锁 + review 成本）。

## 4.3 两条硬规矩（2026-11-19 踩过才写）

1. **迁移脚本必须先 dry-run，命中率 100% 才写盘。** 只有「先 `writeFileSync` 再 `process.exit(1)`」
   的写法会留下半套改动：调用点和 import 改了、实现体没改，tsc 与单测全绿，实机才暴露
   （第 ⑤ 片就是 en 界面直接显示英文枚举名）。安全写法：先收集全部 `MISSING` → 有缺就退出不写；
   或写盘前 `JSON` 之外再加一次「本轮命中数 === 期望数」断言。
2. **`dev-vault.mjs sync` 的盘符会被 shell 吃掉。** Git Bash / MSYS 下 `--vault=D:\nw-dev-vault`
   可能变成相对路径，产物同步进仓内 `nw-dev-vault/`，脚本仍报「同步成功」，实机跑的旧 bundle。
   统一写正斜杠 `D:/nw-dev-vault`，并在截图前 `md5sum` 比对仓内与 vault 内 `main.js`。

## 5. 明确不要做的事

- 不要迁**数据**：书名、项目名、用户词表、主题名（`shared/theme-gallery.ts`）、
  思考等级/预算档位（`THINKING_LEVELS`/`BUDGET_TIERS`，见 i18n.md §7 的 backlog）。
- 不要把 `t()` 放进模块级常量、构造时求值的缓存、Obsidian `addCommand` 名字以外的注册表
  （命令名只接受「重启后生效」，见 §4 决策）。
- 不要为了过门禁上调基线而不写 note；不要跳过 preflight 直接 push。
