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
            // 2026-11-01（G7-7）把 shared/ 纳入口径后重取基线：
            //   全局 lines 76.7 / branches 78.7 / funcs 73.0
            //   shared lines 93.3 / branches 85.5 / funcs 83.9
            // 各域阈值取实测值下浮约 3-5 个点，任一域低于阈值即失败（CI test:cov 阻断）。
            thresholds: {
                lines: 30,
                statements: 30,
                branches: 60,
                functions: 15,
                'engine/**/*.ts': {
                    lines: 52,
                    statements: 52,
                    branches: 74,
                    functions: 40,
                },
                'services/**/*.ts': {
                    lines: 36,
                    statements: 36,
                    branches: 67,
                    functions: 26,
                },
                'core/**/*.ts': {
                    lines: 45,
                    statements: 45,
                    branches: 74,
                    functions: 14,
                },
                'shared/**/*.ts': {
                    lines: 90,
                    statements: 90,
                    branches: 82,
                    functions: 80,
                },
            },
        },
        testTimeout: 10_000,
        hookTimeout: 10_000,
    },
    resolve: {
        alias: {
            obsidian: resolve(__dirname, 'tests/__mocks__/obsidian.ts'),
        },
    },
});
