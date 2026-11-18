/**
 * save-state.ts — 协同写作「保存状态」的稳定标识与展示映射（i18n 跨层数据⑤，ZC-20261120-05）
 *
 * 背景：此前状态是**中文文案字符串**直接流转（`updateControlState('已保存')`），
 * 判脏（`isDirtyState`）与类名切换（`toggleClass(..., state !== '已保存')`）都拿中文比较。
 * 一旦界面语言切到 en，传入的是译文，比较必然失效——脏标记永远亮着、切章守卫失灵。
 *
 * 现在：**状态是枚举（稳定标识，不随语言变）**，展示文案由 `saveStateLabel()` 求值。
 * 任何比较一律比枚举，禁止再比中文。
 */
import { getCatalog, t } from '@/i18n';

/** 保存状态（稳定标识） */
export type SaveState = 'saved' | 'loaded' | 'editing' | 'saving' | 'saveFailed' | 'externallyModified';

/** 全部状态（遍历/测试用） */
export const SAVE_STATES: readonly SaveState[] = [
    'saved',
    'loaded',
    'editing',
    'saving',
    'saveFailed',
    'externallyModified',
];

/** 状态 → i18n 键 */
const SAVE_STATE_KEYS: Record<SaveState, string> = {
    saved: 'cowrite.save.stateSaved',
    loaded: 'cowrite.save.stateLoaded',
    editing: 'cowrite.save.stateEditing',
    saving: 'cowrite.save.stateSaving',
    saveFailed: 'cowrite.save.stateSaveFailed',
    externallyModified: 'cowrite.save.stateExternallyModified',
};

/**
 * 状态展示文案（当前语言）。
 *
 * @param state - 保存状态
 * @returns 展示文案
 */
export function saveStateLabel(state: SaveState): string {
    return t(SAVE_STATE_KEYS[state]);
}

/**
 * 是否为「未保存」类脏状态（`saved` / `loaded` 之外都算脏）。
 *
 * 比枚举，不比文案——这是本文件存在的理由。
 *
 * @param state - 保存状态
 * @returns 是否显示脏标记
 */
export function isDirtySaveState(state: SaveState): boolean {
    return state !== 'saved' && state !== 'loaded';
}

/**
 * 把历史字符串入参解析回枚举（过渡用）。
 *
 * 兼容三类输入：枚举字面量、当前语言求值结果、以及 zh 资源里的展示文案
 * （从资源反查，不在本文件写死中文——否则新增裸中文会被 check:i18n 棘轮拦下）。
 *
 * @param raw - 原始状态文本
 * @returns 状态枚举或 null
 */
export function parseSaveState(raw: string): SaveState | null {
    const text = String(raw ?? '').trim();
    if (!text) return null;
    if ((SAVE_STATES as readonly string[]).includes(text)) return text as SaveState;
    // 按当前语言反查
    for (const state of SAVE_STATES) {
        if (saveStateLabel(state) === text) return state;
    }
    // 按中文资源反查（历史调用方传的是 zh 文案，即使当前语言是 en）
    for (const state of SAVE_STATES) {
        const key = SAVE_STATE_KEYS[state];
        if (zhCatalogLookup(key) === text) return state;
    }
    return null;
}

/**
 * 从 zh 资源取文案（不写死中文，保证棘轮干净）。
 *
 * @param key - 文案键
 * @returns zh 文案；缺键返回空串
 */
function zhCatalogLookup(key: string): string {
    const catalog = getCatalog('zh-CN') as unknown as Record<string, unknown>;
    let node: unknown = catalog;
    for (const part of key.split('.')) {
        if (!node || typeof node !== 'object') return '';
        node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string' ? node : '';
}
