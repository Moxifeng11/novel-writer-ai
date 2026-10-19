import { describe, expect, it, vi } from 'vitest';
import { OutlineGenerator } from '../../../engine/ai-outline-generator';
import type { OutlineSettings } from '../../../engine/ai-types';

/**
 * 本次系统化整改的验收点：
 * 1. generateOutline 在任何单点失败下都「不抛出中断」，总是返回可用的 content；
 * 2. 蓝图与逐卷生成共享同一套「契约校验 + 定向补全」质量控制；
 * 3. 蓝图章号范围哪怕总数不符，也会被自动重分配，最终文档章号数严格等于规划总章数（Q-1）；
 * 4. 稀薄蓝图（只有章号范围）被判不合格并重试，不再静默进入 Phase 2（Q-2）；
 * 5. 超长卷分段生成；跨卷关键问题定向修复。
 */

/**
 * 分支识别必须精确：卷级提示词里也会出现"全局故事线蓝图"字样（本卷必须包含的关键转折点），
 * 因此蓝图分支用其独有的开头句识别，避免误判。
 */
const BLUEPRINT_DETECT = '请为以下小说规划全局故事线蓝图';
const BATCH_DETECT = '只输出「章节分配」表格的数据行';
const OVERVIEW_DETECT = '卷级概览';
const CROSS_REPAIR_DETECT = '跨卷一致性缺陷';

interface StubResponse {
    content: string;
    error?: string;
}

function makeGenerator(handler: (system: string, user: string) => Promise<StubResponse>) {
    const plugin = {
        getActiveProject: () => null,
        settings: { flashModel: 'test-model', defaultModel: 'test-model', maxOutput: 4096 },
        app: { vault: { getAbstractFileByPath: () => null, delete: async () => undefined } },
    } as any;
    const apiClient = { callAI: vi.fn(handler) } as any;
    const generator = new OutlineGenerator(plugin, apiClient, { showNotice: vi.fn() } as any);
    return { generator, apiClient };
}

/** 契约完整的蓝图 JSON（转折点/伏笔名称刻意选用会出现在卷正文里的词，避免误触发跨卷校验） */
function blueprintJson(
    ranges: number[][],
    names: { turningPoint?: string; foreshadow?: string } = {},
): string {
    return JSON.stringify({
        expectedChapterRanges: ranges,
        turningPoints: [{ name: names.turningPoint ?? '试炼之路', expectedVolume: 1 }],
        requiredForeshadows: [
            { name: names.foreshadow ?? '核心冲突', buryVolume: 1, expectedRevealVolume: 1 },
        ],
    });
}

/** 生成字段齐备（含跨卷摘要所需的「伏笔安排」「势力变动」）的卷级 Markdown，不含章节表 */
function buildOverviewMarkdown(volumeNumber: number, start: number, end: number): string {
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
    ].join('\n');
}

/** 字段齐备 + 章节表精确覆盖 [start, end] 的完整卷级 Markdown */
function buildVolumeMarkdown(volumeNumber: number, start: number, end: number, extraLines: string[] = []): string {
    const rows: string[] = [];
    for (let n = start; n <= end; n++) rows.push(`| ${n} | 第${n}章核心冲突 |`);
    return [
        buildOverviewMarkdown(volumeNumber, start, end),
        '- **章节分配**：',
        '| 章号 | 核心冲突 |',
        '|---|---|',
        ...rows,
        ...extraLines,
    ].join('\n');
}

/** 单次完整生成分支：按 userPrompt 里的编号范围返回与之严格匹配的卷内容 */
function volumeBranchResponse(user: string): StubResponse {
    const vm = user.match(/为第(\d+)卷（共/);
    const rm = user.match(/本卷章节编号必须严格为：第(\d+)章 到 第(\d+)章/);
    const v = vm ? parseInt(vm[1], 10) : 1;
    const s = rm ? parseInt(rm[1], 10) : 1;
    const e = rm ? parseInt(rm[2], 10) : s;
    return { content: buildVolumeMarkdown(v, s, e) };
}

const baseSettings: OutlineSettings = {
    totalWords: '100',
    volumes: 1,
    wordsPerChapter: 100,
};

describe('OutlineGenerator.generateOutline — 契约化质量优先 + 全程不中断', () => {
    it('首轮结构不达标时按缺陷定向补全并在次轮通过（不抛出）', async () => {
        let volumeCalls = 0;
        const incomplete = [
            '### 第1卷',
            '- **卷名**：《试炼之路》',
            '- **章节范围**：第1章 - 第2章',
        ].join('\n');

        const { generator, apiClient } = makeGenerator(async (system, user) => {
            if (user.includes(BLUEPRINT_DETECT)) {
                return { content: blueprintJson([[1, 2]]) };
            }
            volumeCalls++;
            return volumeCalls === 1 ? { content: incomplete } : volumeBranchResponse(user);
        });

        const result = await generator.generateOutline('世界观总览内容', { ...baseSettings, totalWords: '200' });

        expect(result.error).toBeUndefined();
        expect(result.content).toContain('| 2 | 第2章核心冲突 |');
        expect(volumeCalls).toBe(2);
        expect(result.content).not.toContain('降级生成提示');
        expect(apiClient.callAI).toHaveBeenCalledTimes(3);
    });

    it('AI 持续失败时降级返回而非抛出中断（附占位与错误提示）', async () => {
        const { generator } = makeGenerator(async () => ({ content: '', error: 'AI返回为空' }));

        const result = await generator.generateOutline('世界观总览内容', { ...baseSettings });

        expect(result.content).toContain('（AI 未返回有效内容）');
        expect(result.error).toBeTruthy();
    });

    it('超长卷（> 60 章）走分段生成并合并出完整章节表', async () => {
        const { generator } = makeGenerator(async (system, user) => {
            if (user.includes(BLUEPRINT_DETECT)) {
                return { content: blueprintJson([[1, 70]]) };
            }
            if (system.includes(BATCH_DETECT)) {
                const m = system.match(/第(\d+)章 到 第(\d+)章/);
                const s = m ? parseInt(m[1], 10) : 0;
                const e = m ? parseInt(m[2], 10) : 0;
                const rows: string[] = [];
                for (let n = s; n <= e; n++) rows.push(`| ${n} | 第${n}章核心冲突 |`);
                return { content: rows.join('\n') };
            }
            if (system.includes(OVERVIEW_DETECT)) {
                return { content: buildOverviewMarkdown(1, 1, 70) };
            }
            throw new Error('不应走到单次完整生成分支');
        });

        const result = await generator.generateOutline('世界观总览内容', { ...baseSettings, totalWords: '7000' });

        expect(result.error).toBeUndefined();
        expect(result.content).toContain('- **章节分配**：');
        expect(result.content).toContain('| 1 | 第1章核心冲突 |');
        expect(result.content).toContain('| 70 | 第70章核心冲突 |');
        expect(result.content).not.toContain('降级生成提示');
    });

    it('跨卷关键问题触发定向修复，修复结果结构不退化时被采纳', async () => {
        const { generator } = makeGenerator(async (system, user) => {
            if (user.includes(BLUEPRINT_DETECT)) {
                return {
                    content: blueprintJson([[1, 1]], { turningPoint: '真凶浮现', foreshadow: '真凶浮现' }),
                };
            }
            if (system.includes(CROSS_REPAIR_DETECT)) {
                return { content: buildVolumeMarkdown(1, 1, 1, ['- **主线揭示**：真凶浮现']) };
            }
            // 首轮卷内容未提及蓝图转折点/伏笔 → 触发 critical 问题
            return volumeBranchResponse(user);
        });

        const result = await generator.generateOutline('世界观总览内容', { ...baseSettings });

        expect(result.error).toBeUndefined();
        expect(result.content).toContain('真凶浮现');
        expect(result.content).not.toContain('待完善问题');
    });

    it('稀薄蓝图（只有章号范围）被判不合格并重试，达标后不再输出蓝图质量提示（Q-2）', async () => {
        let blueprintCalls = 0;
        const { generator } = makeGenerator(async (system, user) => {
            if (user.includes(BLUEPRINT_DETECT)) {
                blueprintCalls++;
                // 第 1 轮只给章号范围（无转折点/伏笔）→ 契约不合格
                return { content: blueprintCalls === 1 ? '{"expectedChapterRanges":[[1,2]]}' : blueprintJson([[1, 2]]) };
            }
            return volumeBranchResponse(user);
        });

        const result = await generator.generateOutline('世界观总览内容', { ...baseSettings, totalWords: '200' });

        expect(result.error).toBeUndefined();
        expect(blueprintCalls).toBe(2);
        expect(result.content).not.toContain('蓝图质量提示');
    });

    it('蓝图章号总数不符时自动重分配，最终章号数严格等于规划总章数且无越界（Q-1）', async () => {
        const { generator } = makeGenerator(async (system, user) => {
            if (user.includes(BLUEPRINT_DETECT)) {
                // 300 章被 AI 写成了总数 6（2 卷规划总章数应为 5）
                return { content: blueprintJson([[1, 3], [4, 6]]) };
            }
            if (system.includes(BATCH_DETECT)) {
                const m = system.match(/第(\d+)章 到 第(\d+)章/);
                const s = m ? parseInt(m[1], 10) : 0;
                const e = m ? parseInt(m[2], 10) : 0;
                const rows: string[] = [];
                for (let n = s; n <= e; n++) rows.push(`| ${n} | 第${n}章核心冲突 |`);
                return { content: rows.join('\n') };
            }
            if (system.includes(OVERVIEW_DETECT)) {
                const rm = user.match(/章节范围：第(\d+)章 - 第(\d+)章/);
                const s = rm ? parseInt(rm[1], 10) : 1;
                const e = rm ? parseInt(rm[2], 10) : s;
                const vm = user.match(/卷号：第(\d+)卷/);
                return { content: buildOverviewMarkdown(vm ? parseInt(vm[1], 10) : 1, s, e) };
            }
            return volumeBranchResponse(user);
        });

        const result = await generator.generateOutline('世界观总览内容', {
            totalWords: '500',
            volumes: 2,
            wordsPerChapter: 100,
        });

        expect(result.error).toBeUndefined();
        // 章号行恰好 5 条，覆盖第 1~5 章，不存在第 6 章
        const rows = result.content.match(/\|\s*\d+\s*\|/g) || [];
        expect(rows.length).toBe(5);
        expect(result.content).toContain('| 5 |');
        expect(result.content).not.toContain('| 6 |');
        expect(result.content).not.toContain('全局章号待完善问题');
    });

    it('跨卷修复提示词携带「势力演变」要求与判定词汇（R-1 回归）', async () => {
        let repairUserPrompt = '';
        const { generator } = makeGenerator(async (system, user) => {
            if (user.includes(BLUEPRINT_DETECT)) {
                return {
                    content: JSON.stringify({
                        expectedChapterRanges: [[1, 1]],
                        turningPoints: [{ name: '真凶浮现', expectedVolume: 1 }],
                        requiredForeshadows: [{ name: '真凶浮现', buryVolume: 1, expectedRevealVolume: 1 }],
                        // 该势力名不在卷正文里 → 必然触发 faction_timeline_mismatch
                        factionTimeline: [{ factionName: '青云宗', eventType: 'fall', expectedVolume: 1 }],
                    }),
                };
            }
            if (system.includes(CROSS_REPAIR_DETECT)) {
                repairUserPrompt = user;
                return {
                    content: buildVolumeMarkdown(1, 1, 1, ['- **主线揭示**：真凶浮现', '- **势力演变**：青云宗覆灭']),
                };
            }
            return volumeBranchResponse(user);
        });

        const result = await generator.generateOutline('世界观总览内容', { ...baseSettings });

        // 修复侧此前缺失势力演变要求，导致「势力演变未体现」怎么重写都无法闭合；
        // 现在要求 + 判定词汇表（与校验器同源）必须同时出现在修复提示词中。
        expect(repairUserPrompt).toContain('本卷必须体现的势力演变');
        expect(repairUserPrompt).toContain('青云宗');
        expect(repairUserPrompt).toContain('覆灭');
        expect(result.content).not.toContain('待完善问题');
    });
});
