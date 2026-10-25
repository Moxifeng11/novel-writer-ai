# AI Prompt 模板目录

本目录用于自定义各步骤的 AI 提示词。放在这里的模板**优先于插件内置默认模板**。

## 命名规则

每个步骤对应两个文件：

- `{stepKey}-system.md` — 系统提示词（角色设定、输出规范）
- `{stepKey}-user.md` — 用户提示词（输入素材、变量占位符）

例如：`bodyGeneration-system.md` + `bodyGeneration-user.md`。

## 快速开始

1. 复制本目录中的 `bodyGeneration-system.example.md` 为 `bodyGeneration-system.md`；
2. 按需修改内容（保留 `${变量名}` 占位符）；
3. 保存后立即生效，无需重启插件；
4. 在「设置 → 模板管理」中可看到该步骤的 `System ✓` 状态。

只提供 system 或只提供 user 也可生效，缺失的一半使用内置默认模板。

## 支持的 stepKey

| 分类 | stepKey |
|---|---|
| 步骤 | `infoPlan` `plotDistill` `outline` `bodyGeneration` `bodyGenerationV2` `selfCheck` `fix` `finalFix` `continuityCheck` `analysisReport` `qualityControl` `characterSoul` `emotionPlan` `sceneExpand` |
| 世界观/实体 | `worldviewSkeleton` `worldviewModule` `worldviewFallback` `settingLib` `fanficWorldview` `character` `faction` `location` `item` `batchCharacter` `batchFaction` `batchLocation` `batchItem` |
| DEAI | `deaiCheck` `deaiRewrite` `review` |

## 变量占位符

模板中可使用 `${变量名}`，运行时会替换为实际内容。常用变量：

`${chapNum}` `${chapName}` `${chapPlan}` `${outlineContent}` `${infoPlan}` `${distilledContent}` `${prevChaptersSummary}` `${worldView}` `${settingLib}` `${writingStyle}` `${allChars}` `${allFactions}` `${allLocs}` `${bodyText}` `${issues}`

## 注意事项

- 占位符必须使用 `${变量名}` 格式，否则不会被替换；
- 修改提示词会显著影响生成质量，建议先备份；
- 文件扩展名必须是 `.md`，且文件名严格匹配 `{stepKey}-system.md` / `{stepKey}-user.md`。
