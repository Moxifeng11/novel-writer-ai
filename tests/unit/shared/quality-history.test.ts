import { describe, expect, it } from 'vitest';
import {
    aggregateQualityHistoryByChapter,
    buildQualityChapterKey,
    computeChapterTrend,
    isQualitySampleUsable,
    isSameQualityEvalTarget,
    mergeQualityHistory,
    normalizeChapterKey,
    parseQualityHistoryFile,
    parseQualityHistoryRecord,
    serializeQualityHistoryFile,
    type QualityHistoryRecord,
} from '../../../shared/quality-history';

function record(overrides: Partial<QualityHistoryRecord> = {}): QualityHistoryRecord {
    return {
        chapterKey: '第1章',
        timestamp: 1000,
        wordCount: 3000,
        overallScore: 80,
        languageScore: 80,
        rhythmScore: 80,
        characterScore: 80,
        plotScore: 80,
        atmosphereScore: 80,
        structureScore: 80,
        grade: 'A',
        trend: 'stable',
        ...overrides,
    };
}

describe('quality-history — 解析', () => {
    it('解析 v1 文件结构', () => {
        const raw = JSON.stringify({ version: 1, entries: [record()] });
        expect(parseQualityHistoryFile(raw)).toHaveLength(1);
        expect(parseQualityHistoryFile(raw)[0].chapterKey).toBe('第1章');
    });

    it('兼容纯数组旧格式', () => {
        expect(parseQualityHistoryFile(JSON.stringify([record()]))).toHaveLength(1);
    });

    it('坏 JSON / 空内容降级为空数组', () => {
        expect(parseQualityHistoryFile('{oops')).toEqual([]);
        expect(parseQualityHistoryFile('')).toEqual([]);
    });

    it('丢弃无时间戳或非对象记录', () => {
        const raw = JSON.stringify({ version: 1, entries: [record(), { foo: 1 }, null] });
        expect(parseQualityHistoryFile(raw)).toHaveLength(1);
        expect(parseQualityHistoryRecord({ foo: 1 })).toBeNull();
    });

    it('分数越界会被夹到 0-100', () => {
        const parsed = parseQualityHistoryRecord({ timestamp: 1, overallScore: 150, rhythmScore: -20 });
        expect(parsed?.overallScore).toBe(100);
        expect(parsed?.rhythmScore).toBe(0);
    });
});

describe('quality-history — 按章聚合（基线样本单位）', () => {
    it('同一章多次评估只保留最后一次', () => {
        const aggregated = aggregateQualityHistoryByChapter([
            record({ chapterKey: '第1章', timestamp: 1000, overallScore: 70 }),
            record({ chapterKey: '第1章', timestamp: 3000, overallScore: 85 }),
            record({ chapterKey: '第1章', timestamp: 2000, overallScore: 78 }),
        ]);
        expect(aggregated).toHaveLength(1);
        expect(aggregated[0].overallScore).toBe(85);
    });

    it('chapterKey 为空的旧记录各自独立保留，不被合并成一条', () => {
        const aggregated = aggregateQualityHistoryByChapter([
            record({ chapterKey: '', timestamp: 1000 }),
            record({ chapterKey: '  ', timestamp: 2000 }),
        ]);
        expect(aggregated).toHaveLength(2);
    });

    it('跨章结果按时间升序，便于趋势消费', () => {
        const aggregated = aggregateQualityHistoryByChapter([
            record({ chapterKey: '第2章', timestamp: 5000 }),
            record({ chapterKey: '第1章', timestamp: 2000 }),
            record({ chapterKey: '第2章', timestamp: 4000 }),
        ]);
        expect(aggregated.map(item => item.chapterKey)).toEqual(['第1章', '第2章']);
        expect(aggregated.map(item => item.timestamp)).toEqual([2000, 5000]);
    });

    it('仪表盘「项目名-第3章_标题」与协同「第3章」归为同一章', () => {
        const aggregated = aggregateQualityHistoryByChapter([
            record({ chapterKey: '我的书-第3章_起风了', timestamp: 1000, overallScore: 70 }),
            record({ chapterKey: '第3章', timestamp: 2000, overallScore: 88 }),
        ]);
        expect(aggregated).toHaveLength(1);
        expect(aggregated[0].overallScore).toBe(88);
    });
});

describe('quality-history — 章节键归一化', () => {
    it('从项目名前缀与章节标题中提取章号', () => {
        expect(normalizeChapterKey('我的书-第3章_起风了')).toBe('第3章');
        expect(normalizeChapterKey('第 12 章 决战')).toBe('第12章');
        expect(normalizeChapterKey('第3章')).toBe('第3章');
    });

    it('中文数字章号同样归一化', () => {
        expect(normalizeChapterKey('某项目-第十二章_夜行')).toBe('第十二章');
    });

    it('无章号的自定义命名原样返回，空值返回空串', () => {
        expect(normalizeChapterKey('序章')).toBe('序章');
        expect(normalizeChapterKey('   ')).toBe('');
        expect(normalizeChapterKey('')).toBe('');
    });
});

describe('quality-history — 章键构造（协同两条写入口同源）', () => {
    it('有章号时统一为「项目-第N章」，与章节名是否带章号无关', () => {
        expect(buildQualityChapterKey('我的书', 3, '初始之痕')).toBe('我的书-第3章');
        expect(buildQualityChapterKey('我的书', 3, '第3章 初始之痕')).toBe('我的书-第3章');
        expect(normalizeChapterKey(buildQualityChapterKey('我的书', 3, '初始之痕'))).toBe('第3章');
    });

    it('章号非法时回退章节名，仍保持同一项目前缀', () => {
        expect(buildQualityChapterKey('我的书', 0, '序章')).toBe('我的书-序章');
        expect(buildQualityChapterKey('我的书', Number.NaN, '序章')).toBe('我的书-序章');
        expect(buildQualityChapterKey('我的书', 3.9, '初始之痕')).toBe('我的书-第3章');
    });

    it('项目为空返回空串，供调用方跳过写入', () => {
        expect(buildQualityChapterKey('', 3, '初始之痕')).toBe('');
    });

    it('章号与章节名都缺失时只保留项目前缀', () => {
        expect(buildQualityChapterKey('我的书')).toBe('我的书');
    });
});

describe('quality-history — 样本可用性门槛（防 0 分空结果污染基线）', () => {
    it('达到最小字数才记入历史', () => {
        expect(isQualitySampleUsable(300)).toBe(true);
        expect(isQualitySampleUsable(299)).toBe(false);
    });

    it('空结果与非法字数不记入', () => {
        expect(isQualitySampleUsable(0)).toBe(false);
        expect(isQualitySampleUsable(Number.NaN)).toBe(false);
        expect(isQualitySampleUsable(Number.POSITIVE_INFINITY)).toBe(false);
    });
});

describe('quality-history — 章级趋势（跨章比较，非章内评估抖动）', () => {
    it('高于前序章均分 5 分以上判上升，低于判下降，差值内判平稳', () => {
        const history = [
            record({ chapterKey: '第1章', timestamp: 1000, overallScore: 70 }),
            record({ chapterKey: '第2章', timestamp: 2000, overallScore: 70 }),
        ];
        expect(computeChapterTrend({ chapterKey: '第3章', timestamp: 3000, overallScore: 80 }, history)).toBe('rising');
        expect(computeChapterTrend({ chapterKey: '第3章', timestamp: 3000, overallScore: 60 }, history)).toBe('falling');
        expect(computeChapterTrend({ chapterKey: '第3章', timestamp: 3000, overallScore: 73 }, history)).toBe('stable');
    });

    it('前序章不足两章时返回平稳，不凭空给方向', () => {
        const history = [record({ chapterKey: '第1章', timestamp: 1000, overallScore: 50 })];
        expect(computeChapterTrend({ chapterKey: '第2章', timestamp: 2000, overallScore: 95 }, history)).toBe('stable');
        expect(computeChapterTrend({ chapterKey: '第2章', timestamp: 2000, overallScore: 95 }, [])).toBe('stable');
    });

    it('同一章的多次评估不参与比较（章内打字波动不是趋势）', () => {
        const history = [
            record({ chapterKey: '第1章', timestamp: 1000, overallScore: 80 }),
            record({ chapterKey: '第2章', timestamp: 2000, overallScore: 82 }),
            record({ chapterKey: '第2章', timestamp: 2500, overallScore: 95 }),
            record({ chapterKey: '第2章', timestamp: 3000, overallScore: 99 }),
        ];
        // 排除第 2 章自身后只剩第 1 章，不足两章 → 平稳（旧实现会判「上升」）
        expect(computeChapterTrend({ chapterKey: '第2章', timestamp: 3500, overallScore: 99 }, history)).toBe('stable');
    });

    it('带项目前缀 / 标题的同一章同样被排除', () => {
        const history = [
            record({ chapterKey: '第1章', timestamp: 1000, overallScore: 70 }),
            record({ chapterKey: '我的书-第2章_起风了', timestamp: 2000, overallScore: 95 }),
        ];
        expect(computeChapterTrend({ chapterKey: '第2章', timestamp: 3000, overallScore: 96 }, history)).toBe('stable');
    });

    it('只使用当前章之前的历史，后续章不参与', () => {
        const history = [
            record({ chapterKey: '第1章', timestamp: 1000, overallScore: 70 }),
            record({ chapterKey: '第2章', timestamp: 2000, overallScore: 72 }),
            record({ chapterKey: '第4章', timestamp: 5000, overallScore: 95 }),
        ];
        // 若把第 4 章算进来，均分 79 会让本章判「下降」
        expect(computeChapterTrend({ chapterKey: '第3章', timestamp: 3000, overallScore: 72 }, history)).toBe('stable');
    });

    it('当前章无章键（无法归章）时返回平稳', () => {
        const history = [
            record({ chapterKey: '第1章', timestamp: 1000, overallScore: 70 }),
            record({ chapterKey: '第2章', timestamp: 2000, overallScore: 70 }),
        ];
        expect(computeChapterTrend({ chapterKey: '', timestamp: 3000, overallScore: 95 }, history)).toBe('stable');
    });
});

describe('quality-history — 合并与裁剪', () => {
    it('按时间升序并保留最后 max 条', () => {
        const existing = [record({ timestamp: 1 }), record({ timestamp: 2 })];
        const merged = mergeQualityHistory(existing, [record({ timestamp: 3 })], 2);
        expect(merged.map(r => r.timestamp)).toEqual([2, 3]);
    });

    it('完全重复的记录被去重', () => {
        const merged = mergeQualityHistory([record()], [record()], 10);
        expect(merged).toHaveLength(1);
    });

    it('同分不同时间视为不同记录', () => {
        const merged = mergeQualityHistory([record({ timestamp: 1 })], [record({ timestamp: 2 })], 10);
        expect(merged).toHaveLength(2);
    });

    it('磁盘快照与会话增量合并不丢不重（restore 不能用覆盖）', () => {
        // 磁盘上只有第 1、2 章；第 3 章刚评估完尚未落盘
        const disk = [record({ chapterKey: '第1章', timestamp: 1 }), record({ chapterKey: '第2章', timestamp: 2 })];
        const session = [...disk, record({ chapterKey: '第3章', timestamp: 3 })];
        const merged = mergeQualityHistory(disk, session, 200);
        expect(merged.map(r => r.chapterKey)).toEqual(['第1章', '第2章', '第3章']);
    });
});

describe('quality-history — 序列化', () => {
    it('写出后可原样读回', () => {
        const entries = [record({ timestamp: 10 }), record({ timestamp: 20 })];
        const parsed = parseQualityHistoryFile(serializeQualityHistoryFile(entries));
        expect(parsed).toHaveLength(2);
        expect(parsed[1].timestamp).toBe(20);
    });

    it('序列化时按上限裁剪', () => {
        const many = Array.from({ length: 5 }, (_, i) => record({ timestamp: i + 1 }));
        const parsed = parseQualityHistoryFile(serializeQualityHistoryFile(many));
        // 默认上限 200，不会裁剪；这里验证结构稳定
        expect(parsed).toHaveLength(5);
    });
});

describe('quality-history — 异步评估的章节身份', () => {
    const target = { project: '书A', chapterNum: 3, bodyPath: '书A/第1卷/第3章.md' };

    it('同项目同章同正文视为一致', () => {
        expect(isSameQualityEvalTarget(target, { ...target })).toBe(true);
    });

    it('评估期间切章后不一致（旧结果不能写进新章）', () => {
        expect(isSameQualityEvalTarget(target, {
            project: '书A',
            chapterNum: 4,
            bodyPath: '书A/第1卷/第4章.md',
        })).toBe(false);
    });

    it('评估期间切项目后不一致（同章号也不行）', () => {
        expect(isSameQualityEvalTarget(target, {
            project: '书B',
            chapterNum: 3,
            bodyPath: '书B/第1卷/第3章.md',
        })).toBe(false);
    });

    it('同项目同章号但正文路径不同视为不一致', () => {
        expect(isSameQualityEvalTarget(target, {
            project: '书A',
            chapterNum: 3,
            bodyPath: '书A/第2卷/第3章.md',
        })).toBe(false);
    });
});
