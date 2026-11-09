import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { TFile } from 'obsidian';
import { StepRunner } from '../../../engine/step-runner';
import { ENGINE_NAMES } from '../../../engine/engine-registry';

/**
 * 章节结算链路行为护栏。
 * `executeSettlement` 抽取到独立模块前后必须保持：
 * - 无章节目录 / 报告为空 / 报告无有效指令时直接返回，不调用结算引擎；
 * - 结算成功才标记 settlement 完成，并刷新叙事总览与上下文面板；
 * - 结算引擎抛错时不标记完成；
 * - 内存缺报告时从磁盘恢复并回填 stepResults。
 */

interface Harness {
    runner: StepRunner;
    plugin: Record<string, any>;
    settle: any;
    generateNarrativeOverview: any;
    fs: { read: any; write: any };
    vaultMeta: { getAbstractFileByPath: any };
    callbacks: {
        showError: any;
        showSuccess: any;
        showNotice: any;
        hideProgress: any;
    };
    trigger: any;
}

function makeHarness(): Harness {
    const callbacks = {
        showError: vi.fn(),
        showSuccess: vi.fn(),
        showNotice: vi.fn(),
        hideProgress: vi.fn(),
    };
    const settle = vi.fn(async () => ({ created: 1, updated: 2 }));
    const generateNarrativeOverview = vi.fn(async () => '# 叙事总览');
    const trigger = vi.fn();

    const settlementEngine = { settle, generateNarrativeOverview };
    const plugin = {
        aiEngine: {},
        settings: { maxContext: 128000, maxOutput: 4096 },
        app: { workspace: { trigger } },
        engineRegistry: {
            get: (name: string) => (name === ENGINE_NAMES.SETTLEMENT_ENGINE ? settlementEngine : {}),
        },
        manifest: { dir: '.obsidian/plugins/novel-writer-ai' },
    };

    const runner = new StepRunner({} as never, plugin as never, callbacks);
    const fs = {
        read: vi.fn(async () => 'UPDATE_CHAR: 林舟'),
        write: vi.fn(async () => undefined),
        mkdir: vi.fn(async () => undefined),
    };
    const vaultMeta = { getAbstractFileByPath: vi.fn(() => null) };
    const whitebox = runner as unknown as {
        getFS: () => unknown;
        getVaultMeta: () => unknown;
    };
    whitebox.getFS = () => fs;
    whitebox.getVaultMeta = () => vaultMeta;

    return {
        runner,
        plugin,
        settle,
        generateNarrativeOverview,
        fs,
        vaultMeta,
        callbacks,
        trigger,
    };
}

const CHAP_DIR = '书甲/03-大纲与章节/正文/第1卷';
const CHAPTER = '第2章';

async function runSettlement(
    h: Harness,
    overrides?: {
        chapDir?: string;
        stepResults?: Record<string, string>;
        stepCompleted?: Set<string>;
        vars?: Record<string, string>;
        render?: any;
    }
) {
    const stepResults = overrides?.stepResults ?? { analysisReport: 'UPDATE_CHAR: 林舟' };
    const stepCompleted = overrides?.stepCompleted ?? new Set<string>();
    const render = overrides?.render ?? vi.fn(async () => {});
    await h.runner.executeSettlement(
        '书甲',
        overrides?.chapDir ?? CHAP_DIR,
        CHAPTER,
        stepResults,
        stepCompleted,
        overrides?.vars ?? {},
        h.plugin as never,
        render,
        {} as never
    );
    return { stepResults, stepCompleted, render };
}

describe('StepRunner.executeSettlement — 前置守卫', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('没有章节目录时直接返回，不调用结算引擎', async () => {
        const h = makeHarness();

        await runSettlement(h, { chapDir: '' });

        expect(h.settle).not.toHaveBeenCalled();
        expect(h.callbacks.showError).not.toHaveBeenCalled();
    });

    it('内存与磁盘都没有分析报告：提示先跑分析报告，不结算', async () => {
        const h = makeHarness();

        await runSettlement(h, { stepResults: {} });

        expect(h.settle).not.toHaveBeenCalled();
        expect(h.callbacks.showError).toHaveBeenCalledWith(
            expect.stringContaining('分析报告为空或不含有效更新指令')
        );
    });

    it('分析报告不含有效指令：同样拒绝结算', async () => {
        const h = makeHarness();

        await runSettlement(h, { stepResults: { analysisReport: '本章没有变化' } });

        expect(h.settle).not.toHaveBeenCalled();
        expect(h.callbacks.showError).toHaveBeenCalledWith(
            expect.stringContaining('分析报告为空或不含有效更新指令')
        );
    });

    it('内存缺报告但磁盘存在：读取后回填 stepResults 再结算', async () => {
        const h = makeHarness();
        const file = new TFile();
        h.vaultMeta.getAbstractFileByPath.mockReturnValueOnce(file);
        h.fs.read.mockResolvedValueOnce('UPDATE_ITEM: 青锋剑');

        const { stepResults } = await runSettlement(h, { stepResults: {} });

        expect(h.fs.read).toHaveBeenCalled();
        expect(stepResults.analysisReport).toBe('UPDATE_ITEM: 青锋剑');
        expect(h.settle).toHaveBeenCalledWith(
            '书甲',
            CHAP_DIR,
            CHAPTER,
            'UPDATE_ITEM: 青锋剑',
            '',
            { forceReveal: undefined }
        );
    });
});

describe('StepRunner.executeSettlement — 结算与总览', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('结算成功：标记完成、提示汇总、刷新叙事总览与上下文面板', async () => {
        const h = makeHarness();

        const { stepCompleted, render } = await runSettlement(h);

        expect(h.settle).toHaveBeenCalledTimes(1);
        expect(stepCompleted.has('settlement')).toBe(true);
        expect(h.callbacks.hideProgress).toHaveBeenCalled();
        expect(h.callbacks.showSuccess).toHaveBeenCalledWith(
            expect.stringContaining('新创 1 项')
        );
        expect(h.generateNarrativeOverview).toHaveBeenCalledWith('书甲');
        expect(h.fs.write).toHaveBeenCalledWith(
            '书甲/04-项目总控/叙事总览.md',
            '# 叙事总览'
        );
        // B 轮修复：步骤结算也要落结算表（此前只有结算弹窗写，两入口产物不一致）
        const tablePath = '书甲/03-大纲与章节/步骤结果/第1卷/第2章/第2章_结算表.md';
        expect(h.fs.write).toHaveBeenCalledWith(tablePath, expect.stringContaining('# 第2章 结算表'));
        expect(h.fs.write).toHaveBeenCalledWith(tablePath, expect.stringContaining('## 更新状态'));
        expect(h.trigger).toHaveBeenCalledWith('novel-writer:refresh-context-panel', {});
        expect(render).toHaveBeenCalled();
    });

    it('重复结算：结算表覆盖写同一路径，内容非空', async () => {
        const h = makeHarness();
        const tablePath = '书甲/03-大纲与章节/步骤结果/第1卷/第2章/第2章_结算表.md';

        await runSettlement(h);
        await runSettlement(h);

        const tableWrites = h.fs.write.mock.calls.filter((call: unknown[]) => call[0] === tablePath);
        expect(tableWrites.length).toBeGreaterThanOrEqual(2);
        for (const call of tableWrites) {
            expect(String(call[1])).toContain('# 第2章 结算表');
        }
    });

    it('无新增无更新时给出专门的完成提示', async () => {
        const h = makeHarness();
        h.settle.mockResolvedValueOnce({ created: 0, updated: 0 });

        await runSettlement(h);

        expect(h.callbacks.showSuccess).toHaveBeenCalledWith('章节结算完成（无新增或更新）');
    });

    it('结算引擎抛错：不标记完成并提示失败', async () => {
        const h = makeHarness();
        h.settle.mockRejectedValueOnce(new Error('索引损坏'));

        const { stepCompleted } = await runSettlement(h);

        expect(stepCompleted.has('settlement')).toBe(false);
        expect(h.callbacks.showError).toHaveBeenCalledWith(
            expect.stringContaining('章节结算失败: 索引损坏')
        );
        expect(h.generateNarrativeOverview).not.toHaveBeenCalled();
    });

    it('强制揭示按「揭示：名字1, 名字2」解析后传给结算引擎', async () => {
        const h = makeHarness();

        await runSettlement(h, { vars: { forcedRevealHint: '揭示：林舟，苏晚' } });

        expect(h.settle).toHaveBeenCalledWith(
            '书甲',
            CHAP_DIR,
            CHAPTER,
            'UPDATE_CHAR: 林舟',
            '',
            { forceReveal: ['林舟', '苏晚'] }
        );
    });

    it('默认 builder 的 bullet 列表也能解析出名字，不再误报格式错误', async () => {
        const h = makeHarness();
        const hint = [
            '⚠️ 信息债过高（18个未揭示），本章优先揭示以下临近伏笔：',
            '- 玉佩（高，计划:第3章）',
            '- 老者的身份（中，计划:第4章）',
        ].join('\n');

        await runSettlement(h, { vars: { forcedRevealHint: hint } });

        expect(h.callbacks.showNotice).not.toHaveBeenCalledWith(
            expect.stringContaining('强制揭示提示未识别出任何名字'),
            expect.anything()
        );
        expect(h.settle).toHaveBeenCalledWith(
            '书甲',
            CHAP_DIR,
            CHAPTER,
            'UPDATE_CHAR: 林舟',
            '',
            { forceReveal: ['玉佩', '老者的身份'] }
        );
    });

    it('信息债健康等纯提示行不解析出名字，也不告警', async () => {
        const h = makeHarness();

        await runSettlement(h, { vars: { forcedRevealHint: '当前伏笔生态健康' } });

        expect(h.callbacks.showNotice).not.toHaveBeenCalledWith(
            expect.stringContaining('强制揭示提示未识别出任何名字'),
            expect.anything()
        );
        expect(h.settle).toHaveBeenCalledWith(
            '书甲',
            CHAP_DIR,
            CHAPTER,
            'UPDATE_CHAR: 林舟',
            '',
            { forceReveal: undefined }
        );
    });

    it('强制揭示提示非空且应含名字却解析不出：提示格式问题，仍继续结算', async () => {
        const h = makeHarness();

        await runSettlement(h, { vars: { forcedRevealHint: '揭示：\n（这里忘了写名字）' } });

        expect(h.callbacks.showNotice).toHaveBeenCalledWith(
            expect.stringContaining('强制揭示提示未识别出任何名字'),
            expect.anything()
        );
        expect(h.settle).toHaveBeenCalledWith(
            '书甲',
            CHAP_DIR,
            CHAPTER,
            'UPDATE_CHAR: 林舟',
            '',
            { forceReveal: undefined }
        );
    });
});
