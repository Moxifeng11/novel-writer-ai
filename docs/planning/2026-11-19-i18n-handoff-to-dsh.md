# i18n 交接给 DSH（2026-11-19）

> 状态：活跃 · 2026-11-19
>
> ZCode 把剩余工作交给 DSH 继续。本文只写**交接所需的最小充分信息**：
> 现状、还剩什么、为什么留、下一步建议、以及我这轮踩过的坑（避免重复踩）。

## 一、当前状态（实测）

- **master = `948248e2`**，与 origin 同步（0/0），工作树干净
- **preflight EXIT=0**（986 测试文件 / 10,337 通过 + 3 跳过）
- 资源：zh-CN **3,989 条** / en-US **3,989 条**（键集双向相等由 parity 门禁保证）
- ui/ 中文棘轮：**226 文件 / 7,923 条**（基线已收紧到同值）
- 未打 tag、未发 Release

### 全仓 CJK 分布（`node scripts/audit-cjk.mjs --json`）

| 类别 | 文件 | 字符 | 处置 |
| --- | --- | --- | --- |
| corpus | 27 | 101,804 | 保留（词表/语料） |
| ai-prompt | 73 | 63,813 | 保留（喂模型） |
| **ui-copy** | **223** | **49,096** | **主要剩量** |
| cross-layer | 229 | 36,257 | 逐条已给结论（见审计报告） |
| on-disk-template | 10 | 21,476 | 保留（落盘模板） |
| enum-value | 38 | 9,738 | 保留（枚举值） |
| parse-key | 22 | 4,971 | 保留（解析锚点） |
| sink-contract | 31 | 3,256 | 保留（机检确认） |
| long-text | 6 | 3,088 | 保留（规则正文） |
| log-message | 45 | 2,398 | 保留（日志） |
| ui-copy-in-engine | 32 | 1,908 | 已达标（≤2,000），长尾 |
| disk-path | 13 | 1,506 | 保留（盘上路径） |
| structured | 5 | 985 | 已结构化（有 key 伴生） |

## 二、还剩什么

### 2.1 `ui-copy` 49,096 字 — 但**不是都该迁**

按实测 Top 8 逐个说明：

| 文件 | 字面量 | 真实情况 |
| --- | --- | --- |
| `ui/views/knowledge-base-view.ts` | 2,030 | **真该迁**，无 prompt/落盘耦合 |
| `ui/golden-opening-modal.ts` | 1,982 | **剩余绝大部分是保留项**：7 段 systemPrompt、题材数组、hookTypes、模板串。UI 已迁完 |
| `ui/views/book-detail-renderer.ts` | 1,206 | D 类，与知识库视觉重构耦合 |
| `ui/novel-tags-modal.ts` | 1,099 | **剩余是保留项**：sysPrompt 知识库（两套标签体系）+ 解析器锚点 |
| `ui/write-chapter-modal.ts` | 1,075 | C 类隐藏命令，**删除候选不迁** |
| `ui/knowledge-detail-modal.ts` | 1,035 | D 类，同上 |
| `ui/add-fanfic-setting-modal.ts` | 973 | **剩余是保留项**：4 段提示词 + 模板骨架字段 |
| `ui/generate-character-modal.ts` | 873 | **未评估**，需先甄别 |

**关键**：`ui-copy` 这个桶是「按文件判的」，不是「按字面量判的」。
一个文件被判 `ui-copy` 只说明它含 UI 文案，不代表它剩下的全是 UI 文案。
**逐文件复核是必须的，不能只看桶的数字。**

### 2.2 明确的剩余三类

| 类别 | 文件 | 字符 | 状态 |
| --- | --- | --- | --- |
| **C 类：隐藏命令弹窗** | `write-chapter-modal` / `batch-chapters-modal` / `auto-writer-modal` | ~1,676 | **删除候选，不迁**。删除前置条件四条见退役清单 §四，第 4 条是**用户明确同意** |
| **D 类：视觉重构耦合** | `knowledge-detail-modal` / `book-detail-renderer` | ~2,241 | 等知识库视觉重构 Slice A–Y |
| **未评估** | `knowledge-base-view` / `generate-character-modal` 等 | ~3,000+ | 需先跑甄别 |

## 三、下一步建议（按性价比排序）

### 建议 1：先跑一遍甄别，不要直接派单

```bash
node scripts/audit-cjk.mjs --json            # 出分布
node scripts/audit-cjk.mjs --json --out=x.json
```

理由：我这批实测发现，按「含注释字符数」排出来的重活（`monitor-panel-b` 2,961）
实际迁移量只有 926；而 `novel-tags-modal` 1,099 字里只有 11 处是 UI。
**数字大的文件不一定是活多的文件。**

### 建议 2：`knowledge-base-view.ts`（2,030）值得优先

它是剩余 `ui-copy` 里唯一「大头且确认该迁」的。建议先核三件事再动手：
1. 有没有 prompt 构造？（有则那部分保留）
2. 有没有落盘/解析耦合？（有则拆 key）
3. 有没有 `internalOnly` 命令入口？（有则考虑 C 类处理）

### 建议 3：C 类删除需用户拍板，不要自行决定

`write-chapter` / `batch-chapters` / `auto-writer` 三个弹窗对应的命令都是 `internalOnly`
（不在面板）。技术上可以删，但**第 4 条前置条件是「用户明确同意」** —— 这条我和你都不能定。

建议做法：把三个文件的实际状态（不可达 + 中文界面 + 已无替代缺口）整理给用户，
让用户决定「删」还是「留着不迁」。

## 四、判据与工具（交接的核心资产）

### 4.1 保留判据 v2（`docs/modules/i18n.md` §8）

五条判据 + 默认动作 + 三方分工 + 参数插值规则。**新任务必须先读这一节。**

要点速记：
- ①落盘即契约 ②喂模型即行为 ③匹配即锚点 ④外部消费者 ⑤**双消费者拆分**
- 第 ⑤ 条最重要：同一串既给人看又给机器读 → **必须 key + 原值并存，禁止二选一**
- 边界不清时：保留原值 + 增加展示键，**不删原值**（错误方向不对称）

### 4.2 工具

| 工具 | 用途 |
| --- | --- |
| `scripts/audit-cjk.mjs` | 体检：分类统计。`--json` / `--md` / `--min=N` |
| `scripts/audit-cjk.mjs --check` | 门禁：未声明/灰区增长则 exit 1（已进 preflight） |
| `scripts/cjk-keep-allowlist.json` | closed set：`keep` 段声明保留，`triage` 段登记待迁 |
| `scripts/check-i18n.mjs` | 门禁：ui/ 棘轮 + 键集双向 + 占位符一致 |

### 4.3 退役清单（`docs/planning/2026-11-19-legacy-modal-retirement.md`）

`RETIRE-A1`..`RETIRE-D2`，13 个文件全部有编号。**grep `RETIRE-` 就能找到所有欠账。**

## 五、我这轮踩过的坑（避免重复）

都写进了 `docs/planning/2026-11-18-i18n-slice-playbook.md` §4.3，这里摘要：

### 坑 1：迁移脚本先写盘再 exit(1)，留下半套改动

症状：调用点和 import 改了、实现体没改，tsc 与单测全绿，实机才暴露。
**安全写法**：先收集全部 MISSING → 有缺就不写盘。

### 坑 2：`dev-vault sync` 的盘符被 shell 吃掉

Git Bash 下 `--vault=D:\nw-dev-vault` 会变成相对路径，产物落进仓内 `nw-dev-vault/`，
脚本仍报「同步成功」。**必须写 `D:/nw-dev-vault` 正斜杠 + `md5sum` 比对。**

### 坑 3：批量改写时「标识分配」与「文本替换」遍历顺序不一致

golden-opening 第一版：收集正序、生成 key 倒序递增 → `k1` 落到文件最后一个字面量，
**全部文案错位**。**安全写法**：key 分配只看正序位置，替换倒序只为偏移安全，两者解耦。

### 坑 4：前缀正则批量改键名不限定作用域

`dim([A-Z]\w*):` 误伤 `dimSamplesLabel` / `dimPendingDesc`。
**确认是自己引入的方法**：`git stash` 对比基线。

### 坑 5：AST 批量改写要用「残留行数」复核，不能只看「迁移条数」

golden-opening 第一版漏了 14 条 `new Notice` + 3 条三元嵌套分支 —— 因为
AST 按 `getStart()` 偏移定位，多行语句与嵌套三元会失准。
**只看迁移数不看残留数，会漏掉整类。**

### 坑 6：资源里混数据（犯过两次）

- ⑫：`constraint-block-service` 把喂 LLM 的约束块判成 UI 文案
- ⑲：`pre-research` 文案嵌了盘上目录名 `00-前期调研/`，守住判据① 但破了 parity 门禁

**统一解法**：资源只放给人看的语言部分，**数据由调用方以参数注入**。

## 六、协作约定提醒

- 任务板：`node scripts/board.mjs next --me dsh`；完成后 `done <id> --me dsh --evidence "..."`
- 每个迁移任务一文件一提交（便于回滚与复核）
- 提交前 `npm run preflight`（33 道门禁），EXIT=0 才算完
- 基线只允许下降；确需上调必须 `--update-baseline --note "原因"`
- `tag` / `Release` 需用户确认；`git push` 已放行
