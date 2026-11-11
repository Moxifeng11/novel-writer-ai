/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['tests/**/*.test.ts'],
        exclude: ['node_modules', 'main.js', 'tmp', 'dist', 'tests/benchmark/**'],
        setupFiles: ['tests/setup.ts'],
        coverage: {
            provider: 'v8',
            // DSH-20261112-01：json-summary 供 scripts/check-coverage.mjs 读取（计数加权聚合）
            reporter: ['text', 'text-summary', 'html', 'json-summary'],
            reportsDirectory: './coverage',
            // 覆盖率口径覆盖核心域（FR-E-05），排除类型声明、测试与 Worker 入口。
            // 注意：include 匹配是「子串包含」语义（picomatch contains:true），
            // `services/**/*.ts` 会连带命中 `ui/services/`（相对路径含 `services/` 即命中）。
            include: [
                'engine/**/*.ts',
                'services/**/*.ts',
                'core/**/*.ts',
                // G7-7：shared/ 是跨层原语（路径/预算/缓存/体检），此前完全不算覆盖率，
                // 导致「70%」只代表约一半源码；纳入后数字会下降，但那是真话。
                'shared/**/*.ts',
                // 2026-11-05（G7-7 续）：纳入 ui/ 与 domains/。此前全部 ui 文件
                // （含 ui/services）与 domains 游离在门禁之外，报告数字不代表全仓源码。
                'ui/**/*.ts',
                'domains/**/*.ts',
            ],
            exclude: [
                '**/*.d.ts',
                'tests/**',
                'engine/**/*-worker.ts',
                // 构建期嵌入的模板资产：纯字符串常量，测不到也没有行为
                'shared/template-scaffold-assets.generated.ts',
                // 纯类型声明文件（零运行时代码，无可覆盖语句）：
                'ui/full-writer/wizard-view-access.ts',
                'domains/kernel/tool-catalog-types.ts',
            ],
            // 阈值按域分别设定（FR-E-05）。
            // 2026-11-03：Vitest 1.6 → 4.1 后 @vitest/coverage-v8 改用 AST-aware
            // remapping，分支/语句口径更严格（同一批测试从 lines 76.7 变为 65.6），
            // 这是度量口径变化，不是测试或代码回退。按新口径重取基线并下浮约 1-2 个点。
            // 2026-11-05：第二次口径扩展，纳入 ui/ 与 domains/，同时移除全局阈值、
            // 全部改为 per-glob。原因：ui 纳入后全局并集从 ~65% 掉到 ~40%，全局阈值
            // 既不能代表任何单一域（被 ui 摊薄），也永远压不住新纳入的低覆盖目录
            // （继续维持只会逼人造数字）；per-glob 让每个域对自己的真实基线负责。
            // 语义注意：threshold glob 按 `relative(root, file)` 精确匹配（无子串语义），
            // 因此 `services/**` 阈值只管 services/ 真目录；被 include 连带进来的
            // ui/services/ 由 `ui/**` 阈值接管。
            // 纪律：per-glob 阈值是棘轮，只升不降；下调必须在 PR 里说明理由。
            thresholds: {
                'engine/**/*.ts': {
                    lines: 52,
                    statements: 52,
                    branches: 52,
                    functions: 40,
                },
                'services/**/*.ts': {
                    lines: 36,
                    statements: 36,
                    branches: 40,
                    functions: 26,
                },
                'core/**/*.ts': {
                    lines: 45,
                    statements: 45,
                    branches: 49,
                    functions: 14,
                },
                'shared/**/*.ts': {
                    lines: 85,
                    statements: 84,
                    branches: 77,
                    functions: 80,
                },
                // 2026-11-05 首期基线：domains 实测 lines 86.91 / statements 84.03 /
                // branches 72.41 / functions 72.72，各下浮约 2 点取整（棘轮起点）。
                'domains/**/*.ts': {
                    lines: 84,
                    statements: 82,
                    branches: 70,
                    functions: 70,
                },
                // 2026-11-05 首期基线：ui 实测仅 lines 5.97 / statements 5.9 /
                // branches 6.14 / functions 5.38——这是讲真话：全部 ui 文件此前
                // 游离在门禁之外，现状就是接近零覆盖。各下浮约 2 点取整作为
                // 首期棘轮起点，后续只升不降。
                // 2026-11-05 棘轮第一次上拧：pure-helpers-coverage.test.ts（纯函数
                // + fake-DOM 组件测试）把 ui/** 递归实测抬到 lines 12.04 /
                // statements 11.95 / branches 12.52 / functions 10.1（分母 40842
                // 行）。按「实际值-2 以内」收紧：10 / 9 / 10 / 8。
                'ui/**/*.ts': {
                    lines: 10,
                    statements: 9,
                    branches: 10,
                    functions: 8,
                },
            },
        },
        testTimeout: 10_000,
        hookTimeout: 10_000,
    },
    resolve: {
        alias: {
            '@': resolve(__dirname),
            obsidian: resolve(__dirname, 'tests/__mocks__/obsidian.ts'),
        },
    },
});
