# 12 · 模板流转全生命周期

> 目标：模板从「文件/内置常量」到「实际发给模型」只有一条可追踪链路。
> 契约实现：`engine/prompt-resolver.ts`、`engine/template-service.ts`、`shared/template-scaffold.ts`。
> 相关门禁：`tests/unit/shared/template-flow.test.ts`、`tests/unit/engine/prompt-resolver.test.ts`。

---

## 1. 模板分类与唯一来源

| 类别 | 来源 | 消费者 |
|---|---|---|
| 内置步骤提示词 | `engine/prompts/*`（`getStepTemplate` / `getStepTemplateAuto`） | `resolveStepPrompt` |
| vault 步骤提示词 | `元文件/00-系统模板/prompts/<step>-system.md` / `-user.md` | `TemplateService.getStepPrompt` |
| 用户覆盖 | `settings.promptManagerConfig.customTemplates` → `vars._stepOverrides` | `resolveStepPrompt` |
| 章节/步骤文件骨架 | `元文件/00-系统模板/*模板.md`；缺文件时用 `assets/template-scaffold` 生成物 + 骨架 frontmatter | `TemplateService.getTemplate` |
| 写作规则 | `元文件/00-系统模板/写作规则.md`（唯一） | `RulesService` / `BodyWriter` / 上下文 |
| 创作模式/实体提示词 | 同 vault `prompts/` 目录，键见 `TemplateService` | 实体/世界观生成器（下一批接入统一 resolver） |

**优先级固定为：vault 自定义 > 用户覆盖 > 内置。**
任何执行器不得自己拼第二套；新增步骤必须走 `resolveStepPrompt`。

---

## 2. 生命周期节点

```
加载 load
  ├─ 内置：engine/prompts/* 常量（构建期进 bundle）
  ├─ vault：vault.getAbstractFileByPath + vault.read（无缓存，读到即最新）
  └─ 用户覆盖：vars._stepOverrides（JSON）
        │
解析 parse
  ├─ TemplateService.hasCustomPrompt 判断 vault 是否存在
  ├─ getStepTemplateAuto 选择正文 V1/V2/V3/V4
  └─ renderTemplate 渲染 ${var} 与 {{var}}，记录 unresolved
        │
渲染 render
  ├─ system / user 同时填充
  ├─ unresolved 非空 → 警告（不静默发送）
  └─ 返回 source / templateId / templateVersion / templateHash
        │
传递 transmit
  ├─ StepRunner / 批量 / 继续生成：写入 textarea
  ├─ 一键合并规划：若 5 个规划步骤有自定义模板 → 自动切换分步执行
  └─ 步骤结果 frontmatter：step_template_id/version/hash + step_rules_version/hash
        │
缓存 cache
  ├─ TemplateService：不缓存提示词文件（每次读，模板修改立即生效）
  ├─ RulesService：5 秒 TTL，按 project 分键（模式附录不串项目）
  ├─ BodyWriter 格式契约：vault 规则 mtime+size 指纹
  └─ AI 响应 PromptCache：按 prompt hash 缓存；onunload 清空
        │
销毁 destroy
  ├─ 模板本身无状态，无需销毁
  ├─ onunload：getPromptCache().clear() + RulesService.resetInstance()
  └─ 视图关闭：清空 prompt 编辑器/挂起请求
```

---

## 3. 统一入口 API

```ts
const resolved = await resolveStepPrompt(app, stepKey, vars);
if (!resolved) throw new Error(`缺少步骤模板: ${stepKey}`);
systemPromptEl.value = resolved.systemPrompt;
userPromptEl.value = resolved.userPrompt;
```

- `resolved.source`：`vault` / `user-override` / `builtin`。
- `resolved.templateId`：正文会返回实际的 `bodyGeneration.v2/v3/v4`，不再是固定 V1。
- `resolved.templateHash`：实际渲染文本的哈希，写入 `step_template_hash`。
- `resolved.unresolved`：未替换变量；调用方必须提示/记录，不能静默发送。

---

## 4. 模板文件变更后的行为

| 操作 | 生效范围 |
|---|---|
| 编辑 `元文件/00-系统模板/prompts/bodyGeneration-system.md` | 单步、批量、继续生成、合并规划（触发分步）立即生效 |
| 编辑 `元文件/00-系统模板/prompts/emotionPlan-*.md` | 情绪规划特例生效 |
| 编辑 `元文件/00-系统模板/prompts/sceneExpand-*.md` | Scene 特例生效 |
| 编辑 `元文件/00-系统模板/prompts/infoPlan-*.md` | 合并规划检测到自定义 → 自动改分步执行 |
| 清空某个模板文件 | `TemplateManager` 保存空内容会删除覆盖文件，回退内置 |
| 修改写作规则 | 正文格式契约（BodyWriter）与提示词规则块同时更新（vault 唯一来源） |

---

## 5. 缓存与失效

- **模板文件不缓存**：`TemplateService.getStepPrompt/getCustomPrompt/getTemplate` 每次 `vault.read`。
- **RulesService**：TTL 5 秒；`getWritingRules(project?)` / `getRulesConfig(project?)` 显式传 project，缓存键含项目，避免 A 项目模式附录污染 B 项目。
- **BodyWriter 格式契约**：读 `VAULT_RULES_PATH` 的 mtime+size；规则改了下一次写入自动重算。
- **PromptCache**：只缓存非流式响应；`onunload` 清空，避免热重载后带着旧整章文本。
- **StepRunner 归因**：`promptMetaByStep` 记录实际发送文本的 hash 与模板版本；保存步骤结果时写 frontmatter。

---

## 6. 新增模板/步骤的检查表

- [ ] 模板文件命名遵循 `<stepKey>-system.md` / `<stepKey>-user.md`。
- [ ] 步骤执行器只调用 `resolveStepPrompt`，不直接 import `engine/prompts/*`。
- [ ] 新变量在 `buildTemplateVars` 注册；模板中 `${var}` 或 `{{var}}` 均可被 `renderTemplate` 解析。
- [ ] 若步骤有特例流程（不经过通用 callAI），在特例里也调用 resolver。
- [ ] 合并规划类批处理：若包含可自定义步骤，检测到自定义后必须降级为分步，不能静默忽略。
- [ ] 更新 `tests/unit/shared/template-flow.test.ts` 的执行器清单。
- [ ] 更新本文件「模板分类与唯一来源」表。
