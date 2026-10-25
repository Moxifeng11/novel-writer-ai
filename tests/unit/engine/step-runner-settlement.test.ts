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
        expect(h.trigger).toHaveBeenCalledWith('novel-writer:refresh-context-panel', {});
        expect(render).toHaveBeenCalled();
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

    it('强制揭示提示非空但未解析出名字：提示格式问题，仍继续结算', async () => {
        const h = makeHarness();

        await runSettlement(h, { vars: { forcedRevealHint: '随便写点什么' } });

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
