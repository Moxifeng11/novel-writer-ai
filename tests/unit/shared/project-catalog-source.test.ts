/**
 * 项目来源单源约束：
 * 1. 运行时代码不得再自己遍历 vault 根目录判断项目（唯一入口 shared/project-catalog.ts）；
 * 2. listProjects / detectProjects 必须委托同一实现；
 * 3. 项目身份判据不得重新把 03-大纲与章节 当项目标志（删除残留会复活）。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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
    out.push(path.join(ROOT, 'main.ts'));
    return out;
}

function rel(file: string): string {
    return path.relative(ROOT, file).split(path.sep).join('/');
}

describe('项目发现单源', () => {
    it('除 project-catalog 外，运行时代码不再遍历 vault 根目录', () => {
        const offenders = runtimeFiles()
            .filter(file => !rel(file).endsWith('shared/project-catalog.ts'))
            .filter(file => {
                const source = fs.readFileSync(file, 'utf8');
                return /getRoot\(\)\s*\.children/.test(source);
            })
            .map(rel);
        expect(offenders).toEqual([]);
    });

    it('listProjects / detectProjects / getActiveProject 都委托 project-catalog', () => {
        const exportSource = fs.readFileSync(path.join(ROOT, 'ui/export-manuscript-modal.ts'), 'utf8');
        expect(exportSource).toContain("from '@/shared/project-catalog'");
        expect(exportSource).toContain('return listProjectIds(app)');

        const contextSource = fs.readFileSync(path.join(ROOT, 'engine/context-manager.ts'), 'utf8');
        expect(contextSource).toContain("from '@/shared/project-catalog'");
        expect(contextSource).toContain('return listProjectIds(app)');

        const mainSource = fs.readFileSync(path.join(ROOT, 'main.ts'), 'utf8');
        expect(mainSource).toContain("from '@/shared/project-catalog'");
        expect(mainSource).toContain('listProjectIds(this.app)');
    });

    it('项目身份标志不包含单独的 03-大纲与章节', () => {
        const source = fs.readFileSync(path.join(ROOT, 'shared/project-catalog.ts'), 'utf8');
        const markers = source.slice(
            source.indexOf('PROJECT_IDENTITY_MARKERS'),
            source.indexOf('] as const', source.indexOf('PROJECT_IDENTITY_MARKERS')),
        );
        expect(markers).not.toContain('03-大纲与章节');
        expect(markers).toContain('作品信息.md');
    });
});
