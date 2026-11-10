import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { writeChapterStateSnapshot } from '../../../engine/chapter-state-snapshot-service';
import { ObsidianFileSystem } from '../../../shared/file-system-port';
import { pjChapterStateSnapshot, pjCharsDir } from '../../../shared/paths';

/**
 * 覆盖率审计（维度④）：chapter-state-snapshot-service 的写盘路径此前零覆盖
 * （S 14.47% / B 9.09%，`fs.write` 0 命中），而它是结算/批量流水线/一键成文
 * 共用的「下一章硬约束」来源。这里锁住：
 *  - 快照文件真实落盘、目录自动创建；
 *  - 人物状态/未兑现承诺进入快照；
 *  - 非法章号零副作用。
 */
const PROJECT = '长篇小说/测试书';

function seedApp(seed: Record<string, string>): App {
    const app = new App();
    for (const [path, content] of Object.entries(seed)) {
        (app.vault as unknown as { _seedFile: (p: string, c: string) => void })._seedFile(path, content);
    }
    (app as unknown as { metadataCache: unknown }).metadataCache = {
        getFileCache: (file: { path: string }) => {
            if (file.path.startsWith(`${pjCharsDir(PROJECT)}/`)) {
                return { frontmatter: { 姓名: '林玄', 当前状态: '正常', 当前情绪: '警觉' } };
            }
            return null;
        },
    };
    return app;
}

describe('writeChapterStateSnapshot — 写盘路径（维度④补测）', () => {
    it('真实落盘：人物状态/承诺进入快照，目录自动创建', async () => {
        const app = seedApp({
            [`${pjCharsDir(PROJECT)}/林玄.md`]: '---\n姓名: 林玄\n---\n',
        });
        const fs = new ObsidianFileSystem(app as never);

        const snapshot = await writeChapterStateSnapshot(app, {
            project: PROJECT,
            chapterNum: 1,
            chapterName: '第1章',
            updatedChars: ['林玄'],
            openPromises: ['三年之约'],
        });

        expect(snapshot).not.toBeNull();
        const path = pjChapterStateSnapshot(PROJECT, 1);
        await expect(fs.exists(path)).resolves.toBe(true);
        const text = await fs.read(path);
        expect(text).toContain('# 第1章 状态快照');
        expect(text).toContain('| 林玄 | 正常 |');
        expect(text).toContain('- 三年之约');
    });

    it('非法章号不写盘（零副作用）', async () => {
        const app = seedApp({});
        const writeSpy = vi.spyOn(app.vault.adapter, 'write');

        const snapshot = await writeChapterStateSnapshot(app, {
            project: PROJECT,
            chapterNum: 0,
            chapterName: '第0章',
        });

        expect(snapshot).toBeNull();
        expect(writeSpy).not.toHaveBeenCalled();
    });
});
