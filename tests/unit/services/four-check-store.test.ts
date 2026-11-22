/**
 * 四项校验结果存储：按章覆盖、读取排序、项目校验
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { FourCheckStore, compareChapterName } from '@/services/four-check-store';
import type { FourCheckReport } from '@/shared/chapter-four-checks-model';

const PROJECT = '长篇小说/甲';

const report = (chapterName: string, warnCount = 0, checkedAt = 1): FourCheckReport => ({
    chapterName,
    checkedAt,
    items: [],
    warnCount,
    summary: `四项校验：${chapterName}`,
});

const make = () => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    vault._seedFile(`${PROJECT}/作品信息.md`, '# 作品');
    return { store: new FourCheckStore(app), vault };
};

describe('FourCheckStore', () => {
    it('写入后可按章读回，重复写入同一章为覆盖', async () => {
        const { store, vault } = make();
        await store.record(PROJECT, report('第1章', 0));
        await store.record(PROJECT, report('第1章', 2, 99));
        const all = await store.view(PROJECT);
        expect(Object.keys(all)).toEqual(['第1章']);
        expect(all['第1章'].warnCount).toBe(2);
        expect(vault.getAbstractFileByPath(`${PROJECT}/04-项目总控/质量面板/四项校验.json`)).toBeTruthy();
    });

    it('多章按章号自然序读取', async () => {
        const { store } = make();
        await store.record(PROJECT, report('第10章'));
        await store.record(PROJECT, report('第2章'));
        await store.record(PROJECT, report('第1章'));
        expect(Object.keys(await store.view(PROJECT))).toEqual(['第1章', '第2章', '第10章']);
    });

    it('文件损坏时降级为空，不抛错', async () => {
        const { store, vault } = make();
        vault._seedFile(`${PROJECT}/04-项目总控/质量面板/四项校验.json`, '{ broken');
        await expect(store.view(PROJECT)).resolves.toEqual({});
    });

    it('项目不存在时 record 抛错、view 返回空', async () => {
        const { store } = make();
        await expect(store.record('长篇小说/不存在', report('第1章'))).rejects.toThrow('项目不存在');
        await expect(store.view('长篇小说/不存在')).resolves.toEqual({});
    });
});

describe('compareChapterName', () => {
    it('阿拉伯数字与中文数字混合也比较出章号顺序', () => {
        const names = ['第10章', '第十二章', '第2章', '第三章'];
        expect([...names].sort(compareChapterName)).toEqual(['第2章', '第三章', '第10章', '第十二章']);
    });

    it('解析不到章号时退回字符串比较', () => {
        expect(compareChapterName('章名相同', '章名相同')).toBe(0);
        expect(compareChapterName('附录A', '附录B')).toBeLessThan(0);
    });
});
