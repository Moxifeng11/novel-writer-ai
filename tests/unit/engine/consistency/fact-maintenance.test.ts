/**
 * 事实库自动维护单测
 *
 * 锁住四条「自动维护不能出事」的性质：
 *  1. 按章幂等（已拆过就跳过，不重复花钱）
 *  2. 事实库损坏时**拒绝写入**（不覆盖用户数据）
 *  3. 模型失败/解析失败只返回失败状态，不抛错（不阻断结算）
 *  4. 正常路径正确合并入库
 */

import { describe, expect, it } from 'vitest';
import { MockFileSystem } from '../../../../shared/file-system-port';
import { pjFactStoreFile } from '../../../../shared/paths';
import { createFactStore, loadFactStore, serializeFactStore } from '../../../../engine/consistency/fact-store';
import { maintainChapterFacts, maintainFactsBatch } from '../../../../engine/consistency/fact-maintenance';
import type { LlmCaller } from '../../../../engine/consistency/pairing-llm';

const PROJECT = '项目A';
const BODY = '宁缺今年十七岁。渭城城墙很厚。';

/** 造模型调用器（返回含 1 条合法条目的 JSON） */
function callerOf(entries: unknown[] = [{
    type: 'age',
    subject: '宁缺',
    predicate: '年龄',
    value: '十七',
    numeric: 17,
    unit: '岁',
    validFrom: 1,
    validTo: null,
    confidence: 0.9,
    quote: '宁缺今年十七岁',
}]): LlmCaller {
    return async () => ({ content: JSON.stringify({ entries }) });
}

describe('maintainChapterFacts · 正常路径', () => {
    it('拆解结果入库（新增计数正确）', async () => {
        const fs = new MockFileSystem();
        const result = await maintainChapterFacts({ fs, caller: callerOf() }, PROJECT, { num: 1, body: BODY });
        expect(result.status).toBe('ok');
        expect(result.added).toBe(1);
        const loaded = await loadFactStore(fs, pjFactStoreFile(PROJECT));
        expect(loaded.store.facts).toHaveLength(1);
        expect(loaded.store.facts[0]).toMatchObject({ subject: '宁缺', chapter: 1, value: '十七' });
    });
});

describe('maintainChapterFacts · 幂等', () => {
    it('已拆过的章跳过（不重复花钱）', async () => {
        const fs = new MockFileSystem();
        await maintainChapterFacts({ fs, caller: callerOf() }, PROJECT, { num: 1, body: BODY });
        const second = await maintainChapterFacts({ fs, caller: callerOf() }, PROJECT, { num: 1, body: BODY });
        expect(second.status).toBe('up-to-date');
    });

    it('force 时重拆', async () => {
        const fs = new MockFileSystem();
        await maintainChapterFacts({ fs, caller: callerOf() }, PROJECT, { num: 1, body: BODY });
        const forced = await maintainChapterFacts({ fs, caller: callerOf() }, PROJECT, { num: 1, body: BODY }, { force: true });
        expect(forced.status).toBe('ok');
    });
});

describe('maintainChapterFacts · 拒绝覆盖用户数据', () => {
    it('**事实库损坏 → 失败且不写入**', async () => {
        const fs = new MockFileSystem();
        await fs.write(pjFactStoreFile(PROJECT), '{broken');
        const result = await maintainChapterFacts({ fs, caller: callerOf() }, PROJECT, { num: 1, body: BODY });
        expect(result.status).toBe('failed');
        expect(result.reason).toContain('不可读');
        expect(await fs.read(pjFactStoreFile(PROJECT))).toBe('{broken');
    });
});

describe('maintainChapterFacts · 失败不抛错', () => {
    it('无模型调用器 → skipped', async () => {
        const result = await maintainChapterFacts({ fs: new MockFileSystem() }, PROJECT, { num: 1, body: BODY });
        expect(result.status).toBe('skipped');
    });

    it('模型返回 error → failed（不抛错）', async () => {
        const fs = new MockFileSystem();
        const caller: LlmCaller = async () => ({ content: '', error: '超时' });
        const result = await maintainChapterFacts({ fs, caller }, PROJECT, { num: 1, body: BODY });
        expect(result.status).toBe('failed');
        expect(result.reason).toContain('超时');
    });

    it('模型抛异常 → failed（不抛错）', async () => {
        const fs = new MockFileSystem();
        const caller: LlmCaller = async () => {
            throw new Error('网络错误');
        };
        await expect(maintainChapterFacts({ fs, caller }, PROJECT, { num: 1, body: BODY })).resolves.toMatchObject({ status: 'failed' });
    });

    it('返回非 JSON → failed', async () => {
        const fs = new MockFileSystem();
        const caller: LlmCaller = async () => ({ content: '抱歉我做不到' });
        const result = await maintainChapterFacts({ fs, caller }, PROJECT, { num: 1, body: BODY });
        expect(result.status).toBe('failed');
    });

    it('正文为空 → skipped', async () => {
        const result = await maintainChapterFacts({ fs: new MockFileSystem(), caller: callerOf() }, PROJECT, { num: 1, body: '  ' });
        expect(result.status).toBe('skipped');
    });

    it('章节号无效 → skipped', async () => {
        const result = await maintainChapterFacts({ fs: new MockFileSystem(), caller: callerOf() }, PROJECT, { num: 0, body: BODY });
        expect(result.status).toBe('skipped');
    });
});

describe('maintainFactsBatch', () => {
    it('逐章处理并汇总', async () => {
        const fs = new MockFileSystem();
        // 预置第1章已拆解
        const store = createFactStore();
        store.facts.push({
            type: 'age', subject: '旧', predicate: '年龄', value: '1', validFrom: 1, validTo: null,
            confidence: 0.9, quote: 'q', chapter: 1,
        });
        await fs.write(fjPath(), serializeFactStore(store));

        const summary = await maintainFactsBatch({ fs, caller: callerOf() }, PROJECT, [
            { num: 1, body: BODY },
            { num: 2, body: BODY },
        ]);
        expect(summary.processed).toBe(2);
        expect(summary.ok).toBe(1);
        expect(summary.skipped).toBe(1);
        expect(summary.added).toBe(1);
    });

    it('limit 生效', async () => {
        const fs = new MockFileSystem();
        const summary = await maintainFactsBatch({ fs, caller: callerOf() }, PROJECT, [
            { num: 1, body: BODY },
            { num: 2, body: BODY },
            { num: 3, body: BODY },
        ], { limit: 1 });
        expect(summary.processed).toBe(1);
    });

    it('onProgress 回调按顺序触发', async () => {
        const fs = new MockFileSystem();
        const seen: number[] = [];
        await maintainFactsBatch({ fs, caller: callerOf() }, PROJECT, [
            { num: 1, body: BODY },
            { num: 2, body: BODY },
        ], { onProgress: done => seen.push(done) });
        expect(seen).toEqual([1, 2]);
    });
});

/**
 * 事实库路径（测试内联同名工具）。
 *
 * @returns 路径
 */
function fjPath(): string {
    return pjFactStoreFile(PROJECT);
}
