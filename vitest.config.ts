/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['tests/**/*.test.ts'],
        exclude: ['node_modules', 'main.js', 'tmp', 'dist'],
        setupFiles: ['tests/setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'text-summary', 'html'],
            reportsDirectory: './coverage',
            include: [
                'engine/character-soul.ts',
                'engine/emotion-planner.ts',
                'engine/scene-expander.ts',
            ],
            exclude: [
                '**/*.d.ts',
                'tests/**',
            ],
            thresholds: {
                lines: 20,
                functions: 20,
                branches: 80,
                statements: 20,
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
