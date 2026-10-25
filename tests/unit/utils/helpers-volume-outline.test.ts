import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { pjVolumeOutlineDir } from '../../../shared/paths';
import { readMergedVolumeOutline } from '../../../utils/helpers';

function makePorts(contents: Record<string, string>, volPaths: string[], legacyPath: string) {
    const files = volPaths.map(path => ({ path, name: path.split('/').pop() || '' }));
    const meta = {
        getFiles: () => files,
        getAbstractFileByPath: (path: string) => {
            if (path !== legacyPath) return null;
            const file = new TFile();
            file.path = path;
            return file;
        },
    };
    const fs = { read: async (path: string) => contents[path] ?? '' };
    return { meta, fs };
}

describe('readMergedVolumeOutline — 数据源优先级', () => {
    const project = '测试项目';
    const dir = pjVolumeOutlineDir(project);
    const v1 = `${dir}/第1卷_分卷大纲.md`;
    const v2 = `${dir}/第2卷_分卷大纲.md`;
    const legacy = `${project}/03-大纲与章节/分卷大纲.md`;

    it('同时存在 v4 卷文件与旧版单文件时，只读 v4，避免重复卷号', async () => {
        const { meta, fs } = makePorts(
            { [v1]: 'V1', [v2]: 'V2', [legacy]: 'LEGACY' },
            [v2, v1],
            legacy,
        );

        const result = await readMergedVolumeOutline({} as never, project, fs as never, meta as never);

        expect(result).toBe('V1\n\nV2');
        expect(result).not.toContain('LEGACY');
    });

    it('没有任何 v4 卷文件时回退旧版单文件', async () => {
        const { meta, fs } = makePorts({ [legacy]: 'LEGACY' }, [], legacy);

        const result = await readMergedVolumeOutline({} as never, project, fs as never, meta as never);

        expect(result).toBe('LEGACY');
    });

    it('两者都不存在时返回空串', async () => {
        const { meta, fs } = makePorts({}, [], legacy);

        const result = await readMergedVolumeOutline({} as never, project, fs as never, meta as never);

        expect(result).toBe('');
    });
});
