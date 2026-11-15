/**
 * M5 收口：正文步严格场景注入（默认关）
 *
 * 开关关闭时保持整库注入；开启且有 Scene 展开时，整库实体/世界观/设定库交给场景上下文。
 */

import { describe, expect, it } from 'vitest';
import type { GatheredContext } from '@/engine/context/context-types';
import {
    buildContextVars,
    buildEntityVars,
    type TemplateVarsDeps,
} from '@/ui/full-writer/template-vars-builder';

const context = {
    project: 'p',
    gatheredAt: '2026-01-01T00:00:00.000Z',
    issues: [],
    data: {
        world_view: { raw: '## 世界规则\n灵气从地脉升起。', sections: [] },
        setting_lib: { raw: '## 力量体系\n顺脉者引气入体。', sections: [] },
    },
} as unknown as GatheredContext;

const makeDeps = (strict: boolean, withScene: boolean): TemplateVarsDeps => ({
    app: { vault: { getFiles: () => [], getAbstractFileByPath: () => null } } as never,
    plugin: { settings: { maxContext: 128000, bodySceneContextStrict: strict } } as never,
    project: 'p',
    chapterName: '第1章',
    chapterNum: 1,
    volume: '第1卷',
    chapDir: '',
    context,
    viewVars: {},
    stepResults: withScene ? { sceneExpand: '## 场景1：山门\n- 在场人物：林玄' } : {},
} as unknown as TemplateVarsDeps);

describe('M5 严格场景注入开关', () => {
    it('关闭时保留整库世界观/设定库', async () => {
        const vars: Record<string, string> = {};
        await buildContextVars(makeDeps(false, true), vars, context.data);
        expect(vars['worldView']).toBeTruthy();
        expect(vars['settingLib']).toBeTruthy();
    });

    it('开启且有场景时清空世界观/设定库', async () => {
        const vars: Record<string, string> = {};
        await buildContextVars(makeDeps(true, true), vars, context.data);
        expect(vars['worldView']).toBe('');
        expect(vars['settingLib']).toBe('');
    });

    it('开启但无场景数据时保持注入（不误伤）', async () => {
        const vars: Record<string, string> = {};
        await buildContextVars(makeDeps(true, false), vars, context.data);
        expect(vars['worldView']).toBeTruthy();
    });

    it('实体变量同样遵循开关（无实体数据时为空，不抛错）', async () => {
        const vars: Record<string, string> = {};
        await buildEntityVars(makeDeps(true, true), vars, context.data);
        expect(vars['allChars']).toBe('');
        expect(vars['allFactions']).toBe('');
    });
});
