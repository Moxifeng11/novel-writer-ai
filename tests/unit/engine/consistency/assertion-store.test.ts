/**
 * 断言库读写单测（S1）
 *
 * 最重要的一条：**读取失败时绝不覆盖**。
 * 这是本项目反复踩过的坑（读失败当没有→写回空数据→丢历史），
 * 所以这里用「损坏 JSON」与「exists 抛错」两种方式把它钉死。
 */

import { describe, expect, it, vi } from 'vitest';
import { MockFileSystem } from '../../../../shared/file-system-port';
import {
    ASSERTIONS_FORMAT_VERSION,
    isPersistedAssertion,
    loadAssertions,
    mergeAndSaveAssertions,
    saveAssertions,
} from '../../../../engine/consistency/assertion-store';
import type { FactAssertion } from '../../../../engine/consistency/assertion-model';
import { pjAssertionsFile } from '../../../../shared/paths';

const PROJECT = '测试项目';

/** 造一条合法断言 */
function makeAssertion(overrides: Partial<FactAssertion> = {}): FactAssertion {
    return {
        id: 'quantitative|张三|年龄|第1章',
        kind: 'quantitative',
        subject: '张三',
        predicate: '年龄',
        value: '18',
        numericValue: 18,
        unit: '岁',
        chapterKey: '第1章',
        chapterNum: 1,
        quote: '张三今年十八岁',
        source: 'digest-fact',
        extractedAt: 1_700_000_000_000,
        ...overrides,
    };
}

describe('断言库 · 读取三态', () => {
    it('文件不存在 → missing（首次运行，允许写空）', async () => {
        const fs = new MockFileSystem();
        const result = await loadAssertions(fs, PROJECT);
        expect(result.status).toBe('missing');
    });

    it('写入后读取 → ok，且带上格式版本', async () => {
        const fs = new MockFileSystem();
        await saveAssertions(fs, PROJECT, [makeAssertion()]);
        const result = await loadAssertions(fs, PROJECT);
        expect(result.status).toBe('ok');
        if (result.status !== 'ok') return;
        expect(result.assertions).toHaveLength(1);
        expect(result.assertions[0].subject).toBe('张三');
    });

    it('JSON 损坏 → read-failed（不是 missing，更不是空成功）', async () => {
        const fs = new MockFileSystem();
        await fs.mkdir(`${PROJECT}/04-项目总控/一致性审核`).catch(() => undefined);
        await fs.write(pjAssertionsFile(PROJECT), '{ 这不是合法 JSON');
        const result = await loadAssertions(fs, PROJECT);
        expect(result.status).toBe('read-failed');
        if (result.status === 'read-failed') expect(result.reason).toContain('解析失败');
    });

    it('exists 抛错 → read-failed', async () => {
        const fs = new MockFileSystem();
        const spy = vi.spyOn(fs, 'exists').mockRejectedValue(new Error('权限不足'));
        const result = await loadAssertions(fs, PROJECT);
        expect(result.status).toBe('read-failed');
        spy.mockRestore();
    });

    it('损坏条目被过滤掉（旧格式/手改不会污染）', async () => {
        const fs = new MockFileSystem();
        await fs.mkdir(`${PROJECT}/04-项目总控/一致性审核`).catch(() => undefined);
        await fs.write(
            pjAssertionsFile(PROJECT),
            JSON.stringify({
                version: ASSERTIONS_FORMAT_VERSION,
                updatedAt: new Date(0).toISOString(),
                assertions: [makeAssertion(), { id: 'bad' }, null, 'string'],
            }),
        );
        const result = await loadAssertions(fs, PROJECT);
        expect(result.status).toBe('ok');
        if (result.status === 'ok') expect(result.assertions).toHaveLength(1);
    });
});

describe('断言库 · 写入', () => {
    it('写入后不残留 .tmp 临时文件', async () => {
        const fs = new MockFileSystem();
        await saveAssertions(fs, PROJECT, [makeAssertion()]);
        expect(await fs.exists(`${pjAssertionsFile(PROJECT)}.tmp`)).toBe(false);
        expect(await fs.exists(pjAssertionsFile(PROJECT))).toBe(true);
    });

    it('写入内容含 version / updatedAt / assertions', async () => {
        const fs = new MockFileSystem();
        await saveAssertions(fs, PROJECT, [makeAssertion()], () => new Date('2026-11-13T00:00:00.000Z'));
        const raw = await fs.read(pjAssertionsFile(PROJECT));
        const parsed = JSON.parse(raw) as { version: number; updatedAt: string; assertions: unknown[] };
        expect(parsed.version).toBe(ASSERTIONS_FORMAT_VERSION);
        expect(parsed.updatedAt).toBe('2026-11-13T00:00:00.000Z');
        expect(parsed.assertions).toHaveLength(1);
    });
});

describe('断言库 · 增量合并（关键回归锁）', () => {
    it('首次合并：全部新增', async () => {
        const fs = new MockFileSystem();
        const result = await mergeAndSaveAssertions(fs, PROJECT, [makeAssertion()]);
        expect(result.saved).toBe(true);
        expect(result.added).toBe(1);
        expect(result.total).toBe(1);
    });

    it('重复合并同一断言：added=0，不重复写入', async () => {
        const fs = new MockFileSystem();
        await mergeAndSaveAssertions(fs, PROJECT, [makeAssertion()]);
        const result = await mergeAndSaveAssertions(fs, PROJECT, [makeAssertion()]);
        expect(result.added).toBe(0);
        expect(result.total).toBe(1);
    });

    it('合并新章节断言：累加', async () => {
        const fs = new MockFileSystem();
        await mergeAndSaveAssertions(fs, PROJECT, [makeAssertion()]);
        const result = await mergeAndSaveAssertions(fs, PROJECT, [
            makeAssertion({
                id: 'quantitative|张三|年龄|第40章',
                chapterKey: '第40章',
                chapterNum: 40,
                value: '20',
                numericValue: 20,
                quote: '张三今年二十岁',
            }),
        ]);
        expect(result.added).toBe(1);
        expect(result.total).toBe(2);
    });

    it('**读取失败时拒绝写入，历史数据不被清空**（本项目核心教训）', async () => {
        const fs = new MockFileSystem();
        await fs.mkdir(`${PROJECT}/04-项目总控/一致性审核`).catch(() => undefined);
        const corrupted = '{ 损坏的内容，人工还有可能修好';
        await fs.write(pjAssertionsFile(PROJECT), corrupted);

        const result = await mergeAndSaveAssertions(fs, PROJECT, [makeAssertion()]);

        expect(result.saved).toBe(false);
        expect(result.reason).toContain('解析失败');
        // 关键：磁盘内容必须原样保留
        expect(await fs.read(pjAssertionsFile(PROJECT))).toBe(corrupted);
    });
});

describe('isPersistedAssertion · 运行时校验', () => {
    it('完整断言通过', () => {
        expect(isPersistedAssertion(makeAssertion())).toBe(true);
    });

    it('缺字段不通过', () => {
        expect(isPersistedAssertion({ ...makeAssertion(), subject: undefined })).toBe(false);
        expect(isPersistedAssertion({ ...makeAssertion(), quote: '' })).toBe(false);
    });

    it('非对象不通过', () => {
        expect(isPersistedAssertion(null)).toBe(false);
        expect(isPersistedAssertion('x')).toBe(false);
        expect(isPersistedAssertion(42)).toBe(false);
    });
});

describe('重复写入（回归锁 · 生产环境实测到的 bug）', () => {
    it('**同一路径写第二次必须成功覆盖**（rename 覆盖会抛 Destination file already exists）', async () => {
        const fs = new MockFileSystem();
        await saveAssertions(fs, PROJECT, [makeAssertion()]);
        // 第二次写入新的断言集：若实现用 rename 覆盖已存在文件，这里会抛
        await expect(saveAssertions(fs, PROJECT, [
            makeAssertion(),
            makeAssertion({ id: 'q2', chapterKey: '第2章', subject: '李四' }),
        ])).resolves.toBeUndefined();

        const loaded = await loadAssertions(fs, PROJECT);
        expect(loaded.status).toBe('ok');
        if (loaded.status === 'ok') expect(loaded.assertions).toHaveLength(2);
    });

    it('连续合并两次（第二次读到的已存在文件）不抛错', async () => {
        const fs = new MockFileSystem();
        await mergeAndSaveAssertions(fs, PROJECT, [makeAssertion()]);
        const second = await mergeAndSaveAssertions(fs, PROJECT, [
            makeAssertion({ id: 'q3', chapterKey: '第3章', subject: '王五' }),
        ]);
        expect(second.saved).toBe(true);
        expect(second.total).toBe(2);
    });
});
