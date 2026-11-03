/**
 * 路径规范回归：
 * 1. 运行时代码跨目录引用一律走 `@/` 别名，不再出现 `../` 深嵌套；
 * 2. 别名在 tsconfig / esbuild / vitest 三处都配置；
 * 3. 三个创作模式的项目库根目录只有一份来源。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    CREATION_MODE_SPECS,
    MODE_LIBRARY_ROOTS,
    MODE_LIBRARY_ROOT_LIST,
} from '@/shared/creation-mode';
import {
    MODE_LIBRARY_ROOTS as LOCATOR_ROOTS,
    MODE_LIBRARY_ROOT_LIST as LOCATOR_LIST,
} from '@/domains/kernel/project-locator';

const ROOT = path.resolve(__dirname, '../../..');
const DIRS = ['engine', 'services', 'shared', 'core', 'domains', 'ui'];

function runtimeFiles(): string[] {
    const out: string[] = [];
    for (const dir of DIRS) {
        const walk = (base: string): void => {
            for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
                const full = path.join(base, entry.name);
                if (entry.isDirectory()) {
                    if (!['node_modules', '.git', 'coverage', 'tmp'].includes(entry.name)) walk(full);
                } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
                    out.push(full);
                }
            }
        };
        walk(path.join(ROOT, dir));
    }
    out.push(path.join(ROOT, 'main.ts'), path.join(ROOT, 'plugin-api.ts'));
    return out;
}

describe('路径别名', () => {
    it('运行时代码不再使用 ../ 跨目录引用', () => {
        const offenders: string[] = [];
        for (const file of runtimeFiles()) {
            const source = fs.readFileSync(file, 'utf8');
            if (/from\s+['"]\.\.\//.test(source) || /import\(\s*['"]\.\.\//.test(source)) {
                offenders.push(path.relative(ROOT, file).split(path.sep).join('/'));
            }
        }
        expect(offenders).toEqual([]);
    });

    it('tsconfig / esbuild / vitest 三处都配置了 @ 别名', () => {
        const tsconfig = fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8');
        expect(tsconfig).toContain('"@/*"');
        const build = fs.readFileSync(path.join(ROOT, 'scripts/build.js'), 'utf8');
        expect(build).toContain("alias: { '@': rootDir }");
        const vitest = fs.readFileSync(path.join(ROOT, 'vitest.config.ts'), 'utf8');
        expect(vitest).toContain("'@': resolve(__dirname)");
    });
});

describe('三模式项目库根目录', () => {
    it('规格表是唯一来源，project-locator 只做再导出', () => {
        expect(MODE_LIBRARY_ROOTS).toEqual({
            long: '长篇小说',
            short: '短篇小说',
            script: '剧本',
        });
        expect(CREATION_MODE_SPECS.long.rootDir).toBe('长篇小说');
        expect(CREATION_MODE_SPECS.short.rootDir).toBe('短篇小说');
        expect(CREATION_MODE_SPECS.script.rootDir).toBe('剧本');
        expect(LOCATOR_ROOTS).toBe(MODE_LIBRARY_ROOTS);
        expect(LOCATOR_LIST).toBe(MODE_LIBRARY_ROOT_LIST);
    });
});
