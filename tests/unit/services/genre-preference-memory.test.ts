import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
    GenrePreferenceMemory,
    type GenreCorrectionRecord,
    type GenrePreferenceData,
} from '@/services/genre-preference-memory';

/**
 * GenrePreferenceMemory 的行为契约。
 *
 * 背景：该服务是题材偏好学习的内存态 + 防抖落盘层（knowledge-base-manager 持有）。
 * 它决定「用户纠正题材后，下次自动分类偏向哪一档」，属于用户可感知的偏好记忆。
 * 这里只锁定真实语义（累积/衰减/去重/上限/导入导出/flush），不造不可达防御分支。
 */

/** 构造一份干净的持久化数据，避免用例之间通过 DEFAULT 常量互相污染。 */
function emptyData(): GenrePreferenceData {
    return {
        corrections: [],
        genreBias: {},
        subGenreBias: {},
        channelBias: {},
        autoClassifyCount: 0,
        manualCorrectionCount: 0,
        lastUpdated: 0,
    };
}

/** 构造一条最小纠正记录。 */
function correction(overrides: Partial<Omit<GenreCorrectionRecord, 'timestamp'>>): Omit<GenreCorrectionRecord, 'timestamp'> {
    return { bookId: 'b1', bookTitle: '测试书', ...overrides };
}

describe('GenrePreferenceMemory', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-08T00:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('无持久化数据时读出全量默认值，准确率按「无样本 = 1」', () => {
        const memory = new GenrePreferenceMemory();

        expect(memory.getData()).toEqual(emptyData());
        expect(memory.getAccuracy()).toBe(1);
        expect(memory.getGenreBias('xuanhuan')).toBe(0);
        expect(memory.getSubGenreBias('xuanhuan', 'upgrade')).toBe(0);
        expect(memory.getChannelBias('male')).toBe(0);
    });

    it('部分持久化数据与默认值合并，缺省字段补齐', () => {
        const saved = { autoClassifyCount: 4, manualCorrectionCount: 1 } as GenrePreferenceData;
        const memory = new GenrePreferenceMemory(saved);

        expect(memory.getData().corrections).toEqual([]);
        expect(memory.getData().genreBias).toEqual({});
        expect(memory.getAccuracy()).toBeCloseTo(0.75, 4);
    });

    it('setData 替换数据并在 500ms 防抖后落盘一次', async () => {
        const save = vi.fn(async (_data: GenrePreferenceData) => undefined);
        const memory = new GenrePreferenceMemory(emptyData(), save);

        const next = { ...emptyData(), genreBias: { xuanhuan: 0.5 } };
        const pending = memory.setData(next);
        await vi.advanceTimersByTimeAsync(600);
        await pending;

        expect(memory.getData().genreBias).toEqual({ xuanhuan: 0.5 });
        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0][0]).toMatchObject({ genreBias: { xuanhuan: 0.5 } });
    });

    it('连续 recordAutoClassify 只触发一次落盘（防抖合并）', async () => {
        const save = vi.fn(async () => undefined);
        const memory = new GenrePreferenceMemory(emptyData(), save);

        memory.recordAutoClassify();
        memory.recordAutoClassify();
        expect(memory.getStats().autoClassifyCount).toBe(2);

        await vi.advanceTimersByTimeAsync(600);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('recordCorrection 置顶记录、累计纠正次数并刷新 lastUpdated', () => {
        const memory = new GenrePreferenceMemory(emptyData());
        vi.setSystemTime(new Date('2026-11-08T01:00:00Z'));

        memory.recordCorrection(correction({ correctedGenre: 'xuanhuan' }));

        const data = memory.getData();
        expect(data.corrections).toHaveLength(1);
        expect(data.corrections[0]).toMatchObject({
            bookId: 'b1',
            correctedGenre: 'xuanhuan',
            timestamp: Date.now(),
        });
        expect(data.manualCorrectionCount).toBe(1);
        expect(data.lastUpdated).toBe(Date.now());
    });

    it('纠正记录超过 200 条时保留最新 200 条（去重上限）', () => {
        const memory = new GenrePreferenceMemory(emptyData());

        for (let i = 0; i < 201; i++) {
            memory.recordCorrection(correction({ bookId: `b${i}` }));
        }

        const data = memory.getData();
        expect(data.corrections).toHaveLength(200);
        expect(data.corrections[0].bookId).toBe('b200');
        expect(data.corrections[199].bookId).toBe('b1');
        expect(data.manualCorrectionCount).toBe(201);
    });

    it('同题材多次纠正按 +0.15 累积并逐次衰减', () => {
        const memory = new GenrePreferenceMemory(emptyData());

        memory.recordCorrection(correction({ correctedGenre: 'xuanhuan' }));
        expect(memory.getGenreBias('xuanhuan')).toBeCloseTo(0.1425, 4);

        memory.recordCorrection(correction({ correctedGenre: 'xuanhuan' }));
        expect(memory.getGenreBias('xuanhuan')).toBeCloseTo(0.277875, 4);
    });

    it('纠正时原题材偏置下调、新题材上调', () => {
        const memory = new GenrePreferenceMemory({
            ...emptyData(),
            genreBias: { dushi: 0.2 },
        });

        memory.recordCorrection(correction({ originalGenre: 'dushi', correctedGenre: 'xuanhuan' }));

        expect(memory.getGenreBias('xuanhuan')).toBeCloseTo(0.1425, 4);
        expect(memory.getGenreBias('dushi')).toBeCloseTo(0.11875, 4);
    });

    it('偏置衰减到 0.01 以下时直接删除键，避免零值堆积', () => {
        const memory = new GenrePreferenceMemory({
            ...emptyData(),
            genreBias: { stale: 0.01 },
        });

        memory.recordCorrection(correction({ correctedGenre: 'fresh' }));

        expect(memory.getData().genreBias.stale).toBeUndefined();
        expect(memory.getGenreBias('fresh')).toBeCloseTo(0.1425, 4);
    });

    it('子题材偏置以 genre:subGenre 为键累加', () => {
        const memory = new GenrePreferenceMemory(emptyData());

        memory.recordCorrection(correction({ correctedGenre: 'xuanhuan', correctedSubGenre: 'upgrade' }));

        expect(memory.getSubGenreBias('xuanhuan', 'upgrade')).toBeCloseTo(0.1425, 4);
    });

    it('频道偏置累加，原频道下调', () => {
        const memory = new GenrePreferenceMemory({
            ...emptyData(),
            channelBias: { male: 0.2 },
        });

        memory.recordCorrection(correction({ originalChannel: 'male', correctedChannel: 'female' }));

        expect(memory.getChannelBias('female')).toBeCloseTo(0.1425, 4);
        expect(memory.getChannelBias('male')).toBeCloseTo(0.11875, 4);
    });

    it('准确率在无自动分类时按 1，纠正多于分类时夹到 0', () => {
        const noAuto = new GenrePreferenceMemory({ ...emptyData(), manualCorrectionCount: 3 });
        expect(noAuto.getAccuracy()).toBe(1);

        const overCorrected = new GenrePreferenceMemory({
            ...emptyData(),
            autoClassifyCount: 2,
            manualCorrectionCount: 5,
        });
        expect(overCorrected.getAccuracy()).toBe(0);
    });

    it('getStats 统计被纠正题材次数、降序并最多返回 10 项', () => {
        const corrections: GenreCorrectionRecord[] = [
            { bookId: 'b1', bookTitle: '1', timestamp: 1, correctedGenre: 'a' },
            { bookId: 'b2', bookTitle: '2', timestamp: 2, correctedGenre: 'a' },
            { bookId: 'b3', bookTitle: '3', timestamp: 3, correctedGenre: 'b' },
            { bookId: 'b4', bookTitle: '4', timestamp: 4 },
        ];
        for (let i = 0; i < 12; i++) {
            corrections.push({ bookId: `c${i}`, bookTitle: `${i}`, timestamp: 5 + i, correctedGenre: `g${i}` });
        }

        const memory = new GenrePreferenceMemory({ ...emptyData(), corrections });
        const stats = memory.getStats();

        expect(stats.topCorrectedGenres).toHaveLength(10);
        expect(stats.topCorrectedGenres[0]).toEqual({ genreId: 'a', count: 2 });
        expect(stats.topCorrectedGenres[1]).toEqual({ genreId: 'b', count: 1 });
        expect(stats.topCorrectedGenres.some(item => item.genreId === 'g11')).toBe(false);
    });

    it('findSimilarCorrections 按关键词命中数排序、忽略大小写、支持上限与空输入', () => {
        const memory = new GenrePreferenceMemory({
            ...emptyData(),
            corrections: [
                { bookId: 'b1', bookTitle: '1', timestamp: 1, bookKeywords: ['玄幻', '升级'] },
                { bookId: 'b2', bookTitle: '2', timestamp: 2, bookKeywords: ['都市'] },
                { bookId: 'b3', bookTitle: '3', timestamp: 3, bookKeywords: ['xuanhuan'] },
                { bookId: 'b4', bookTitle: '4', timestamp: 4 },
            ],
        });

        expect(memory.findSimilarCorrections(['玄幻']).map(item => item.bookId)).toEqual(['b1']);
        expect(memory.findSimilarCorrections(['XUANHUAN']).map(item => item.bookId)).toEqual(['b3']);
        expect(memory.findSimilarCorrections(['玄幻'], 0)).toEqual([]);
        expect(memory.findSimilarCorrections([])).toEqual([]);
        expect(memory.findSimilarCorrections(['不存在'])).toEqual([]);
    });

    it('exportConfig 与 importConfig 往返保留数据', async () => {
        const memory = new GenrePreferenceMemory(emptyData());
        memory.recordCorrection(correction({ correctedGenre: 'xuanhuan' }));

        const another = new GenrePreferenceMemory(emptyData());
        expect(await another.importConfig(memory.exportConfig())).toBe(true);

        expect(another.getData().corrections).toHaveLength(1);
        expect(another.getData().corrections[0].bookId).toBe('b1');
        expect(another.getGenreBias('xuanhuan')).toBeCloseTo(0.1425, 4);
    });

    it('importConfig 对非法 JSON / null 返回 false，对缺字段对象补默认值', async () => {
        const memory = new GenrePreferenceMemory(emptyData());

        expect(await memory.importConfig('{oops')).toBe(false);
        expect(await memory.importConfig('null')).toBe(false);

        vi.setSystemTime(new Date('2026-11-08T02:00:00Z'));
        expect(await memory.importConfig('{}')).toBe(true);
        expect(memory.getData().corrections).toEqual([]);
        expect(memory.getData().autoClassifyCount).toBe(0);
        expect(memory.getData().lastUpdated).toBe(Date.now());
    });

    it('flush 立即落盘并清掉待触发的防抖定时器', async () => {
        const save = vi.fn(async () => undefined);
        const memory = new GenrePreferenceMemory(emptyData(), save);

        memory.recordCorrection(correction({ correctedGenre: 'xuanhuan' }));
        await memory.flush();

        expect(save).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(600);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('落盘失败不抛给调用方（防抖与 flush 两条路径都吞错）', async () => {
        const save = vi.fn(async () => {
            throw new Error('disk full');
        });
        const memory = new GenrePreferenceMemory(emptyData(), save);

        memory.recordAutoClassify();
        await vi.advanceTimersByTimeAsync(600);
        expect(save).toHaveBeenCalledTimes(1);

        memory.recordCorrection(correction({ correctedGenre: 'xuanhuan' }));
        await expect(memory.flush()).resolves.toBeUndefined();
    });

    it('reset 清空纠正记录与偏置统计', () => {
        const memory = new GenrePreferenceMemory(emptyData());
        memory.recordCorrection(correction({ correctedGenre: 'xuanhuan' }));

        memory.reset();

        expect(memory.getData().corrections).toEqual([]);
        expect(memory.getData().manualCorrectionCount).toBe(0);
        expect(memory.getGenreBias('xuanhuan')).toBe(0);
    });

    it('多实例互不可见，reset 也不污染其他实例', () => {
        const first = new GenrePreferenceMemory();
        const second = new GenrePreferenceMemory({ autoClassifyCount: 4 } as GenrePreferenceData);

        first.recordCorrection(correction({ correctedGenre: 'xuanhuan', originalGenre: 'dushi' }));

        expect(first.getData().corrections).toHaveLength(1);
        expect(second.getData().corrections).toHaveLength(0);
        expect(second.getGenreBias('xuanhuan')).toBe(0);

        second.recordCorrection(correction({ correctedGenre: 'yanqing' }));
        first.reset();

        expect(first.getData()).toEqual(emptyData());
        expect(second.getData().corrections).toHaveLength(1);
        expect(second.getGenreBias('yanqing')).toBeGreaterThan(0);
    });
});
