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
            reporter: ['text', 'text-summary', 'html'],
            reportsDirectory: './coverage',
            // 覆盖率口径覆盖核心域（FR-E-05），排除类型声明、测试与 Worker 入口
            include: [
                'engine/**/*.ts',
                'services/**/*.ts',
                'core/**/*.ts',
                // G7-7：shared/ 是跨层原语（路径/预算/缓存/体检），此前完全不算覆盖率，
                // 导致「70%」只代表约一半源码；纳入后数字会下降，但那是真话。
                'shared/**/*.ts',
            ],
            exclude: [
                '**/*.d.ts',
                'tests/**',
                'engine/**/*-worker.ts',
                // 构建期嵌入的模板资产：纯字符串常量，测不到也没有行为
                'shared/template-scaffold-assets.generated.ts',
            ],
            // 阈值按核心域分别设定（FR-E-05）。
            // 2026-11-03：Vitest 1.6 → 4.1 后 @vitest/coverage-v8 改用 AST-aware
            // remapping，分支/语句口径更严格（同一批测试从 lines 76.7 变为 65.6），
            // 这是度量口径变化，不是测试或代码回退。按新口径重取基线并下浮约 1-2 个点：
            //   全局 lines 65.6 / statements 64.3 / branches 56.7 / funcs 66.7
            //   engine branches 53.6 / services branches 41.5 / core branches 50.7
            //   shared lines 85.9 / statements 84.6 / branches 77.7
            thresholds: {
                lines: 64,
                statements: 62,
                branches: 55,
                functions: 65,
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
