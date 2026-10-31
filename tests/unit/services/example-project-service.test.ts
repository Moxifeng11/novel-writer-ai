/**
 * example-project-service.test.ts — FR-C-06 示例项目导入
 *
 * 覆盖：
 * - 空 vault 导入后关键文件齐全
 * - 重复导入不覆盖用户修改
 * - 1 卷 3 章 / 1 人物 / 1 伏笔的结构约束
 */
import { describe, it, expect } from 'vitest';
import {
    EXAMPLE_PROJECT_NAME,
    importExampleProject,
} from '../../../core/example-project-service';

class FakeAdapter {
    files = new Map<string, string>();
    dirs = new Set<string>();

    async exists(path: string): Promise<boolean> {
        return this.files.has(path) || this.dirs.has(path);
    }

    async mkdir(path: string): Promise<void> {
        this.dirs.add(path);
    }

    async write(path: string, data: string): Promise<void> {
        this.files.set(path, data);
    }
}

function makeApp(adapter: FakeAdapter) {
    return { vault: { adapter } } as unknown as Parameters<typeof importExampleProject>[0];
}

const P = EXAMPLE_PROJECT_NAME;

describe('importExampleProject（FR-C-06）', () => {
    it('空 vault 导入后生成 1 卷 3 章、1 人物、1 伏笔', async () => {
        const adapter = new FakeAdapter();
        const result = await importExampleProject(makeApp(adapter));

        expect(result).toEqual({ created: true, project: P });

        const required = [
            `${P}/.project`,
            `${P}/01-世界架构/世界观总览.md`,
            `${P}/01-世界架构/人物/林昭.md`,
            `${P}/02-时间线与伏笔/伏笔库.md`,
            `${P}/03-大纲与章节/分卷大纲/第1卷_分卷大纲.md`,
            `${P}/03-大纲与章节/正文/第1卷/第1章_正文.md`,
            `${P}/03-大纲与章节/正文/第1卷/第2章_正文.md`,
            `${P}/03-大纲与章节/正文/第1卷/第3章_正文.md`,
        ];
        for (const path of required) {
            const content = adapter.files.get(path);
            expect(content, `缺少示例文件: ${path}`).toBeTruthy();
            expect(content!.trim().length).toBeGreaterThan(0);
        }

        expect(adapter.files.get(`${P}/01-世界架构/人物/林昭.md`)).toContain('姓名: 林昭');
        expect(adapter.files.get(`${P}/02-时间线与伏笔/伏笔库.md`)).toContain('断剑上的铭文');
        expect(adapter.files.get(`${P}/03-大纲与章节/分卷大纲/第1卷_分卷大纲.md`)).toContain('总章节数**：3');
    });

    it('重复导入不覆盖已有项目内容', async () => {
        const adapter = new FakeAdapter();
        await importExampleProject(makeApp(adapter));

        const target = `${P}/03-大纲与章节/正文/第1卷/第1章_正文.md`;
        adapter.files.set(target, '用户修改后的正文');

        const second = await importExampleProject(makeApp(adapter));
        expect(second.created).toBe(false);
        expect(adapter.files.get(target)).toBe('用户修改后的正文');
    });
});
