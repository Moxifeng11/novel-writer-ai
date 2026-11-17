/**
 * fingerprint-scope-logic.ts — 指纹库三层作用域的判定与引导文案（纯逻辑，阶段 D2）
 *
 * 从 `ui/views/writing-fingerprint-view.ts` 抽出：作用域页签的选中类名、
 * 当前层为空时的「去别的层看看」引导、切层时的选中态重置、标签芯片截断。
 * 此前内联在渲染方法里零覆盖——NBI-01 的引导文案拼错层名、切层忘了清选中，
 * 用户会看到「幽灵选中」而没人知道为什么。
 *
 * 约定：不 import obsidian、不碰 DOM；SCOPE_LABELS/ICONS 原样上收为单源。
 */

/** 指纹作用域 */
export type FingerprintScope = 'template' | 'global' | 'project';

/** 三层固定顺序（页签渲染顺序即此数组顺序） */
export const FINGERPRINT_SCOPES: readonly FingerprintScope[] = ['template', 'global', 'project'];

/** 层中文名（含图标，页签与详情头共用） */
export const SCOPE_LABELS: Record<FingerprintScope, string> = {
    template: '📋 模板层',
    global: '🌐 全局层',
    project: '📁 项目层',
};

/** 层图标 */
export const SCOPE_ICONS: Record<FingerprintScope, string> = {
    template: '📋',
    global: '🌐',
    project: '📁',
};

/**
 * 作用域页签的类名（选中层追加 `--active` 修饰类，样式见 styles-src/32-fingerprint.css）。
 *
 * @param activeScope - 当前选中层
 * @param scope - 本页签对应的层
 * @returns 类名串
 */
export function buildScopeTabClass(activeScope: FingerprintScope, scope: FingerprintScope): string {
    return scope === activeScope
        ? 'nw-fingerprint-scope-tab nw-fingerprint-scope-tab--active'
        : 'nw-fingerprint-scope-tab';
}

/**
 * 当前层为空时的空态引导（NBI-01）。
 *
 * 优先指向**有数据的其它层**（用户还有救）；三层全空才给「去提取」的兜底文案。
 *
 * @param activeScope - 当前层
 * @param scopeCounts - 各层指纹数量
 * @returns 引导文案
 */
export function buildEmptyScopeGuidance(
    activeScope: FingerprintScope,
    scopeCounts: Record<FingerprintScope, number>,
): string {
    const otherScopes = FINGERPRINT_SCOPES
        .filter(scope => scope !== activeScope && scopeCounts[scope] > 0);
    if (otherScopes.length > 0) {
        return `当前层暂无指纹，可切换到${otherScopes.map(scope => SCOPE_LABELS[scope]).join(' / ')}查看`;
    }
    return '从章节文本提取写作指纹，用于风格对齐与参考';
}

/** 切层后的选中态（切层必须清空选中，否则详情面板显示的是别的层的指纹） */
export interface ScopeSelectionState {
    activeScope: FingerprintScope;
    selectedFingerprintId: string | null;
    selectedFingerprintScope: FingerprintScope | null;
}

/**
 * 计算切层后的状态：activeScope 换成目标层，选中清空。
 *
 * @param scope - 目标层
 * @returns 新的选中态
 */
export function resetScopeSelection(scope: FingerprintScope): ScopeSelectionState {
    return {
        activeScope: scope,
        selectedFingerprintId: null,
        selectedFingerprintScope: null,
    };
}

/**
 * 标签芯片最多展示条数（搜索过滤区，「全部」之外最多 10 个）。
 *
 * @param tags - 全部标签
 * @param limit - 上限，默认 10
 * @returns 截取后的新数组
 */
export function visibleTagChips(tags: readonly string[], limit = 10): string[] {
    return tags.slice(0, Math.max(0, limit));
}
