import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWriterEngine } from '../../../engine/co-writer-engine';
import { pjCharsDir } from '../../../shared/paths';

const PROJECT = '测试书';

type FakeFile = { path: string; name: string };

/** 用伪造的 this 调私有方法：只需要 getVaultMeta + app.metadataCache（不构造真实引擎）。 */
function callGetProtagonistName(files: FakeFile[], frontmatters: Record<string, unknown>): string {
    const fakeThis = {
        app: {
            metadataCache: {
                getFileCache: (f: FakeFile) => ({ frontmatter: frontmatters[f.path] }),
            },
        },
        getVaultMeta: () => ({ getFiles: () => files }),
    };
    return (CoWriterEngine.prototype as unknown as {
        getProtagonistName: (this: unknown, project: string) => string;
    }).getProtagonistName.call(fakeThis, PROJECT);
}

describe('CoWriterEngine — 主角名回退（不再依赖工作台状态）', () => {
    it('人物目录里「身份=主角」的文件名优先', () => {
        const charsDir = pjCharsDir(PROJECT);
        const files: FakeFile[] = [
            { path: `${charsDir}/路人甲.md`, name: '路人甲.md' },
            { path: `${charsDir}/林惊鸿.md`, name: '林惊鸿.md' },
        ];
        const name = callGetProtagonistName(files, {
            [`${charsDir}/路人甲.md`]: { 身份: '配角' },
            [`${charsDir}/林惊鸿.md`]: { 身份: ['主角', '剑修'] },
        });
        expect(name).toBe('林惊鸿');
    });

    it('没有主角条目时回落「主角」，不再读 _workbenchState', () => {
        const charsDir = pjCharsDir(PROJECT);
        const files: FakeFile[] = [{ path: `${charsDir}/配角甲.md`, name: '配角甲.md' }];
        const name = callGetProtagonistName(files, {
            [`${charsDir}/配角甲.md`]: { 身份: '配角' },
        });
        expect(name).toBe('主角');
    });

    it('人物目录外的文件与元数据缺失都不会抛错', () => {
        const charsDir = pjCharsDir(PROJECT);
        const files: FakeFile[] = [
            { path: `${PROJECT}/02-正文/第1卷/第1章.md`, name: '第1章.md' },
            { path: `${charsDir}/无身份.md`, name: '无身份.md' },
        ];
        const name = callGetProtagonistName(files, {});
        expect(name).toBe('主角');
    });
});
