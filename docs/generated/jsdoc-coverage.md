# JSDoc 覆盖率（生成物）

> 由 `npm run check:jsdoc -- --report` 生成，禁止手改。

| 层 | 文件 | 导出 | 已注释 | 导出覆盖 | 公开方法 | 已注释 | 方法覆盖 | 不完整 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `core/` | 6 | 23 | 23 | 100% | 48 | 48 | 100% | 43 |
| `domains/` | 11 | 30 | 30 | 100% | 1 | 1 | 100% | 0 |
| `engine/` | 271 | 1508 | 1175 | 78% | 1253 | 1097 | 88% | 753 |
| `services/` | 28 | 151 | 120 | 79% | 202 | 165 | 82% | 66 |
| `shared/` | 163 | 1517 | 1170 | 77% | 149 | 138 | 93% | 457 |
| `ui/` | 189 | 493 | 235 | 48% | 632 | 380 | 60% | 163 |

## 缺口最大的文件（按未注释导出数）

| 文件 | 导出 | 未注释 | 公开方法 | 未注释 |
|---|---:|---:|---:|---:|
| `shared/story-structure.ts` | 23 | 12 | 0 | 0 |
| `ui/views/book-detail-renderer.ts` | 2 | 0 | 10 | 10 |
| `engine/repository/domain/aggregates/faction-aggregate.ts` | 2 | 2 | 6 | 6 |
| `engine/repository/domain/aggregates/item-aggregate.ts` | 2 | 2 | 6 | 6 |
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
| `ui/project-side-panel-view.ts` | 5 | 3 | 5 | 5 |
| `ui/views/writing-fingerprint-view.ts` | 3 | 0 | 8 | 8 |
| `engine/character-arc.ts` | 9 | 7 | 0 | 0 |
| `engine/deconstructors/character-deconstructor.ts` | 14 | 0 | 8 | 7 |
| `engine/engine-registry.ts` | 13 | 0 | 34 | 7 |
| `engine/harness/creative-randomizer.ts` | 4 | 4 | 3 | 3 |
| `engine/harness/long-novel-tasks.ts` | 5 | 4 | 3 | 3 |
| `engine/knowledge-injector.ts` | 13 | 7 | 23 | 0 |
| `engine/plot-completion-engine.ts` | 6 | 5 | 2 | 2 |
| `engine/plot-divergence-engine.ts` | 8 | 0 | 7 | 7 |
| `engine/repository/domain/aggregates/location-aggregate.ts` | 2 | 2 | 5 | 5 |
| `engine/vector-enhancer.ts` | 5 | 5 | 20 | 2 |
| `services/knowledge-base-manager.ts` | 5 | 4 | 35 | 3 |
| `shared/execution-events.ts` | 8 | 7 | 0 | 0 |
| `shared/file-cache.ts` | 3 | 0 | 10 | 7 |
