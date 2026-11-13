# 项目标准（Project Standard）

> 对应代码：`shared/project-standard.ts`（类型门面）·
> `scripts/lib/project-standard-lib.mjs`（运行时单一实现）·
> `services/project-standard-service.ts`（校验门面）

## 1. 为什么需要「项目标准」

插件的历史约定散落在 `shared/paths.ts` 的 20+ 个 `pj*Dir` 函数里：各模块各自引用，
没有单一声明。后果是——

- 项目缺目录/缺文件时**没有任何地方会发现**，直到某个功能莫名失效；
- 本仓实踩：**没有章节摘要的项目**跑一致性审核得到 0 产出，用户会误以为"没问题"。

项目标准把这些约定收成一份**声明式**数据，并提供结构校验。

## 2. 标准内容（`PROJECT_STANDARD`）

| 项 | 内容 |
|---|---|
| 版本 | `version: 1`（`.project` 里用 `standardVersion: N` 声明） |
| 必备目录 | `01-世界架构/{人物,势力,地点,物品}`、`02-时间线与伏笔`、`03-大纲与章节/{正文,分卷大纲}`、`04-项目总控/{剧情记忆,故事台账}` 等 12 个 |
| 必备文件 | `.project` |
| 命名规范 | 正文 `第N章_正文.md`、摘要 `第N章_摘要.md` |
| 章节状态 | `draft` / `written` / `settled` |

**红线**：路径必须与 `paths.ts` 既有约定一致，不新造第二套目录结构。

## 3. 校验的 7 类问题

| kind | 严重度 | 含义 | 怎么修 |
|---|---|---|---|
| `missing-dir` | error | 缺必备目录 | 创建目录（初始化流程可自动） |
| `missing-file` | error | 缺必备文件 | 重建项目元数据 |
| `bad-naming` | warning | 文件命名不符规范 | 按规范重命名 |
| `digest-missing` | warning | 有正文无摘要 | 重新结算该章或补摘要 |
| `fact-store-invalid` | error | 事实库 JSON 损坏/结构非法 | 从备份恢复或删除后重建 |
| `fact-store-version` | warning | 事实库缺 version | 维护流程自动补齐 |
| `standard-outdated` | warning | 项目标准版本落后 | 补齐结构后更新 `.project` 的 `standardVersion` |

校验**只读**：只报告问题与修法，绝不自动修改用户文件。

## 4. 怎么跑

```bash
# 门禁（默认扫 vault 内所有带 .project 的项目）
node scripts/check-project-standard.mjs

# 指定 vault
node scripts/check-project-standard.mjs --vault "D:/小说工坊/小说工坊"

# JSON 输出（便于其他工具消费）
node scripts/check-project-standard.mjs --json

# 放宽 warning 数量上限
node scripts/check-project-standard.mjs --max-minor 50
```

退出码：`0` 通过（或 vault 内没有项目）· `1` 有 error 级问题或 warning 超限 · `2` 量具自检失败。

## 5. 与项目体检的分工

| 能力 | 层次 | 关注点 |
|---|---|---|
| `project-health-service` | 章节内容层 | 重复正文、未结算、坏 frontmatter、孤立正文 |
| **`project-standard-service`** | **项目结构层** | 目录/文件完整性、命名、摘要齐全、事实库完整性、标准版本 |

两者互补，建议在「项目体检」视图里并列展示。

## 6. 升级标准时怎么做

1. 改 `scripts/lib/project-standard-lib.mjs` 的 `PROJECT_STANDARD`（并递增 `PROJECT_STANDARD_VERSION`）；
2. TS 侧无需改动（`shared/project-standard.ts` 是门面，自动跟随）；
3. 老项目会被报 `standard-outdated`，按 detail 里的清单补齐；
4. 补 `tests/unit/services/project-standard-service.test.ts` 的对应用例。

**不要**在 TS 侧另写一份标准——那会立刻产生两套真相源。
