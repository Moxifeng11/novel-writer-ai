import { describe, it, expect, vi } from 'vitest';
import { App } from 'obsidian';
import { ContextLoaderController } from '../../../ui/full-writer/context-loader-controller';
import { ChapterStateManager } from '../../../ui/states/chapter-state-manager';
import type { FullWriterStore } from '../../../ui/full-writer/full-writer-store';

const CHAP_DIR = '测试项目/03-大纲与章节/步骤结果/第1卷/第1章';
const SOUL_PATH = `${CHAP_DIR}/第1章_角色灵魂.md`;

// 一段可被 validateCharacterSoul 判为 complete 的灵魂层文本
const REAL_SOUL = `【林惊鸿】
欲望：为亡妹复仇并查清家族灭门真相，不惜以身犯险
恐惧：害怕自己最终变成和仇人一样的人
执念：守住父亲的铁匠铺和那块残破的锻锤
创伤：亲眼目睹妹妹被押走却无力阻止
弱点：遇事容易冲动，听不进劝
软处：对年幼的孩子没有抵抗力
暴走红线：有人拿亡妹的名义侮辱她
底线：不牵连无辜之人`;

const SOUL_DATA = [{
    name: '林惊鸿',
    hasSoul: true,
    desire: '为亡妹复仇',
    fear: '变成仇人那样的人',
    obsession: '守住铁匠铺',
    trauma: '目睹妹妹被押走',
    weakness: '容易冲动',
    soft_spot: '对孩子心软',
    rage_trigger: '亡妹被侮辱',
    moral_boundary: '不牵连无辜',
}];

async function makeApp(seedSoul?: string): Promise<App> {
    const app = new App();
    await app.vault.createFolder(CHAP_DIR);
    if (seedSoul !== undefined) await app.vault.create(SOUL_PATH, seedSoul);
    return app;
}

function makeDeps(app: App, saveImpl: (key: string, content: string) => Promise<boolean>, souls: unknown[] = SOUL_DATA) {
    const vars: Record<string, string> = {};
    const state = {
        project: '测试项目',
        chapterName: '第1章',
        chapterNum: 0, // 0 跳过跨卷快照
        volume: '第1卷',
        chapDir: CHAP_DIR,
        vars,
        isLoading: false,
        activeTabId: '',
        tabs: [],
        navStack: [],
        wizardStepResults: {},
        wizardStepExecuting: new Set<string>(),
        setVar(key: string, value: string) { vars[key] = value; },
        deleteVar(key: string) { delete vars[key]; },
        setVars(v: Record<string, string>) { Object.assign(vars, v); },
        mergeVars(v: Record<string, string>) { Object.assign(vars, v); },
        pushNav() {},
        popNav() { return undefined; },
        navigateTo() {},
        findTab() { return undefined; },
        findTabByChapterKey() { return undefined; },
        addTab() {},
        removeTab() {},
        updateTab() {},
        activateTab() {},
        resetNavState() {},
    } as unknown as FullWriterStore;

    const ctx = { data: { character_cores: souls } };
    const saveStepResult = vi.fn(saveImpl);
    const mgr = new ChapterStateManager(app);

    const controller = new ContextLoaderController({
        app,
        plugin: {} as never,
        state,
        contextManager: {
            gatherAll: async () => ctx,
            getInfoSummary: () => '',
        } as never,
        getChapterStateManager: () => mgr,
        getContext: () => ctx as never,
        setContext: () => {},
        activateTab: async () => {},
        entityStateController: { syncInvolvedEntitiesToPlugin: () => {} } as never,
        saveStepResult,
    });

    return { controller, mgr, saveStepResult, state };
}

describe('ContextLoaderController — 角色灵魂自动提取持久化', () => {
    it('磁盘无灵魂文件时自动提取并落盘，完成态以磁盘为准', async () => {
        const app = await makeApp();
        const { controller, mgr, saveStepResult, state } = makeDeps(app, async () => true);

        await controller.loadContext();

        expect(saveStepResult).toHaveBeenCalledTimes(1);
        const [stepKey, content] = saveStepResult.mock.calls[0];
        expect(stepKey).toBe('characterSoul');
        expect(content).toContain('欲望：');
        expect(content).toContain('底线：');
        expect(mgr.stepCompleted.has('characterSoul')).toBe(true);
        expect(mgr.stepLevels['characterSoul']).toBe('complete');
        expect(state.vars['characterCores']).toContain('林惊鸿');
    });

    it('落盘失败时不得标记完成，避免重启后完成态凭空消失', async () => {
        const app = await makeApp();
        const { controller, mgr, saveStepResult } = makeDeps(app, async () => false);

        await controller.loadContext();

        expect(saveStepResult).toHaveBeenCalledTimes(1);
        expect(mgr.stepCompleted.has('characterSoul')).toBe(false);
        expect(mgr.stepLevels['characterSoul']).toBe('partial');
        expect(mgr.stepMissing['characterSoul']).toEqual(['保存失败']);
    });

    it('磁盘已有真实灵魂文件时不覆盖', async () => {
        const app = await makeApp(REAL_SOUL);
        const { controller, saveStepResult } = makeDeps(app, async () => true);

        await controller.loadContext();

        expect(saveStepResult).not.toHaveBeenCalled();
    });

    it('内存已有磁盘恢复出的内容时不覆盖', async () => {
        const app = await makeApp();
        const { controller, mgr, saveStepResult } = makeDeps(app, async () => true);
        mgr.stepResults['characterSoul'] = REAL_SOUL;

        await controller.loadContext();

        expect(saveStepResult).not.toHaveBeenCalled();
        expect(mgr.stepResults['characterSoul']).toBe(REAL_SOUL);
    });
});
