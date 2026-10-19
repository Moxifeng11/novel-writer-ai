# tests/

Vitest 测试基建（P2-6）。

## 运行

```bash
npm test            # 跑全部测试
npm run test:cov    # 跑测试 + 覆盖率（v8）
```

## 范围

只覆盖 engine/ 下的 V2 纯函数模块：
- `engine/character-soul.ts`：CharacterSoul 提取与压缩
- `engine/emotion-planner.ts`：validateEmotionPlan 纯校验
- `engine/scene-expander.ts`：validateSceneExpansion 纯校验
- `engine/step-runner.ts`：ALL_FULL_STEPS / STEP_INDEX_MIGRATION_MAP / migrateStepIndex 常量与纯函数
- `engine/incremental-result-aggregator.ts`：分段置信度传播、池化方差、单段角色重判与统计口径

ai-engine / settlement-engine / ui-* 暂不覆盖（ROI 太低，需 fake timer + 完整 Obsidian harness）。

## 聚合器回归测试

```bash
npx vitest run tests/unit/engine/incremental-result-aggregator.test.ts
```

覆盖一致与冲突视角的置信度、节奏池化方差、单段角色全局重判，以及修辞总量/总字数速率口径。

## Obsidian Mock

`tests/__mocks__/obsidian.ts` 通过 `vitest.config.ts` 的 `resolve.alias` 重定向。最小化 stub。需要新 API 时按需追加，不要预填。

## 命名约定

- 单元测试：`tests/unit/<dir>/<name>.test.ts`
- 集成测试：`tests/integration/<dir>/<name>.test.ts`（暂不引入）
