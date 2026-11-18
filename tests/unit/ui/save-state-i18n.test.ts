/**
 * save-state-i18n.test.ts — 协同写作保存状态枚举 + 双语（缺口⑦ 跨层数据⑤，ZC-20261120-05）
 *
 * 修的是一个**真 bug**：此前状态是中文文案字符串直接流转，
 * `isDirtyState()` 与 `toggleClass(..., state !== '已保存')` 都拿中文比较——
 * en 界面下 `body-save-controller` 传的是译文，比较必然失败（脏标记永亮、切章守卫失灵）。
 *
 * 现在状态是枚举（语言无关），展示走 `saveStateLabel()`。本测试锁：
 * 1. 判脏只看枚举，与语言完全无关（zh/en 结果一致）；
 * 2. 展示文案随语言切换，且 en 无键名回退；
 * 3. `parseSaveState()` 能解析枚举、当前语言文案、以及 zh 历史文案。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../i18n';
import {
    isDirtySaveState,
    parseSaveState,
    SAVE_STATES,
    saveStateLabel,
    type SaveState,
} from '../../../ui/co-writing/save-state';
import { isDirtyState } from '../../../ui/co-writing/dashboard-status';

afterEach(() => {
    setLocale('zh-CN');
});

describe('协同写作保存状态（缺口⑦ 跨层数据⑤）', () => {
    it('判脏只看枚举：zh 与 en 结果完全一致', () => {
        const dirtyStates: SaveState[] = ['editing', 'saving', 'saveFailed', 'externallyModified'];
        const cleanStates: SaveState[] = ['saved', 'loaded'];

        setLocale('zh-CN');
        const zhDirty = SAVE_STATES.map(state => isDirtySaveState(state));
        setLocale('en-US');
        const enDirty = SAVE_STATES.map(state => isDirtySaveState(state));
        expect(enDirty).toEqual(zhDirty);

        for (const state of dirtyStates) expect(isDirtySaveState(state), state).toBe(true);
        for (const state of cleanStates) expect(isDirtySaveState(state), state).toBe(false);
    });

    it('历史字符串入参（zh 文案）在 en 界面下仍能正确判脏', () => {
        // 这是原 bug 的核心场景：调用方传 zh 文案，界面语言是 en
        setLocale('en-US');
        expect(isDirtyState('已保存')).toBe(false);
        expect(isDirtyState('已加载')).toBe(false);
        expect(isDirtyState('编辑中')).toBe(true);
        expect(isDirtyState('保存失败')).toBe(true);
        expect(isDirtyState('外部已修改')).toBe(true);
    });

    it('en 界面下传入英文文案也能正确判脏', () => {
        setLocale('en-US');
        expect(isDirtyState('Saved')).toBe(false);
        expect(isDirtyState('Loaded')).toBe(false);
        expect(isDirtyState('Editing')).toBe(true);
        expect(isDirtyState('Save failed')).toBe(true);
        expect(isDirtyState('Externally modified')).toBe(true);
    });

    it('展示文案随语言切换，en 无键名回退', () => {
        setLocale('zh-CN');
        expect(saveStateLabel('saved')).toBe('已保存');
        expect(saveStateLabel('loaded')).toBe('已加载');
        expect(saveStateLabel('editing')).toBe('编辑中');
        expect(saveStateLabel('saving')).toBe('保存中...');
        expect(saveStateLabel('saveFailed')).toBe('保存失败');
        expect(saveStateLabel('externallyModified')).toBe('外部已修改');

        setLocale('en-US');
        for (const state of SAVE_STATES) {
            const label = saveStateLabel(state);
            expect(label, state).not.toMatch(/[\u4e00-\u9fff]/);
            expect(label).not.toMatch(/cowrite\./);
        }
    });

    it('parseSaveState 覆盖三种输入形态', () => {
        setLocale('zh-CN');
        expect(parseSaveState('saved')).toBe('saved');
        expect(parseSaveState('已保存')).toBe('saved');
        expect(parseSaveState('未知状态')).toBeNull();
        expect(parseSaveState('')).toBeNull();

        setLocale('en-US');
        expect(parseSaveState('Saved')).toBe('saved');
        // en 界面下传 zh 历史文案也要能解析
        expect(parseSaveState('已保存')).toBe('saved');
        expect(parseSaveState('编辑中')).toBe('editing');
    });
});
