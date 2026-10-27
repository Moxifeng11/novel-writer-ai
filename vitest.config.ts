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
            ],
            exclude: [
                '**/*.d.ts',
                'tests/**',
                'engine/**/*-worker.ts',
            ],
            // 阈值按核心域分别设定（FR-E-05）：基线取自 v4.11.0 实测值，留出小幅回退空间。
            // 任一域低于阈值即失败，CI 的 test:cov 步骤因此成为阻断门禁。
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
