/**
 * 事实库持久化单测（独立事实源）
 *
 * 重点锁三个「不能弄坏用户数据」的性质：
 *  1. **读失败拒绝写**（否则会把正确数据覆盖成空库）
 *  2. **原子写：目标存在直接覆盖**（rename 目标存在会抛错，本仓踩过 4 次）
 *  3. 按 章节|主体|谓词 去重，重复拆解安全
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { MockFileSystem } from '../../../../shared/file-system-port';
import {
    createFactStore,
    factKeyOf,
    loadFactStore,
    mergeFactStore,
    parseFactStore,
    saveFactStore,
    serializeFactStore,
} from '../../../../engine/consistency/fact-store';
import type { DecomposeEntry } from '../../../../engine/consistency/knowledge-decompose';

/** 造条目 */
function entry(over: Partial<DecomposeEntry> = {}): DecomposeEntry {
    return {
        type: 'age',
        subject: '宁缺',
        predicate: '年龄',
        value: '十七',
        numeric: 17,
        unit: '岁',
        validFrom: 1,
        validTo: null,
        confidence: 0.9,
        quote: '宁缺今年十七',
        ...over,
    };
}

const PATH = '项目A/04-项目总控/一致性审核/事实库.json';

describe('mergeFactStore · 合并去重', () => {
    it('新事实被追加', () => {
        const store = createFactStore();
        expect(mergeFactStore(store, 1, [entry()])).toEqual({ added: 1, updated: 0 });
        expect(store.facts).toHaveLength(1);
        expect(store.facts[0].chapter).toBe(1);
    });

    it('同章节同主体同谓词 → 更新而非重复（重复拆解安全）', () => {
        const store = createFactStore();
        mergeFactStore(store, 1, [entry()]);
        expect(mergeFactStore(store, 1, [entry({ value: '十八' })])).toEqual({ added: 0, updated: 1 });
        expect(store.facts).toHaveLength(1);
        expect(store.facts[0].value).toBe('十八');
    });

    it('不同章节可累积（形成状态轨迹）', () => {
        const store = createFactStore();
        mergeFactStore(store, 1, [entry()]);
        mergeFactStore(store, 20, [entry()]);
        expect(store.facts).toHaveLength(2);
    });

    it('结果按章节升序', () => {
        const store = createFactStore();
        mergeFactStore(store, 20, [entry()]);
        mergeFactStore(store, 1, [entry({ subject: '桑桑' })]);
        expect(store.facts.map(f => f.chapter)).toEqual([1, 20]);
    });

    it('有变更才更新 updatedAt', () => {
        const store = createFactStore(new Date(0));
        mergeFactStore(store, 1, [entry()]);
        expect(store.updatedAt).not.toBe(new Date(0).toISOString());
    });

    it('空条目不改动', () => {
        const store = createFactStore();
        expect(mergeFactStore(store, 1, [])).toEqual({ added: 0, updated: 0 });
    });
});

describe('factKeyOf', () => {
    it('由章节|主体|谓词构成', () => {
        expect(factKeyOf({ chapter: 3, subject: '宁缺', predicate: '年龄' })).toBe('3|宁缺|年龄');
    });
});

describe('loadFactStore · 3 态', () => {
    let fs: MockFileSystem;
    beforeEach(() => {
        fs = new MockFileSystem();
    });

    it('missing：文件不存在', async () => {
        const loaded = await loadFactStore(fs, PATH);
        expect(loaded.status).toBe('missing');
        expect(loaded.store.facts).toHaveLength(0);
    });

    it('ok：正常读取', async () => {
        const store = createFactStore();
        mergeFactStore(store, 1, [entry()]);
        await fs.write(PATH, serializeFactStore(store));
        const loaded = await loadFactStore(fs, PATH);
        expect(loaded.status).toBe('ok');
        expect(loaded.store.facts).toHaveLength(1);
    });

    it('read-failed：JSON 损坏', async () => {
        await fs.write(PATH, '{broken');
        const loaded = await loadFactStore(fs, PATH);
        expect(loaded.status).toBe('read-failed');
        expect(loaded.error).toContain('损坏');
    });
});

describe('saveFactStore · 原子写', () => {
    let fs: MockFileSystem;
    beforeEach(() => {
        fs = new MockFileSystem();
    });

    it('目标不存在时走 tmp + rename', async () => {
        const store = createFactStore();
        mergeFactStore(store, 1, [entry()]);
        await saveFactStore(fs, PATH, store);
        expect(await fs.exists(PATH)).toBe(true);
        expect((fs as unknown as { files: Map<string, string> }).files.size).toBe(1);
    });

    it('**目标已存在时直接覆盖写**（rename 目标存在会抛错）', async () => {
        const first = createFactStore();
        mergeFactStore(first, 1, [entry()]);
        await saveFactStore(fs, PATH, first);

        const second = createFactStore();
        mergeFactStore(second, 2, [entry({ subject: '桑桑' })]);
        await expect(saveFactStore(fs, PATH, second)).resolves.toBe(true);

        const loaded = await loadFactStore(fs, PATH);
        expect(loaded.store.facts[0].subject).toBe('桑桑');
    });

    it('**读失败时拒绝写入**（不覆盖用户已有数据）', async () => {
        await fs.write(PATH, '{broken');
        const store = createFactStore();
        mergeFactStore(store, 1, [entry()]);
        await expect(saveFactStore(fs, PATH, store, { readFailed: true })).resolves.toBe(false);
        expect(await fs.read(PATH)).toBe('{broken');
    });

    it('连续两次保存都成功（回归锁）', async () => {
        for (const chapter of [1, 2, 3]) {
            const store = await loadFactStore(fs, PATH);
            mergeFactStore(store.store, chapter, [entry({ subject: `角色${chapter}` })]);
            await saveFactStore(fs, PATH, store.store, { readFailed: store.status === 'read-failed' });
        }
        const final = await loadFactStore(fs, PATH);
        expect(final.store.facts).toHaveLength(3);
    });
});

describe('parseFactStore · 容错', () => {
    it('合法 JSON 正常解析', () => {
        const store = createFactStore();
        mergeFactStore(store, 1, [entry()]);
        expect(parseFactStore(serializeFactStore(store))?.facts).toHaveLength(1);
    });

    it('损坏 JSON → null', () => {
        expect(parseFactStore('{broken')).toBeNull();
        expect(parseFactStore('{"facts":null}')).toBeNull();
    });

    it('缺字段的条目不进入（不产生半残事实）', () => {
        const parsed = parseFactStore('{"version":1,"updatedAt":"x","facts":[{"subject":"宁缺","predicate":"年龄"},null]}');
        expect(parsed?.facts ?? []).toHaveLength(1);
    });
});
