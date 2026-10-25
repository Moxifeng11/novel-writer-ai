import { describe, it, expect, vi, type Mock } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { RealtimeQualityController, type RealtimeQualityHost } from '../../../ui/cowrite/realtime-quality-controller';

/**
 * 实时质量评估在碰到「上一次评估还在进行」时，原实现直接 return：
 * 用户停手前的最后一次输入永远不会被评估，顶栏会长期停在旧文本的分数上。
 * 这里锁定「挂起一次、由在途评估结束时补跑」的行为（D2 抽取到 controller 后）。
 */

type QualityMonitorStub = {
    isEvaluating: () => boolean;
    evaluate: Mock;
    cancel: Mock;
};

type StatusEl = {
    setText: ReturnType<typeof vi.fn>;
    setAttribute: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
};

const LONG_TEXT = '这是一段足够长的正文，用来触发实时质量评估，长度必须超过五十个字符。'.repeat(4);

function makeController(monitor: QualityMonitorStub) {
    const status: StatusEl = {
        setText: vi.fn(),
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
    };
    const state = {
        text: LONG_TEXT,
        project: '测试书',
        volume: '第1卷',
        chapterNum: 1,
        chapterName: '第1章',
        bodyPath: '/测试书/第1卷/第1章.md',
    };
    const host: RealtimeQualityHost = {
        app: {} as never,
        getText: () => state.text,
        getProject: () => state.project,
        getVolume: () => state.volume,
        getChapterNum: () => state.chapterNum,
        getChapterName: () => state.chapterName,
        getBodyPath: () => state.bodyPath,
        getChapterBrief: () => null,
        getChapPlan: () => undefined,
        loadCharacterInfos: async () => [],
        loadForeshadows: async () => [],
        createMonitor: () => monitor as never,
    };
    const controller = new RealtimeQualityController(host);
    controller.attachStatus(status as never);
    // 白盒：跳过 toggle 的首次评估，直接进入「已启用 + 指定 monitor」状态
    (controller as unknown as { enabled: boolean }).enabled = true;
    (controller as unknown as { monitor: QualityMonitorStub }).monitor = monitor;
    return { controller, status, state };
}

function okResult() {
    return { qualityScore: { overallScore: 80, issues: [] }, deviations: undefined };
}

describe('RealtimeQualityController — 评估在途重评', () => {
    it('评估在途时来的新输入会挂起，并在本次结束后补跑一次', async () => {
        let active = 0;
        let releaseFirst: (() => void) | null = null;
        const evaluate = vi.fn(() => {
            active++;
            if (evaluate.mock.calls.length === 1) {
                return new Promise<ReturnType<typeof okResult>>((resolve) => {
                    releaseFirst = () => {
                        active--;
                        resolve(okResult());
                    };
                });
            }
            active--;
            return Promise.resolve(okResult());
        });
        const { controller } = makeController({ isEvaluating: () => active > 0, evaluate, cancel: vi.fn() });
        vi.spyOn(controller as unknown as { buildDeviationContext: () => Promise<object> }, 'buildDeviationContext')
            .mockResolvedValue({});
        vi.spyOn(controller as unknown as { persistLiveQualityIfDue: () => Promise<void> }, 'persistLiveQualityIfDue')
            .mockResolvedValue(undefined);

        const first = controller.evaluate();
        await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(1));

        // 在途期间再次触发：只挂起，不并发调用
        await controller.evaluate();
        expect((controller as unknown as { pending: boolean }).pending).toBe(true);
        expect(evaluate).toHaveBeenCalledTimes(1);

        releaseFirst!();
        await first;
        await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(2));
        expect((controller as unknown as { pending: boolean }).pending).toBe(false);
    });

    it('busy 竞态只挂起重评，不展示「质量评估失败」', async () => {
        const evaluate = vi.fn().mockRejectedValue(new Error('busy: monitor is already evaluating'));
        const { controller, status } = makeController({ isEvaluating: () => false, evaluate, cancel: vi.fn() });

        await controller.evaluate();

        expect((controller as unknown as { pending: boolean }).pending).toBe(true);
        expect(status.setText).not.toHaveBeenCalledWith('质量评估失败');
        expect(evaluate).toHaveBeenCalledTimes(1);
    });

    it('关闭开关会清空挂起标记', async () => {
        const evaluate = vi.fn();
        const { controller } = makeController({ isEvaluating: () => false, evaluate, cancel: vi.fn() });
        (controller as unknown as { enabled: boolean }).enabled = false;
        (controller as unknown as { pending: boolean }).pending = true;

        await controller.evaluate();

        expect((controller as unknown as { pending: boolean }).pending).toBe(false);
        expect(evaluate).not.toHaveBeenCalled();
    });

    it('正文过短时清空挂起标记，避免空转重评', async () => {
        const evaluate = vi.fn();
        const cancel = vi.fn();
        const { controller, state } = makeController({ isEvaluating: () => false, evaluate, cancel });
        (controller as unknown as { pending: boolean }).pending = true;
        state.text = '太短';

        await controller.evaluate();

        expect((controller as unknown as { pending: boolean }).pending).toBe(false);
        expect(evaluate).not.toHaveBeenCalled();
    });

    it('正文 50–99 字同样不评估、清空顶栏（与 WQE 统一门槛 100）', async () => {
        const evaluate = vi.fn();
        const cancel = vi.fn();
        const { controller, status, state } = makeController({ isEvaluating: () => false, evaluate, cancel });
        // 76 字：高于旧阈值 50，但低于 WQE/QSE 的可评估门槛
        state.text = '这是一段六十字左右的正文，用来锁定实时质量评估的五十一到九十九字空结果分支。'.repeat(2);
        expect(state.text.length).toBeGreaterThanOrEqual(50);
        expect(state.text.length).toBeLessThan(100);

        await controller.evaluate();

        // 评估只会拿到 0 分空结果，显示成「质量 0」就是把无法评估当成写得差
        expect(evaluate).not.toHaveBeenCalled();
        expect((controller as unknown as { pending: boolean }).pending).toBe(false);
        expect(status.setText).toHaveBeenCalledWith('');
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('正文过短时清空顶栏旧分数并中止在途评估', async () => {
        const evaluate = vi.fn();
        const cancel = vi.fn();
        const { controller, status, state } = makeController({ isEvaluating: () => false, evaluate, cancel });
        state.text = '太短';

        await controller.evaluate();

        // 短正文不会再产生评估结果：上一份分数必须清掉，否则顶栏长期停在旧数据
        expect(status.setText).toHaveBeenCalledWith('');
        expect(status.removeAttribute).toHaveBeenCalledWith('title');
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('被取消的评估不覆盖顶栏，也不落盘', async () => {
        const evaluate = vi.fn().mockResolvedValue({
            cancelled: true,
            qualityScore: { overallScore: 80, issues: [] },
        });
        const { controller, status } = makeController({ isEvaluating: () => false, evaluate, cancel: vi.fn() });
        vi.spyOn(controller as unknown as { buildDeviationContext: () => Promise<object> }, 'buildDeviationContext')
            .mockResolvedValue({});
        const persist = vi.spyOn(controller as unknown as { persistLiveQualityIfDue: () => Promise<void> }, 'persistLiveQualityIfDue')
            .mockResolvedValue(undefined);

        await controller.evaluate();

        // 只保留开始时的「质量评估中…」，不能用取消结果里的分数覆盖
        expect(status.setText).toHaveBeenCalledTimes(1);
        expect(status.setText).not.toHaveBeenCalledWith(expect.stringContaining('质量 80'));
        expect(persist).not.toHaveBeenCalled();
    });

    it('把人物档案与大纲作为 qualityContext 传给质量引擎，且上下文只构建一次', async () => {
        const evaluate = vi.fn().mockResolvedValue(okResult());
        const { controller } = makeController({ isEvaluating: () => false, evaluate, cancel: vi.fn() });
        const deviationContext = {
            chapterId: '/测试书/第1卷/第1章.md',
            chapterOutline: '第1章：雨夜送伞',
            characterInfos: [{ name: '林默' }, { name: '苏晚' }],
        };
        const buildDeviationContext = vi.spyOn(
            controller as unknown as { buildDeviationContext: () => Promise<typeof deviationContext> },
            'buildDeviationContext',
        ).mockResolvedValue(deviationContext);
        vi.spyOn(controller as unknown as { persistLiveQualityIfDue: () => Promise<void> }, 'persistLiveQualityIfDue')
            .mockResolvedValue(undefined);

        await controller.evaluate();

        // 质量与偏离必须共用同一份上下文：各读一次会导致人物档案/大纲不同源
        expect(buildDeviationContext).toHaveBeenCalledTimes(1);
        const payload = evaluate.mock.calls[0][1];
        expect(payload.deviationContext).toBe(deviationContext);
        expect(payload.qualityContext).toEqual({
            chapterId: deviationContext.chapterId,
            chapterOutline: deviationContext.chapterOutline,
            characterInfos: deviationContext.characterInfos,
        });
    });

    it('切章时清空顶栏旧分数、title 与挂起标记，并中止在途评估', () => {
        const cancel = vi.fn();
        const { controller, status } = makeController({ isEvaluating: () => true, evaluate: vi.fn(), cancel });
        (controller as unknown as { pending: boolean }).pending = true;

        controller.resetForChapterSwitch();

        expect((controller as unknown as { pending: boolean }).pending).toBe(false);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(status.setText).toHaveBeenCalledWith('');
        expect(status.removeAttribute).toHaveBeenCalledWith('title');
    });
});
