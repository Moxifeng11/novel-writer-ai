import { describe, expect, it } from 'vitest';
import { TFile } from '../../__mocks__/obsidian';
import { StepRunner } from '../../../engine/step-runner';
import { pjBodyFile } from '../../../shared/paths';

/**
 * D-4（数据一致性二轮）：定向修订前的唯一备份曾把 chapDir（目录）当 sourcePath，
 * 备份中心/回滚对目录 read/write 必然失败。这里锁住「解析真实正文文件」的契约。
 */
const PROJECT = '长篇小说/测试书';
const CHAP_DIR = `${PROJECT}/03-大纲与章节/步骤结果/第1卷/第2章`;

type ResolverHost = {
    app: unknown;
    getVaultMeta: () => { getFiles: () => TFile[] };
};

function resolve(host: ResolverHost, chapterName = '第2章', chapDir = CHAP_DIR): string | undefined {
    const fn = (StepRunner.prototype as unknown as {
        resolveDiskBodyPath: (this: ResolverHost, project: string, chapDir: string, chapterName: string) => string | undefined;
    }).resolveDiskBodyPath;
    return fn.call(host, PROJECT, chapDir, chapterName);
}

describe('StepRunner — 定向修订备份路径（D-4）', () => {
    it('找不到带章名文件时回落到标准正文路径（不是 chapDir 目录）', () => {
        const path = resolve({ app: {}, getVaultMeta: () => ({ getFiles: () => [] }) });
        expect(path).toBe(pjBodyFile(PROJECT, 1, 2));
        expect(path).not.toBe(CHAP_DIR);
    });

    it('目录里的无关文件不会让备份指向错误章节', () => {
        const other = new TFile();
        other.path = `${PROJECT}/03-大纲与章节/正文/第1卷/第3章_正文.md`;
        const path = resolve({ app: {}, getVaultMeta: () => ({ getFiles: () => [other] }) });
        expect(path).toBe(pjBodyFile(PROJECT, 1, 2));
    });

    it('章节名缺章号且 chapDir 不是 v4 结构时返回 undefined', () => {
        expect(resolve(
            { app: {}, getVaultMeta: () => ({ getFiles: () => [] }) },
            '序章',
            `${PROJECT}/旧结构/章节`,
        )).toBeUndefined();
    });
});
