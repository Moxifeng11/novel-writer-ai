# Agent 工具面重构设计（v1 · 2026-11-15）

> 背景：Agent 工具经过多轮迭代（25 个工具、单文件 56KB），已难覆盖插件当前能力
> （173 条命令、39 个服务）。本文档是重构蓝图，按阶段落地。

## 一、现状审计

### 1.1 工具清单（25 个）

| 分类 | 工具 | 问题 |
|---|---|---|
| 项目 | create_long_project / create_short_project / create_script_project / delete_project / list_projects | 只能「建/删/列」，不能改名、复制、归档、导出 |
| 文件 | read_file / write_file / move_file / delete_file / search_vault | 无 patch 语义（只能整文件覆盖）、无附件、无版本感知 |
| 章节 | list_chapters / open_chapter | 无「读正文全文/按章检索/更新正文」专用工具；写入只能靠 write_file 拼路径 |
| 界面 | open_wizard / open_flow / open_full_writer / open_story_settings / open_pre_research / open_co_writing | 打开界面占用工具位，应合并为 `open_view(viewId)` |
| 状态 | get_project_status / get_execution_status / list_commands / run_command | run_command 是万能后门（173 条命令），语义靠命令 id 猜 |
| 记忆/计划 | update_memory / update_plan / random_story_settings | 记忆槽是会话内黑盒，不能持久化成「设定卡/规划节点」 |

### 1.2 结构性缺陷

1. **单文件 56KB**：25 个工具全塞 `host-tools.ts`，新增工具只能继续堆
2. **无工具级权限模型**：只有 sideEffect 三档，没有「动作契约」分类（已补命令层与守卫，但工具本身没声明 kind）
3. **无外部扩展点**：不能接 MCP、不能装 skill
4. **plan/spec 缺失**：只有会话内 update_plan（内存数组），没有可落盘的 plan/spec 文件
5. **附件缺失**：不能上传/引用图片、PDF、参考文档
6. **goal 模式缺失**：没有长任务目标（跨回合持续推进 + 完成判定）

## 二、目标架构

```
engine/agent/tools/
├── registry.ts           # ToolRegistry：注册/分类/守卫/执行（从 harness 抽离）
├── types.ts              # AgentTool 定义（name/kind/params/sideEffect/execute）
├── modules/              # 按领域拆分的工具模块
│   ├── project-tools.ts  # 项目 CRUD/归档/导出
│   ├── file-tools.ts     # 读写/patch/移动/删除/附件
│   ├── chapter-tools.ts  # 章节专用（读全文/写正文/版本）
│   ├── planning-tools.ts # 规划画布/plan/spec
│   ├── memory-tools.ts   # 设定图（卡/关系/历史/patch）
│   ├── usage-tools.ts    # 用量/成本
│   ├── ui-tools.ts       # 统一 open_view
│   └── system-tools.ts   # 命令列表/执行、状态
├── mcp/
│   ├── mcp-client.ts     # MCP 客户端（stdio / http）
│   ├── mcp-config.ts     # 服务配置模型
│   └── mcp-tools.ts      # 把 MCP 工具桥接成 AgentTool
└── skills/
    ├── skill-loader.ts   # vault 内 skills/*.md（frontmatter）加载
    └── skill-tools.ts    # skill 作为「提示片段 + 可选工具」注入
```

### 2.1 工具声明新增字段

```ts
interface AgentTool {
  name: string;
  description: string;
  kind: ActionKind;            // 动作契约：read/write-prose/write-setting/admin
  sideEffect?: 'none' | 'write' | 'dangerous';
  parameters: Record<string, ParamSchema>;
  required: string[];
  execute(args, ctx): Promise<ToolResult>;
}
```

`kind` 由工具自己声明，注册表据此做只读拦截（替代当前按名字猜）。

### 2.2 MCP 支持

- **加载 MCP 服务**：设置页维护服务列表（stdio 命令 / SSE / HTTP 端点），启动时连接、拉取 `tools/list`，桥接为 `mcp__<server>__<tool>`
- **新建 MCP 服务**：向导生成一个最小 MCP server 模板（Node stdio），放到插件数据目录，供用户改
- 权限：MCP 工具默认 `admin`（未知副作用），首次调用需确认；可按服务配置 kind

### 2.3 Skill 定制

- vault 内 `技能/*.md`，frontmatter：`name / description / when / tools? / prompt`
- 加载后：description 进系统提示（按需注入），`when` 命中时把 prompt 段落注入当前回合
- 可绑定工具白名单（skill 内声明只允许哪些工具）

### 2.4 plan / spec 命令

- `/plan`：进入计划模式，产出 `计划.md`（步骤 + 验收），后续回合按计划推进
- `/spec`：产出 `规格.md`（需求/约束/验收标准），plan 引用 spec
- 落盘：`<项目>/04-项目总控/plan/<时间戳>.md`

### 2.5 附件上传

- 输入框支持拖拽/选择文件 → 存 `<项目>/04-项目总控/附件/`
- 消息里以 `[附件](路径)` 引用；Agent 工具 `read_attachment(path)` 可读文本/图片（图片走多模态）

### 2.6 goal 目标模式

- `/goal <目标>`：创建目标（存 `<项目>/04-项目总控/goal/<id>.json`）
- 每回合开始注入目标 + 进度；Agent 可 `update_goal(progress)` / `complete_goal`
- 目标完成需证据（章节版本/文件路径），不能空口宣告

## 三、分阶段实施

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | 移除外部 dsh 后端 | ✅ 6c8d79b7 |
| P1 | 工具模块化：拆 `host-tools.ts` → modules/*，工具自声明 kind，注册表按 kind 守卫 | preflight 绿 + 工具清单快照测试 |
| P2 | 工具面补齐：project CRUD、file patch、chapter 专用、planning/memory 工具、open_view 合并 | 新工具测试 + 实机调用 |
| P3 | MCP 客户端 + 加载服务 + 新建服务向导 | 连一个本地 stdio MCP 验证 tools/list |
| P4 | Skill 加载与注入 | 放一个 skill 文件 → 提示词出现 |
| P5 | plan / spec 命令 | 生成计划.md/规格.md 并驱动回合 |
| P6 | 附件上传 | 拖入图片/PDF → 落盘 + 可引用 |
| P7 | goal 目标模式 | 创建目标 → 跨回合推进 → 完成判定 |

## 四、非目标

- 不做多用户/云端同步
- 不重写内置 Harness 的回合循环（只换工具装配层）
- MCP 不做市场/远程托管
