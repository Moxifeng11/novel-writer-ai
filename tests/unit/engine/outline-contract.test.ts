import { describe, expect, it } from 'vitest';
import {
    OUTLINE_VOLUME_REQUIRED_KEYS,
    analyzeChapterTable,
    buildProportionalChapterRanges,
    chunkRanges,
    consolidateChapterTable,
    extractFieldValue,
    findMissingChapterRanges,
    normalizeChapterRanges,
    normalizeOutlineSettings,
    validateBlueprintCompleteness,
    validateChapterRanges,
    validateGlobalChapterContinuity,
    validateVolumeStructure,
    type BlueprintValidationContext,
} from '../../../engine/outline-contract';

/**
 * 契约层边界与稳定性验证。
 *
 * 这些用例覆盖的正是原算法「缺失的校验逻辑」：
 * 章号总数放大、越界/重复章号穿透、字段占位符、蓝图稀薄、跨卷重叠与全书缺章。
 */

/** 构造一份完全合规的卷级 Markdown（14 字段 + 精确覆盖 [start, end] 的章节表） */
function validVolume(volumeNumber: number, start: number, end: number, extraLines: string[] = []): string {
    const rows: string[] = [];
    for (let n = start; n <= end; n++) rows.push(`| ${n} | 第${n}章核心冲突 |`);
    return [
        `### 第${volumeNumber}卷`,
        '- **卷名**：《试炼之路》',
        `- **章节范围**：第${start}章 - 第${end}章`,
        '- **核心冲突**：主角在绝境中逆袭',
        '- **主要事件**：',
        '  - 事件一',
        '- **人物弧光**：',
        '  - 主角完成初步成长',
        '- **本卷字数**：约 1 万字',
        `- **本卷高潮**：第${end}章决战`,
        '- **结尾过渡**：主角踏入更大的舞台',
        '- **三幕结构**：建置阶段／对抗阶段／解决阶段',
        `- **爽点节奏**：第${end}章：觉醒`,
        '- **反转路线**：小反转→中反转',
        '- **情绪曲线**：低谷→上升→高潮',
        '- **伏笔安排**：埋设：血脉真相',
        '- **势力变动**：裴家：衰落',
        '- **章节分配**：',
        '| 章号 | 核心冲突 |',
        '|---|---|',
        ...rows,
        ...extraLines,
    ].join('\n');
}

const baseCtx: BlueprintValidationContext = {
    volumes: 2,
    totalChapters: 5,
    chapterRanges: [[1, 3], [4, 5]],
    hasCharacters: false,
    hasFactions: false,
};

describe('outline-contract — 设置归一化', () => {
    it('非法参数回退默认值，且 totalChapters 至少为分卷数', () => {
        const fallback = normalizeOutlineSettings({ totalWords: 'abc', volumes: 0, wordsPerChapter: 0 });
        expect(fallback.totalWords).toBe(1_000_000);
        expect(fallback.volumes).toBe(3);
        expect(fallback.wordsPerChapter).toBe(2500);
        expect(fallback.totalChapters).toBe(400);

        // 总章数少于分卷数时向上抬到 volumes，避免出现「0 章卷」
        const tiny = normalizeOutlineSettings({ totalWords: '100', volumes: 8, wordsPerChapter: 100 });
        expect(tiny.totalChapters).toBe(8);
    });
});

describe('outline-contract — 章号范围契约', () => {
    it('按比例分配时总和恒等于总章数（400 章 3 卷不再放大成 402）', () => {
        expect(buildProportionalChapterRanges(3, 400)).toEqual([[1, 134], [135, 267], [268, 400]]);
        expect(buildProportionalChapterRanges(2, 5)).toEqual([[1, 3], [4, 5]]);
        expect(buildProportionalChapterRanges(3, 10)).toEqual([[1, 4], [5, 7], [8, 10]]);
        for (const [v, t] of [[1, 1], [5, 7], [4, 100]] as const) {
            const ranges = buildProportionalChapterRanges(v, t);
            expect(ranges.reduce((sum, r) => sum + (r[1] - r[0] + 1), 0)).toBe(t);
            expect(ranges[0][0]).toBe(1);
            expect(ranges[ranges.length - 1][1]).toBe(t);
        }
    });

    it('逐项拦截：长度不符 / 不连续 / 起点非 1 / 总和不等 / 非法结构', () => {
        expect(validateChapterRanges([[1, 3], [4, 5]], 2, 5)).toBeNull();
        expect(validateChapterRanges([[1, 3]], 2, 5)).toContain('长度');
        expect(validateChapterRanges([[1, 3], [5, 6]], 2, 6)).toContain('不连续');
        expect(validateChapterRanges([[2, 3], [4, 5]], 2, 5)).toContain('起始章号必须为 1');
        expect(validateChapterRanges([[1, 3], [4, 6]], 2, 5)).toContain('章号总数');
        expect(validateChapterRanges('nope', 2, 5)).toContain('不是数组');
        expect(validateChapterRanges([[1, 'x'], [4, 5]], 2, 5)).toContain('非数字');
    });

    it('不合法范围自动重分配为总和正确的合法范围', () => {
        const fixed = normalizeChapterRanges([[1, 3], [4, 6]], 2, 5);
        expect(fixed.normalized).toBe(true);
        expect(fixed.ranges).toEqual([[1, 3], [4, 5]]);

        const missing = normalizeChapterRanges(undefined, 2, 5);
        expect(missing.normalized).toBe(true);
        expect(missing.ranges).toEqual([[1, 3], [4, 5]]);

        const already = normalizeChapterRanges([[1, 3], [4, 5]], 2, 5);
        expect(already.normalized).toBe(false);
    });
});

describe('outline-contract — 蓝图契约完整性', () => {
    const complete = {
        expectedChapterRanges: [[1, 3], [4, 5]] as Array<[number, number]>,
        turningPoints: [{ name: '真凶浮现', expectedVolume: 1 }],
        requiredForeshadows: [{ name: '血脉真相', buryVolume: 1, expectedRevealVolume: 2 }],
    };

    it('稀薄蓝图（只有章号范围）被判定为不合格', () => {
        const gaps = validateBlueprintCompleteness({ expectedChapterRanges: [[1, 3], [4, 5]] }, baseCtx);
        expect(gaps.some(g => g.includes('转折点'))).toBe(true);
        expect(gaps.some(g => g.includes('伏笔'))).toBe(true);
    });

    it('完整蓝图无缺陷；同卷埋设回收合法', () => {
        expect(validateBlueprintCompleteness(complete, baseCtx)).toEqual([]);
        expect(validateBlueprintCompleteness({
            ...complete,
            requiredForeshadows: [{ name: '当卷伏笔', buryVolume: 2, expectedRevealVolume: 2 }],
        }, baseCtx)).toEqual([]);
    });

    it('拦截卷号越界、回收早于埋设、转折点章节范围越出本卷', () => {
        const gaps = validateBlueprintCompleteness({
            expectedChapterRanges: [[1, 3], [4, 5]],
            turningPoints: [{ name: 'X', expectedVolume: 9, expectedChapterRange: [1, 2] }],
            requiredForeshadows: [{ name: 'Y', buryVolume: 2, expectedRevealVolume: 1 }],
        }, baseCtx);
        expect(gaps.some(g => g.includes('expectedVolume 越界'))).toBe(true);
        expect(gaps.some(g => g.includes('语义倒置'))).toBe(true);

        const rangeGap = validateBlueprintCompleteness({
            expectedChapterRanges: [[1, 3], [4, 5]],
            turningPoints: [{ name: 'Z', expectedVolume: 2, expectedChapterRange: [1, 2] }],
            requiredForeshadows: [{ name: 'Y', buryVolume: 1, expectedRevealVolume: 2 }],
        }, baseCtx);
        expect(rangeGap.some(g => g.includes('超出其所属卷范围'))).toBe(true);
    });

    it('提供了角色/势力时，对应时间线不得为空', () => {
        const ctx: BlueprintValidationContext = { ...baseCtx, hasCharacters: true, hasFactions: true };
        const gaps = validateBlueprintCompleteness(complete, ctx);
        expect(gaps.some(g => g.includes('characterTimeline'))).toBe(true);
        expect(gaps.some(g => g.includes('factionTimeline'))).toBe(true);
    });
});

describe('outline-contract — 单卷结构精确校验', () => {
    it('合规卷无缺陷，且要求 14 个字段', () => {
        expect(OUTLINE_VOLUME_REQUIRED_KEYS.length).toBe(14);
        expect(validateVolumeStructure(validVolume(1, 1, 3), [1, 3], 3)).toEqual([]);
    });

    it('字段值为占位符时核心字段判为缺失，跨卷摘要字段允许「（无）」', () => {
        const content = validVolume(1, 1, 3).replace('- **核心冲突**：主角在绝境中逆袭', '- **核心冲突**：（无）');
        expect(validateVolumeStructure(content, [1, 3], 3).some(g => g.includes('核心冲突'))).toBe(true);

        const noForeshadow = validVolume(1, 1, 3).replace('- **伏笔安排**：埋设：血脉真相', '- **伏笔安排**：（无）');
        expect(validateVolumeStructure(noForeshadow, [1, 3], 3)).toEqual([]);

        const missingSection = validVolume(1, 1, 3).replace('- **势力变动**：裴家：衰落\n', '');
        expect(validateVolumeStructure(missingSection, [1, 3], 3).some(g => g.includes('势力变动'))).toBe(true);
    });

    it('拦截「多写越界章号」——原算法只查缺章、查不出多章', () => {
        const outOfRange = validVolume(1, 1, 3, ['| 9 | 越界章节 |', '| 10 | 又一个越界章节 |']);
        const gaps = validateVolumeStructure(outOfRange, [1, 3], 3);
        expect(gaps.some(g => g.includes('越界章号'))).toBe(true);
    });

    it('拦截重复章号与空描述行', () => {
        const dup = validVolume(1, 1, 3, ['| 2 | 重复的第二章 |']);
        expect(validateVolumeStructure(dup, [1, 3], 3).some(g => g.includes('重复章号'))).toBe(true);

        const emptyDesc = validVolume(1, 1, 3).replace('| 2 | 第2章核心冲突 |', '| 2 |  |');
        expect(validateVolumeStructure(emptyDesc, [1, 3], 3).some(g => g.includes('描述为空'))).toBe(true);
    });

    it('拦截章节覆盖不足与章节范围不一致', () => {
        const short = validVolume(1, 1, 3).replace('| 3 | 第3章核心冲突 |', '');
        const gaps = validateVolumeStructure(short, [1, 3], 3);
        expect(gaps.some(g => g.includes('覆盖'))).toBe(true);

        const wrongRange = validVolume(1, 1, 3).replace('- **章节范围**：第1章 - 第3章', '- **章节范围**：第1章 - 第9章');
        expect(validateVolumeStructure(wrongRange, [1, 3], 3).some(g => g.includes('章节范围与规划不一致'))).toBe(true);
    });
});

describe('outline-contract — 章节表分析 / 补齐 / 净化', () => {
    const messy = [
        '| 章号 | 核心冲突 |',
        '|---|---|',
        '| 2 | 第二章 |',
        '| 1 | 第一章 |',
        '| 2 | 重复第二章 |',
        '| 99 | 越界章 |',
        '| 4 |  |',
        '| 3 | 第三章 |',
    ].join('\n');

    it('四类异常可被分别识别', () => {
        const analysis = analyzeChapterTable(messy, 1, 4);
        expect(analysis.inRange).toEqual([1, 2, 3, 4]);
        expect(analysis.outOfRange).toEqual([99]);
        expect(analysis.duplicates).toEqual([2]);
        expect(analysis.emptyDescription).toEqual([4]);
    });

    it('缺失章号被压缩为连续区间并可按批次切分', () => {
        const content = ['| 章号 | 核心冲突 |', '|---|---|', '| 1 | A |', '| 5 | E |'].join('\n');
        expect(findMissingChapterRanges(content, 1, 8)).toEqual([[2, 4], [6, 8]]);
        expect(chunkRanges([[2, 4], [6, 8]], 2)).toEqual([[2, 3], [4, 4], [6, 7], [8, 8]]);
    });

    it('净化：剔除越界/重复/空描述行并升序重排', () => {
        const cleaned = consolidateChapterTable(messy, 1, 4);
        expect(cleaned).toContain('| 1 | 第一章 |');
        expect(cleaned).toContain('| 3 | 第三章 |');
        expect(cleaned).not.toContain('| 99 |');
        expect(cleaned).not.toContain('重复第二章');
        expect(cleaned.indexOf('| 1 |')).toBeLessThan(cleaned.indexOf('| 2 |'));
    });

    it('增量合并：补齐的行并入既有表且不覆盖已有行', () => {
        const base = ['| 章号 | 核心冲突 |', '|---|---|', '| 1 | A |'].join('\n');
        const merged = consolidateChapterTable(base, 1, 3, '| 2 | B |\n| 3 | C |\n| 1 | 不该覆盖 |');
        expect(merged).toContain('| 1 | A |');
        expect(merged).toContain('| 2 | B |');
        expect(merged).toContain('| 3 | C |');
        expect(findMissingChapterRanges(merged, 1, 3)).toEqual([]);
    });

    it('无表头时原样返回，交由「缺章节分配表」缺陷驱动重试', () => {
        const noHeader = '### 第1卷\n- **卷名**：《X》\n';
        expect(consolidateChapterTable(noHeader, 1, 3)).toBe(noHeader);
    });

    it('字段值支持同行内联与换行子列表，缺失返回 null', () => {
        const content = ['- **主要事件**：', '  - 事件一', '  - 事件二', '- **结尾过渡**：踏入新舞台'].join('\n');
        expect(extractFieldValue(content, '主要事件')).toBe('- 事件一\n- 事件二');
        expect(extractFieldValue(content, '结尾过渡')).toBe('踏入新舞台');
        expect(extractFieldValue(content, '核心冲突')).toBeNull();
    });
});

describe('outline-contract — 全局章号连续性终检', () => {
    it('合规文档无缺陷', () => {
        const vols = [validVolume(1, 1, 3), validVolume(2, 4, 5)];
        expect(validateGlobalChapterContinuity(vols, [[1, 3], [4, 5]], 5)).toEqual([]);
    });

    it('拦截跨卷重叠、全书缺章、超出总章数', () => {
        const overlap = [validVolume(1, 1, 3, ['| 4 | 跨卷重复 |']), validVolume(2, 4, 5)];
        expect(validateGlobalChapterContinuity(overlap, [[1, 3], [4, 5]], 5).some(g => g.includes('同时出现在'))).toBe(true);

        const gapVolume = [validVolume(1, 1, 3).replace('| 3 | 第3章核心冲突 |', ''), validVolume(2, 4, 5)];
        expect(validateGlobalChapterContinuity(gapVolume, [[1, 3], [4, 5]], 5).some(g => g.includes('缺失'))).toBe(true);

        const overflow = [validVolume(1, 1, 3, ['| 7 | 超总章数 |']), validVolume(2, 4, 5)];
        expect(validateGlobalChapterContinuity(overflow, [[1, 3], [4, 5]], 5).some(g => g.includes('超出全书总章数'))).toBe(true);
    });
});
