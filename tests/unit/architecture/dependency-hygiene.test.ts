import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 依赖卫生回归（维度⑤ / 2026-11-10 审计 P1）：
 *
 * 1. eslint.config.mjs 直接 import 的插件必须显式声明在 devDependencies——
 *    此前 no-unsanitized/@microsoft/sdl 靠 eslint-plugin-obsidianmd 传递提升，
 *    npm 提升策略一变，`npm run lint`（Obsidian 市场审核规则载体）在干净
 *    clone 上直接断裂，市场审核门禁失效。
 * 2. ci.yml 必须有顶层最小 permissions（contents: read）——GITHUB_TOKEN 默认
 *    权限过宽，与 release.yml 的最小化口径对齐。
 */

const ROOT = path.resolve(__dirname, '../../..');

function read(relative: string): string {
    return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('依赖卫生 — 幽灵依赖门禁', () => {
    it('eslint.config.mjs 的每个裸 import 都在 devDependencies 声明', () => {
        const pkg = JSON.parse(read('package.json')) as { devDependencies?: Record<string, string> };
        const declared = new Set(Object.keys(pkg.devDependencies ?? {}));

        const config = read('eslint.config.mjs');
        const imports = [...config.matchAll(/from\s+['"]([^'"]+)['"]/g)]
            .map((match) => match[1])
            .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('@/') && specifier !== 'node:path');

        expect(imports.length).toBeGreaterThan(0);
        for (const specifier of imports) {
            expect(declared.has(specifier), `eslint.config.mjs 引用了未声明的依赖：${specifier}`).toBe(true);
        }
    });

    it('已移除的无引用依赖不得回潜（wait-on 教训）', () => {
        const pkg = JSON.parse(read('package.json')) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };
        expect(pkg.devDependencies?.['wait-on']).toBeUndefined();
        expect(pkg.dependencies?.['wait-on']).toBeUndefined();
    });
});

describe('依赖卫生 — CI 最小权限', () => {
    it('ci.yml 顶层声明 permissions: contents: read', () => {
        const ci = read('.github/workflows/ci.yml');
        expect(ci).toMatch(/^permissions:\s*$/m);
        expect(ci).toMatch(/^\s+contents:\s*read\s*$/m);
        // release.yml 的写权限不受本门禁约束（发布需要 contents: write）
        expect(ci.indexOf('permissions:')).toBeLessThan(ci.indexOf('jobs:'));
    });
});
