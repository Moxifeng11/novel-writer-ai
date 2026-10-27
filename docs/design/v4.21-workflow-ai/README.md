# v4.21 创作流程与 AI 配置设计包

- 日期：2026-10-26
- 状态：01–03 为流程设计；04–05 已在本地工作树实现

## 文档

1. [三类项目创作流程细化](01-three-mode-workflow-spec.md)：每一阶段的输入/输出/交付标准/校验节点。
2. [短篇三步快速创作](02-short-story-three-step-research.md)：专项调研分析与三步流程设计。
3. [剧本分镜场全流程](03-script-storyboard-process.md)：集→场→镜记录、节点管控、纯文本交付。
4. [API 连通性测试](04-api-connectivity-test.md)：探测流程、状态分类、告警、验收。
5. [四级思考强度](05-thinking-levels-slider.md)：四档能力、百分比滑杆、参数与兼容规则。

## 实现状态

| 功能 | 状态 | 主要文件 |
|---|---|---|
| API 连通性测试 | 已实现 | `services/api-connectivity-service.ts`、`ui/settings-tab.ts` |
| 四级思考强度 + 滑杆 | 已实现 | `shared/task-model.ts`、`ui/settings-tab.ts` |
| 三类流程规范 | 设计完成 | 本目录 01–03 |
| 短篇三步 Runner | 设计完成，待开发 | 02 文档 |
| 剧本分镜 Runner | 设计完成，待开发 | 03 文档 |

## 共同验收

- 流程文档与实际入口、文件路径、参数一致。
- API 测试不泄露密钥，失败有可诊断状态与告警。
- 思考强度兼容旧配置，未设置新字段不改变旧行为。
- 所有新增功能有单测、无运行时错误。
