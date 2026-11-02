# JSDoc 覆盖率（生成物）

> 由 `npm run check:jsdoc -- --report` 生成，禁止手改。

| 层 | 文件 | 导出 | 已注释 | 导出覆盖 | 公开方法 | 已注释 | 方法覆盖 | 不完整 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `core/` | 6 | 23 | 15 | 65% | 48 | 48 | 100% | 43 |
| `domains/` | 11 | 30 | 20 | 67% | 1 | 1 | 100% | 0 |
| `engine/` | 271 | 1508 | 1073 | 71% | 1253 | 1028 | 82% | 753 |
| `services/` | 28 | 151 | 120 | 79% | 202 | 165 | 82% | 66 |
| `shared/` | 163 | 1517 | 1170 | 77% | 149 | 138 | 93% | 457 |
| `ui/` | 189 | 493 | 235 | 48% | 632 | 380 | 60% | 163 |

## 缺口最大的文件（按未注释导出数）

| 文件 | 导出 | 未注释 | 公开方法 | 未注释 |
|---|---:|---:|---:|---:|
| `shared/story-structure.ts` | 23 | 12 | 0 | 0 |
| `ui/views/book-detail-renderer.ts` | 2 | 0 | 10 | 10 |
| `engine/agent/dsh/dsh-session.ts` | 7 | 6 | 5 | 2 |
| `engine/ai-chapter-helpers.ts` | 1 | 1 | 7 | 7 |
| `engine/ai-engine.ts` | 2 | 2 | 33 | 6 |
| `engine/ai-worldview-generator.ts` | 2 | 1 | 7 | 7 |
| `engine/anti-ai-detector.ts` | 6 | 6 | 7 | 2 |
| `engine/embedding/ollama-provider.ts` | 2 | 0 | 8 | 8 |
| `engine/engine-registry.ts` | 13 | 1 | 34 | 7 |
| `engine/foreshadow-manager.ts` | 8 | 6 | 18 | 2 |
| `engine/harness/single-call-runner.ts` | 7 | 7 | 1 | 1 |
| `engine/project-migration-service.ts` | 5 | 5 | 5 | 3 |
| `engine/prompt-manager.ts` | 4 | 4 | 16 | 4 |
| `engine/repository/domain/aggregates/faction-aggregate.ts` | 2 | 2 | 6 | 6 |
| `engine/repository/domain/aggregates/item-aggregate.ts` | 2 | 2 | 6 | 6 |
| `engine/settlement/settlement-journal.ts` | 6 | 5 | 4 | 3 |
| `engine/step-definitions.ts` | 13 | 8 | 0 | 0 |
| `engine/story-linkage.ts` | 14 | 8 | 0 | 0 |
| `engine/types/analysis-suggestion.ts` | 8 | 8 | 0 | 0 |
| `services/prompt-manager.ts` | 3 | 3 | 30 | 5 |
| `services/rules-service.ts` | 2 | 2 | 8 | 6 |
| `services/synopsis-store.ts` | 5 | 0 | 8 | 8 |
| `shared/creation-flow.ts` | 11 | 8 | 0 | 0 |
| `shared/entity-models.ts` | 34 | 8 | 0 | 0 |
| `shared/fanfic-audit.ts` | 11 | 8 | 0 | 0 |
| `shared/format-constants.ts` | 65 | 8 | 0 | 0 |
| `shared/paths.ts` | 189 | 8 | 0 | 0 |
| `shared/pre-research.ts` | 17 | 8 | 0 | 0 |
| `shared/quality-baseline.ts` | 10 | 8 | 0 | 0 |
| `ui/full-writer/streamlined-nav-presenter.ts` | 12 | 8 | 0 | 0 |
