import { describe, expect, it } from 'vitest';
import type { App, Vault } from 'obsidian';
import { Vault as MockVault } from 'obsidian';
import {
    appendQualityHistory,
    loadQualityHistory,
    qualityHistoryPath,
    writeQualityHistory,
} from '../../../services/quality-history-store';
import type { QualityHistoryRecord } from '../../../shared/quality-history';

type TestVault = Vault & {
    write(path: string, content: string): Promise<void>;
    readByPath(path: string): Promise<string>;
};

const PROJECT = '测试项目';

function record(timestamp: number, score = 80, chapterKey = '第1章'): QualityHistoryRecord {
    return {
        chapterKey,
        timestamp,
        wordCount: 3000,
        overallScore: score,
        languageScore: score,
        rhythmScore: score,
        characterScore: score,
        plotScore: score,
        atmosphereScore: score,
        structureScore: score,
        grade: 'A',
        trend: 'stable',
    };
}

async function makeApp(withProject = true): Promise<{ app: App; vault: TestVault }> {
    const vault = new MockVault() as TestVault;
    if (withProject) {
        await vault.createFolder(PROJECT);
        await vault.createFolder(`${PROJECT}/04-项目总控`);
    }
    return { app: { vault } as unknown as App, vault };
}

describe('quality-history-store', () => {
    it('落盘路径固定在项目总控目录', () => {
        expect(qualityHistoryPath(PROJECT)).toBe(`${PROJECT}/04-项目总控/质量历史.json`);
    });

    it('文件不存在时返回空数组', async () => {
        const { app } = await makeApp();
        expect(await loadQualityHistory(app, PROJECT)).toEqual([]);
    });

    it('首次追加会创建文件', async () => {
        const { app, vault } = await makeApp();
        const merged = await appendQualityHistory(app, PROJECT, record(1000));
        expect(merged).toHaveLength(1);
        expect(await vault.readByPath(qualityHistoryPath(PROJECT))).toContain('"version": 1');
    });

    it('多次追加按时间累积', async () => {
        const { app } = await makeApp();
        await appendQualityHistory(app, PROJECT, record(1000, 80, '第1章'));
        await appendQualityHistory(app, PROJECT, record(2000, 90, '第2章'));
        const loaded = await loadQualityHistory(app, PROJECT);
        expect(loaded.map(r => r.timestamp)).toEqual([1000, 2000]);
        expect(loaded[1].overallScore).toBe(90);
    });

    it('追加时按 max 裁剪最旧记录', async () => {
        const { app } = await makeApp();
        await appendQualityHistory(app, PROJECT, record(1000, 80, '第1章'), 2);
        await appendQualityHistory(app, PROJECT, record(2000, 80, '第2章'), 2);
        await appendQualityHistory(app, PROJECT, record(3000, 80, '第3章'), 2);
        const loaded = await loadQualityHistory(app, PROJECT);
        expect(loaded.map(r => r.timestamp)).toEqual([2000, 3000]);
    });

    it('同一项目并发追加不丢记录（读-改-写串行化）', async () => {
        const { app } = await makeApp();
        await Promise.all([
            appendQualityHistory(app, PROJECT, record(1000, 80, '第1章')),
            appendQualityHistory(app, PROJECT, record(2000, 90, '第2章')),
        ]);
        const loaded = await loadQualityHistory(app, PROJECT);
        expect(loaded.map(r => r.timestamp)).toEqual([1000, 2000]);
    });

    it('不同项目的追加互不阻塞', async () => {
        const { app, vault } = await makeApp();
        await vault.createFolder('另一个项目');
        await vault.createFolder('另一个项目/04-项目总控');
        await Promise.all([
            appendQualityHistory(app, PROJECT, record(1000)),
            appendQualityHistory(app, '另一个项目', record(2000)),
        ]);
        expect(await loadQualityHistory(app, PROJECT)).toHaveLength(1);
        expect(await loadQualityHistory(app, '另一个项目')).toHaveLength(1);
    });

    it('落盘趋势按章比较，覆盖调用方传入的章内趋势', async () => {
        const { app } = await makeApp();
        await appendQualityHistory(app, PROJECT, record(1000, 78, '第1章'));
        await appendQualityHistory(app, PROJECT, record(2000, 80, '第2章'));
        // 调用方传的 trend 是引擎的章内方向，落盘时必须按前序章重算
        await appendQualityHistory(app, PROJECT, record(3000, 92, '第3章'));
        const loaded = await loadQualityHistory(app, PROJECT);
        expect(loaded.map(r => r.trend)).toEqual(['stable', 'stable', 'rising']);
    });

    it('同一章反复追加只保留最后一条章级样本', async () => {
        const { app } = await makeApp();
        await appendQualityHistory(app, PROJECT, record(1000, 78, '第1章'));
        await appendQualityHistory(app, PROJECT, record(2000, 80, '第2章'));
        await appendQualityHistory(app, PROJECT, record(3000, 90, '第2章'));
        const loaded = await loadQualityHistory(app, PROJECT);
        const secondChapter = loaded.filter(r => r.chapterKey === '第2章');
        // 磁盘口径是「章」：同章多次评估只留最后一条，趋势也不把自身当基准
        expect(secondChapter).toHaveLength(1);
        expect(secondChapter[0].timestamp).toBe(3000);
        expect(secondChapter[0].overallScore).toBe(90);
        expect(secondChapter[0].trend).toBe('stable');
    });

    it('单章高频落盘不会挤掉其他章的样本', async () => {
        const { app } = await makeApp();
        // 模拟面板 B 每 30s 落盘一次：同一章连续 30 次，配额只有 5 条
        for (let i = 0; i < 30; i++) {
            await appendQualityHistory(app, PROJECT, record(1000 + i * 30_000, 70 + i, '第1章'), 5);
        }
        await appendQualityHistory(app, PROJECT, record(2_000_000, 88, '第2章'), 5);
        const loaded = await loadQualityHistory(app, PROJECT);
        expect(loaded.map(r => r.chapterKey)).toEqual(['第1章', '第2章']);
        expect(loaded[0].timestamp).toBe(1000 + 29 * 30_000);
        expect(loaded[0].overallScore).toBe(99);
    });

    it('文件损坏时读取降级为空且不抛错', async () => {
        const { app, vault } = await makeApp();
        await vault.write(qualityHistoryPath(PROJECT), '{broken');
        expect(await loadQualityHistory(app, PROJECT)).toEqual([]);
    });

    it('覆盖写入保持最新顺序', async () => {
        const { app } = await makeApp();
        await writeQualityHistory(app, PROJECT, [record(2000), record(1000)]);
        const loaded = await loadQualityHistory(app, PROJECT);
        expect(loaded.map(r => r.timestamp)).toEqual([1000, 2000]);
    });
});
