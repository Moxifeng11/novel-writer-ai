/**
 * 示例项目导入：目录已存在但内容残缺时必须补齐（不能永久卡住）
 */

import { describe, expect, it } from 'vitest';
import { App } from 'obsidian';
import { EXAMPLE_PROJECT_NAME, importExampleProject } from '@/core/example-project-service';

const seedPartial = (app: App): void => {
    // 只放一个占位文件 → 目录已存在但示例内容缺失（模拟导入中断/用户删过）
    (app.vault as unknown as { _seedFile(p: string, c: string): unknown })
        ._seedFile(`${EXAMPLE_PROJECT_NAME}/占位.md`, '# 残留');
};

describe('importExampleProject — 幂等修复', () => {
    it('目录残缺时补齐缺失文件并报告 repaired', async () => {
        const app = new App();
        seedPartial(app);
        const result = await importExampleProject(app);
        expect(result.created).toBe(false);
        expect(result.repaired).toBeGreaterThan(0);
        const paths = app.vault.getFiles().map(file => file.path);
        expect(paths).toContain(`${EXAMPLE_PROJECT_NAME}/01-世界架构/世界观总览.md`);
        expect(paths.some(path => path.includes('正文/第1卷/第1章_正文.md'))).toBe(true);
        // 不覆盖已有内容
        expect(await app.vault.read(app.vault.getAbstractFileByPath(`${EXAMPLE_PROJECT_NAME}/占位.md`) as never)).toBe('# 残留');
    });

    it('内容齐全时不重复写（repaired=0）', async () => {
        const app = new App();
        await importExampleProject(app);
        const again = await importExampleProject(app);
        expect(again.created).toBe(false);
        expect(again.repaired).toBe(0);
    });

    it('空 vault 时正常创建', async () => {
        const app = new App();
        const result = await importExampleProject(app);
        expect(result.created).toBe(true);
        expect(result.repaired).toBe(0);
    });
});
