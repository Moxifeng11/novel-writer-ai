# 工具层

## 一、HarnessTool

```ts
interface HarnessTool {
    id: string;
    mode: CreationMode | 'all';
    kind: 'local' | 'ai' | 'io';
    title: string;
    description: string;
    inputSchema: unknown;
    outputSchema: unknown;
    permission: 'read' | 'write-project' | 'write-vault' | 'network' | 'danger';
    run(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}
```

## 二、权限矩阵

| 权限 | 允许 | 需要确认 |
|---|---|---|
| read | 读取项目/配置 | 否 |
| write-project | 写项目内产物 | 否（限项目） |
| write-vault | 写项目外/全局 | 是 |
| network | 外部检索/AI 调用 | 设置允许时否 |
| danger | 删除/迁移/覆盖 | 必须确认 + 备份 |

## 三、调度规则

1. 先本地确定性工具，后 AI。
2. 同 id 工具只注册一次；重复注册报错。
3. 未知工具返回结构化错误，不抛未捕获异常。
4. 工具执行结果写入 CallLedger。
5. 危险工具必须走领域写入器，不直接操作正文。

## 四、领域工具

| 模式 | 工具 |
|---|---|
| 长篇 | 章节状态解析、事实索引查询、实体查找、关系查询、伏笔查询、时间线查询、文风采样、连贯性检查、合并规划解析、正文格式校验 |
| 短篇 | 五维分类校验、随机因子生成、故事核校验、反转表解析、分节大纲构建、节字数校验、节级质检、反转覆盖检查、结尾兑现检查 |
| 剧本 | 类型校验、集/场/镜 ID 生成、镜头时长求和、3 秒钩子校验、场景连续性检查、对白可拍性检查、分镜导出、纯文本导出 |
| Kernel | 项目定位、RAG 查询、规则编译、上下文装配、调用账本、导出文件写入 |