/**
 * full-writer-view-contracts.test.ts — 完整写作工作台的视图层回归
 *
 * 锁定四处：
 * 1. 向导结果缓存按项目分桶（旧实现构造时读 global、之后写当前项目 → 跨项目串扰且不能恢复）；
 * 2. 页签重渲染就地清空 stepResults（换对象会让运行中的编排器写进孤儿对象）+ 切章取消在跑任务；
 * 3. 设定库完成检测与校验器同口径（缺模块必须返回 false，否则状态被翻回 done 永久卡步）；
 * 4. 场景细纲防抖保存写回「编辑发生时的章节」，而不是切章后的新章。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { createPersistentWizardResults } from '../../../ui/full-writer/wizard-results-store';
import { WizardChecker } from '../../../ui/wizard-checker';
import { SceneOutlineController } from '../../../ui/full-writer/scene-outline-controller';
import { TEMPLATE_VAR_FALLBACK_KEYS } from '../../../ui/full-writer/template-vars-builder';
import { pjSettingLib, pjStepFile } from '../../../shared/paths';

class MemoryStorage {
    private map = new Map<string, string>();
    getItem(key: string): string | null { return this.map.get(key) ?? null; }
    setItem(key: string, value: string): void { this.map.set(key, value); }
    removeItem(key: string): void { this.map.delete(key); }
    clear(): void { this.map.clear(); }
}

describe('向导结果缓存 — 按项目分桶', () => {
    const originalLocalStorage = globalThis.localStorage;

    beforeEach(() => {
        (globalThis as any).localStorage = new MemoryStorage();
    });
    afterEach(() => {
        (globalThis as any).localStorage = originalLocalStorage;
    });

    it('切换项目后读写都落到各自项目，互不污染', () => {
        let project = '';
        const results = createPersistentWizardResults(() => project);

        // 构造时项目还为空
        project = 'A书';
        results['worldview'] = 'A 的世界观';
        expect(results['worldview']).toBe('A 的世界观');

        // 切到 B：不能读到 A 的内容
        project = 'B书';
        expect(results['worldview']).toBeUndefined();
        results['worldview'] = 'B 的世界观';
        expect(results['worldview']).toBe('B 的世界观');

        // 切回 A：历史结果仍在（旧实现读的是 global key，永远读不回来）
        project = 'A书';
        expect(results['worldview']).toBe('A 的世界观');
        // 键枚举也按当前项目
        expect(Object.keys(results)).toContain('worldview');
    });

    it('同一项目跨实例可恢复（重启后读回）', () => {
        let project = 'A书';
        const first = createPersistentWizardResults(() => project);
        first['setting_lib'] = '设定库内容';

        const second = createPersistentWizardResults(() => project);
        expect(second['setting_lib']).toBe('设定库内容');
    });
});

describe('模板变量兜底清单', () => {
    it('覆盖「只在有 context 时写入」的实体/世界变量', () => {
        for (const key of [
            'allChars', 'allFactions', 'allLocs', 'allItems',
            'worldType', 'worldEra', 'powerSystem', 'forbiddenElements',
            'characterCores', 'timeline', 'protagonistName',
        ]) {
            expect(TEMPLATE_VAR_FALLBACK_KEYS).toContain(key);
        }
    });
});

describe('WizardChecker.checkSettingLibComplete — 与校验器同口径', () => {
    function makeChecker(content: string): WizardChecker {
        const app = {
            vault: {
                getAbstractFileByPath: (path: string) => (path === pjSettingLib('测试书') ? { path } : null),
                read: async () => content,
            },
        };
        return new WizardChecker(app as never);
    }

    // TFile 判定依赖 obsidian mock：用一个能被 instanceof TFile 接受的对象
    it('缺模块时返回 false（旧实现只 warn 仍返回 true，导致状态在 done/warning 之间反复横跳）', async () => {
        const checker = makeChecker('# 设定库\n\n## 一、世界观底层规则\n内容\n');
        // 直接替换成 mock TFile 实例
        const { TFile } = await import('obsidian');
        const file = new TFile();
        file.path = pjSettingLib('测试书');
        (checker as any).app.vault.getAbstractFileByPath = () => file;

        expect(await checker.checkSettingLibComplete('测试书')).toBe(false);
    });

    it('八个模块齐全且无待填充提示时返回 true', async () => {
        const content = [
            '# 设定库',
            '## 一、世界观底层规则', '内容',
            '## 二、核心设定', '内容',
            '## 三、力量体系详情', '内容',
            '## 四、科技水平', '内容',
            '## 五、势力分布', '内容',
            '## 六、地理/区域', '内容',
            '## 七、关键历史事件', '内容',
            '## 八、当前故事阶段', '内容',
        ].join('\n');
        const checker = makeChecker(content);
        const { TFile } = await import('obsidian');
        const file = new TFile();
        file.path = pjSettingLib('测试书');
        (checker as any).app.vault.getAbstractFileByPath = () => file;

        expect(await checker.checkSettingLibComplete('测试书')).toBe(true);
    });
});

describe('TabController — 切章取消在跑任务、重渲染不换 stepResults 对象', () => {
    async function makeHarness() {
        const { TabController } = await import('../../../ui/full-writer/tab-controller');
        const stepResults: Record<string, string> = {
            context: '已有上下文',
            bodyGeneration: '旧正文',
        };
        const chapterState = {
            currentStepIndex: 3,
            stepCompleted: new Set(['context', 'bodyGeneration']),
            stepResults,
            restoreChapterState: vi.fn(async () => undefined),
        };
        const state: any = {
            project: 'A书',
            chapterName: '第1章',
            chapterNum: 1,
            volume: '第1卷',
            chapDir: '',
            activeTabId: 'tab-1',
            navStack: ['tab-1'],
            tabs: [
                {
                    id: 'tab-1', label: '✍️ 第1章', type: 'chapter',
                    project: 'A书', chapterName: '第1章', volume: '第1卷', chapterNum: 1, chapDir: '',
                },
                {
                    id: 'tab-2', label: '✍️ 第2章', type: 'chapter',
                    project: 'A书', chapterName: '第2章', volume: '第1卷', chapterNum: 2, chapDir: '',
                },
            ],
            findTab(id: string) { return this.tabs.find((t: any) => t.id === id); },
            setNavigationState(patch: Record<string, unknown>) { Object.assign(this, patch); },
            popNav() { return this.navStack.pop(); },
        };
        const cancelActiveRun = vi.fn();
        const renderInContainer = vi.fn(async () => undefined);
        const controller = new TabController({
            app: {} as never,
            plugin: {} as never,
            state,
            getTabBar: () => null,
            getTabContent: () => ({ empty: () => undefined }) as never,
            closeOutlineTreeModal: () => undefined,
            renderProjectSelector: async () => undefined,
            renderWizardTabContent: async () => undefined,
            renderInContainer,
            loadContext: async () => undefined,
            getChapterStateManager: () => chapterState,
            calcResumeStepIndex: () => 0,
            rebuildChapDirIfNeeded: () => 'dir',
            cancelActiveRun,
        });
        return { controller, state, chapterState, cancelActiveRun };
    }

    it('同一章重渲染时就地清空 stepResults（引用不变），不取消任务', async () => {
        const { controller, chapterState, cancelActiveRun } = await makeHarness();
        const ref = chapterState.stepResults;

        await controller.renderTabContent();

        // 引用必须保持不变：编排器在 run() 开始时捕获了它
        expect(chapterState.stepResults).toBe(ref);
        expect(Object.keys(ref)).toEqual([]);
        expect(cancelActiveRun).not.toHaveBeenCalled();
    });

    it('切到另一章时先取消在跑的一键任务', async () => {
        const { controller, state, cancelActiveRun } = await makeHarness();
        state.activeTabId = 'tab-2';

        await controller.renderTabContent();

        expect(cancelActiveRun).toHaveBeenCalledTimes(1);
    });

    it('关闭页签同时清理导航栈，避免「返回」跳到不存在的页签', async () => {
        const { controller, state } = await makeHarness();
        state.navStack = ['tab-1', 'tab-2'];

        controller.closeTab('tab-1');

        expect(state.navStack).not.toContain('tab-1');
        expect(state.tabs.some((t: any) => t.id === 'tab-1')).toBe(false);
    });
});

describe('InterventionController — 执行边界（幂等 / 步骤切换）', () => {
    async function makeHarness(stepIndex: () => number) {
        const { InterventionController } = await import('../../../ui/full-writer/intervention-controller');
        const { ALL_FULL_STEPS } = await import('../../../engine/step-runner');
        const executed = vi.fn(async () => undefined);
        const setVar = vi.fn();
        const deps = {
            getVars: () => ({}),
            setVar,
            deleteVar: vi.fn(),
            getStepResults: () => ({}),
            setStepResult: vi.fn(),
            getAIEngine: () => ({} as never),
            getStepRunner: () => ({ executeCurrentStep: executed } as never),
            getCurrentStepIndex: stepIndex,
            makeStepRunCtx: () => ({} as never),
            onRenderNeeded: vi.fn(async () => undefined),
            getFlashModel: () => 'flash',
        };
        const controller = new InterventionController({} as never, {} as never, deps);
        (controller as any).currentReport = {
            summary: '调整开头',
            actions: [{ type: 'modify', target: '第2段', content: '改成雨夜' }],
        };
        return { controller, executed, setVar, ALL_FULL_STEPS };
    }

    it('同一报告重复点击「确认执行」只跑一次（并发/幂等守卫）', async () => {
        const { controller, executed, setVar, ALL_FULL_STEPS } = await makeHarness(() => 1);
        (controller as any).reportStepKey = ALL_FULL_STEPS[1].key;
        await Promise.all([
            (controller as any).executeIntervention(),
            (controller as any).executeIntervention(),
        ]);
        expect(executed).toHaveBeenCalledTimes(1);
        expect(setVar).toHaveBeenCalledTimes(1);
    });

    it('理解后步骤切换则拒绝执行，不写入 userIntervention', async () => {
        let index = 1;
        const { controller, executed, setVar, ALL_FULL_STEPS } = await makeHarness(() => index);
        (controller as any).reportStepKey = ALL_FULL_STEPS[1].key;
        index = 2;
        await (controller as any).executeIntervention();
        expect(executed).not.toHaveBeenCalled();
        expect(setVar).not.toHaveBeenCalled();
    });
});

describe('SceneOutlineController — 防抖保存写回编辑发生时的章节', () => {
    const originalWindow = (globalThis as any).window;

    beforeEach(() => {
        // node 环境没有 window：controller 用 window.setTimeout 做防抖
        (globalThis as any).window = {
            setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
            clearTimeout: (id: any) => clearTimeout(id),
        };
    });
    afterEach(() => {
        (globalThis as any).window = originalWindow;
    });

    function makeController(initial: { project: string; chapterNum: number }) {
        const state = { ...initial };
        const writes: Array<{ path: string; content: string }> = [];
        const files = new Map<string, string>();
        const app = {
            vault: {
                getAbstractFileByPath: (path: string) => (files.has(path) ? { path } : null),
                read: async (file: { path: string }) => files.get(file.path) || '',
                modify: async (file: { path: string }, content: string) => {
                    writes.push({ path: file.path, content });
                    files.set(file.path, content);
                },
                create: async (path: string, content: string) => {
                    writes.push({ path, content });
                    files.set(path, content);
                    return { path };
                },
                createFolder: async () => undefined,
            },
        };
        const controller = new SceneOutlineController({
            app: app as never,
            plugin: {} as never,
            getProject: () => state.project,
            getChapterNum: () => state.chapterNum,
            getVolume: () => '第1卷',
            getChapDir: () => '',
        });
        // 载入一章的场景（两场），并标记可保存状态
        (controller as any).scenes = [
            { index: 1, name: '场景一', content: '甲', characters: [], location: '', pov: '', purpose: '', wordCountEstimate: 0, status: 'pending' },
        ];
        (controller as any).originalContent = '## 场景1：场景一\n内容\n';
        (controller as any).currentSceneIndex = 0;
        return { controller, state, writes, files };
    }

    it('编辑后切章，定时器把旧章内容写回旧章路径', async () => {
        const { controller, state, writes } = makeController({ project: 'A书', chapterNum: 1 });

        // 在「第1章」编辑 → markDirty 捕获目标
        (controller as any).markDirty();
        // 立刻切到第2章（定时器还没触发）
        state.chapterNum = 2;
        (controller as any).pendingSaveTarget = (controller as any).pendingSaveTarget; // 保持捕获值

        // 手动触发防抖回调（清掉定时器避免真实等待）
        const timer = (controller as any).saveTimer;
        if (timer) clearTimeout(timer);
        await controller.saveScenes();

        expect(writes).toHaveLength(1);
        expect(writes[0].path).toBe(pjStepFile('A书', 1, 1, 'Scene展开'));
    });
});
