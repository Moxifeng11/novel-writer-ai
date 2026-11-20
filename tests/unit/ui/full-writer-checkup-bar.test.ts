/**
 * full-writer-checkup-bar.test.ts — 全屏写作视图「写作体检」条（缺口 2）
 *
 * 覆盖：空态门槛、正常态渲染（进度/风险/建议/明细）、无建议兜底、
 * 失败不吞错且恢复按钮、详情展开、节流与引擎缓存。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';

vi.mock('@/main', () => ({ default: class NovelWriterPlugin {} }));

/** showErrorNotice 的调用记录：用来断言「同一原因只弹一次」 */
const errorNotices: { message: string; title?: string }[] = [];
vi.mock('../../../ui/components/notice-helpers', () => ({
    showErrorNotice: (message: string, options?: { title?: string }): void => {
        errorNotices.push({ message, title: options?.title });
    },
}));

import { FullWriterCheckupController } from '../../../ui/full-writer/checkup-bar-controller';

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

interface StubDeps {
    project?: string;
    volume?: string;
    chapterNum?: number;
    state?: Record<string, unknown>;
    fail?: Error;
    /** 引擎记录的情节线解析失败原因（AI 401 / 未配置模型） */
    plotThreadError?: string;
}

function makeController(overrides: StubDeps = {}): {
    ctrl: InstanceType<typeof FullWriterCheckupController>;
    root: FakeEl;
    checkTraction: ReturnType<typeof vi.fn>;
    createEngine: ReturnType<typeof vi.fn>;
} {
    const checkTraction = vi.fn(async () => {
        if (overrides.fail) throw overrides.fail;
        return overrides.state ?? {
            threads: [{
                id: 'main-1',
                name: '星门主线',
                type: 'main',
                startPoint: { volume: 1, chapter: 1 },
                targetEnd: { volume: 10, chapter: 100 },
                currentProgress: 42,
                keyNodes: [],
                status: 'active',
            }],
            overallProgress: 42,
            divergenceRisk: 'high',
            recommendations: ['主线进度落后于卷进度，建议在近三章推进星门线索'],
        };
    });
    const createEngine = vi.fn(async () => ({
        checkTraction,
        getPlotThreadError: (): string | null => overrides.plotThreadError ?? null,
    }));
    const ctrl = new FullWriterCheckupController({
        app: {} as never,
        plugin: { aiEngine: {} } as never,
        getProject: () => overrides.project ?? '长篇小说/晨星外传',
        getVolume: () => overrides.volume ?? '第2卷',
        getChapterNum: () => overrides.chapterNum ?? 17,
        createEngine: createEngine as never,
    });
    const root = new FakeEl('div');
    ctrl.render(root as unknown as HTMLElement);
    return { ctrl, root, checkTraction, createEngine };
}

beforeEach(() => {
    stubCreateDiv();
    stubDocument();
    errorNotices.length = 0;
});

describe('FullWriterCheckupController', () => {
    it('无章节时显示空态、按钮禁用、不触发体检', async () => {
        const { root, checkTraction } = makeController({ chapterNum: 0, project: '' });
        await flush();
        expect(root.allText()).toContain('打开章节后自动体检');
        expect(checkTraction).not.toHaveBeenCalled();
        const refreshBtn = root.findAll('nw-fw-checkup-btn')[0];
        expect((refreshBtn as unknown as { disabled: boolean }).disabled).toBe(true);
    });

    it('正常态渲染进度、风险徽标、首要建议与明细', async () => {
        const { root } = makeController();
        await flush();
        const text = root.allText();
        expect(text).toContain('写作体检');
        expect(text).toContain('42%');
        expect(text).toContain('偏离 高');
        expect(text).toContain('主线进度落后于卷进度');
        // 明细：情节线名称 + 类型/状态 + 建议列表
        expect(text).toContain('情节线（1）');
        expect(text).toContain('星门主线');
        expect(text).toContain('主线 · 活跃');
        expect(text).toContain('建议');

        const fill = root.findAll('nw-fw-checkup-fill')[0];
        expect(fill.style.getPropertyValue('--nw-fw-checkup-pct')).toBe('42%');
        const risk = root.findAll('nw-fw-checkup-risk')[0];
        expect(risk.className).toContain('nw-fw-checkup-risk--high');
        const time = root.findAll('nw-fw-checkup-time')[0];
        expect(time.textContent).toMatch(/^最近 \d{2}:\d{2}$/);
    });

    it('无建议时给平稳兜底文案', async () => {
        const { root } = makeController({
            state: { threads: [], overallProgress: 0, divergenceRisk: 'medium', recommendations: [] },
        });
        await flush();
        expect(root.allText()).toContain('情节线走势平稳');
        expect(root.allText()).toContain('未解析到情节线');
    });

    it('体检抛错时提示失败并恢复按钮，不抛出', async () => {
        const { root } = makeController({ fail: new Error('分卷大纲读取失败') });
        await flush();
        expect(root.allText()).toContain('体检失败：分卷大纲读取失败');
        const tip = root.findAll('nw-fw-checkup-tip')[0];
        expect(tip.className).toContain('nw-fw-checkup-tip--error');
        const refreshBtn = root.findAll('nw-fw-checkup-btn')[0];
        expect((refreshBtn as unknown as { disabled: boolean }).disabled).toBe(false);
    });

    it('详情按钮切换展开态与文案', async () => {
        const { root } = makeController();
        await flush();
        const btn = root.findAll('nw-fw-checkup-btn')
            .find(el => el.className.includes('nw-fw-checkup-btn--detail'));
        expect(btn).toBeTruthy();
        const click = (): void => { (btn as unknown as { onclick?: (e: unknown) => void }).onclick?.({}); };
        const details = root.findAll('nw-fw-checkup-details')[0];
        expect(details.className).not.toContain('--open');
        click();
        expect(details.className).toContain('nw-fw-checkup-details--open');
        expect(btn?.textContent).toBe('收起');
        click();
        expect(details.className).not.toContain('--open');
        expect(btn?.textContent).toBe('详情');
    });

    it('非强制的重复刷新被节流，强制刷新才重新体检', async () => {
        const { ctrl, checkTraction } = makeController();
        await flush();
        expect(checkTraction).toHaveBeenCalledTimes(1);
        await ctrl.refresh(false);
        expect(checkTraction).toHaveBeenCalledTimes(1);
        await ctrl.refresh(true);
        expect(checkTraction).toHaveBeenCalledTimes(2);
    });

    it('同一项目复用引擎实例，切项目才重建', async () => {
        const { ctrl, createEngine } = makeController();
        await flush();
        await ctrl.refresh(true);
        expect(createEngine).toHaveBeenCalledTimes(1);
        expect(createEngine).toHaveBeenCalledWith('长篇小说/晨星外传');
    });

    it('AI 解析失败时把真实原因画进体检条，而不是只报「未解析到情节线」', async () => {
        const { root } = makeController({
            state: { threads: [], overallProgress: 0, divergenceRisk: 'medium', recommendations: [] },
            plotThreadError: 'AI响应错误 - 状态码: 401, 内容: {"error":{"message":"Authentication Fails"}}',
        });
        await flush();
        const tip = root.findAll('nw-fw-checkup-tip')[0];
        expect(tip.allText()).toContain('体检不可用');
        // 密钥类错误翻成可行动文案，不透出原始英文 JSON
        expect(tip.allText()).toContain('API 密钥无效或未配置');
        expect(tip.className).toContain('nw-fw-checkup-tip--error');
        expect(errorNotices).toHaveLength(1);
        expect(errorNotices[0].title).toBe('写作体检失败');
    });

    it('同一项目同一原因只弹一次 Notice，切项目才重新提示', async () => {
        const { ctrl } = makeController({
            state: { threads: [], overallProgress: 0, divergenceRisk: 'medium', recommendations: [] },
            plotThreadError: '未配置可用模型',
        });
        await flush();
        expect(errorNotices).toHaveLength(1);
        await ctrl.refresh(true);
        expect(errorNotices).toHaveLength(1);
    });

    it('非密钥类错误原样透出', async () => {
        const { root } = makeController({
            state: { threads: [], overallProgress: 0, divergenceRisk: 'medium', recommendations: [] },
            plotThreadError: '网络连接超时',
        });
        await flush();
        expect(root.findAll('nw-fw-checkup-tip')[0].allText()).toContain('体检不可用：网络连接超时');
    });

    it('情节线为空但没有解析失败时保持原建议文案', async () => {
        const { root } = makeController({
            state: { threads: [], overallProgress: 0, divergenceRisk: 'medium', recommendations: [] },
        });
        await flush();
        const tip = root.findAll('nw-fw-checkup-tip')[0];
        expect(tip.allText()).toContain('情节线走势平稳');
        expect(tip.className).not.toContain('--error');
        expect(errorNotices).toHaveLength(0);
    });

    it('dispose 后再刷新不产生新调用', async () => {
        const { ctrl, checkTraction } = makeController();
        await flush();
        ctrl.dispose();
        await ctrl.refresh(true);
        expect(checkTraction).toHaveBeenCalledTimes(1);
    });
});
