import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function listFiles(dirRel: string): string[] {
    const dir = path.join(ROOT, dirRel);
    if (!fs.existsSync(dir)) return [];
    const result: string[] = [];
    const walk = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.ts')) result.push(path.relative(ROOT, full).replace(/\\/g, '/'));
        }
    };
    walk(dir);
    return result.sort();
}

describe('三域物理隔离', () => {
    it('domains/long 不导入短篇/剧本 domain', () => {
        const files = listFiles('domains/long').concat(listFiles('engine/harness'));
        const violations: string[] = [];
        for (const file of files) {
            const src = read(file);
            if (/(domains\/(short|script))|(from ['"].*short-story)|(from ['"].*script\/)/.test(src)) {
                violations.push(file);
            }
        }
        expect(violations).toEqual([]);
    });

    it('domains/short 与 domains/script 互不导入', () => {
        const violations: string[] = [];
        for (const file of [...listFiles('domains/short'), ...listFiles('domains/script')]) {
            const src = read(file);
            const isShort = file.startsWith('domains/short/');
            const foreign = isShort ? /domains\/script/ : /domains\/short/;
            if (foreign.test(src)) violations.push(file);
        }
        expect(violations).toEqual([]);
    });

    it('短篇/剧本 domain 不使用长篇 03-大纲与章节 路径', () => {
        const files = [...listFiles('domains/short'), ...listFiles('domains/script')];
        const violations = files.filter(file => read(file).includes('03-大纲与章节'));
        expect(violations).toEqual([]);
    });

    it('长篇工具目录不包含短篇/剧本入口', () => {
        const src = read('domains/long/tool-catalog.ts');
        expect(src).not.toContain('novel-writer-create-short');
        expect(src).not.toContain('novel-writer-create-script');
        expect(src).not.toContain('短篇');
        expect(src).not.toContain('剧本');
    });

    it('短篇/剧本工具目录不包含长篇专属动作', () => {
        const forbidden = [
            'novel-writer-plan-book',
            'novel-writer-batch-chapters',
            'novel-writer-chapter-settlement',
            'novel-writer-cross-volume-state',
            'novel-writer-create-project',
        ];
        for (const file of ['domains/short/tool-catalog.ts', 'domains/script/tool-catalog.ts']) {
            const src = read(file);
            for (const id of forbidden) {
                expect(src).not.toContain(id);
            }
        }
    });

    it('长篇创建弹窗不再包含短篇/剧本字段与分支', () => {
        const src = read('ui/create-project-modal.ts');
        expect(src).not.toContain('SHORT_STORY_CATEGORIES');
        expect(src).not.toContain('SCRIPT_GENRES');
        expect(src).not.toContain('createModeProject');
        expect(src).not.toContain("mode: 'short'");
        expect(src).not.toContain("mode: 'script'");
    });

    it('项目定位服务支持模式库与 legacy 根目录', () => {
        const src = read('domains/kernel/project-locator.ts');
        // v4.26：模式根目录唯一来源在 shared/creation-mode，locator 只做再导出
        expect(src).toContain('MODE_LIBRARY_ROOTS');
        const spec = read('shared/creation-mode.ts');
        expect(spec).toContain("rootDir: '长篇小说'");
        expect(spec).toContain("rootDir: '短篇小说'");
        expect(spec).toContain("rootDir: '剧本'");
    });
});
