/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['tests/benchmark/**/*.test.ts'],
        exclude: ['node_modules', 'main.js', 'tmp', 'dist'],
        setupFiles: ['tests/setup.ts'],
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
    resolve: {
        alias: {
            obsidian: resolve(__dirname, 'tests/__mocks__/obsidian.ts'),
        },
    },
});
