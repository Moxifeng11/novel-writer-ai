/**
 * knowledge-detail-state.ts — 知识库详情的「加载态/错误态」纯逻辑（G7-4d）
 *
 * 从 knowledge-base-view 抽出的三条易回归规则：
 *  1. 每次开始加载详情必须把 8 个数据字段整体清空（否则上一本书的数据会挂到新书下）
 *  2. 错误文案统一：书籍缺失 / 读取异常分别有明确提示，绝不留空
 *  3. 列表刷新守卫：有选中书籍（详情打开）或不在「参考书籍」页签时不得重绘列表
 */

/** 详情区 8 个数据字段——新增字段必须加进这里，否则「换书不串数据」的保证失效 */
export const DETAIL_DATA_KEYS = [
    'styleData',
    'rhythmData',
    'techniqueData',
    'structureData',
    'characterData',
    'foreshadowData',
    'commercialData',
    'readabilityData',
] as const;

export type DetailDataKey = typeof DETAIL_DATA_KEYS[number];

/** 统一的空详情数据（每次开始加载都从这里整体覆盖） */
export function emptyDetailData(): Record<DetailDataKey, null> {
    return {
        styleData: null,
        rhythmData: null,
        techniqueData: null,
        structureData: null,
        characterData: null,
        foreshadowData: null,
        commercialData: null,
        readabilityData: null,
    };
}

export interface DetailErrorInput {
    /** 书籍在列表里已不存在（被删除 / 列表过期） */
    missing?: boolean;
    error?: unknown;
}

/** 详情加载失败文案；保证永远非空 */
export function detailErrorMessage(input: DetailErrorInput = {}): string {
    if (input.missing) return '书籍不存在或已被删除，请返回列表刷新';
    const { error } = input;
    if (error instanceof Error) {
        return error.message.trim() || '未知错误';
    }
    const text = error == null ? '' : String(error).trim();
    return text || '未知错误';
}

/** 是否允许重绘书籍列表：只在「参考书籍」页签且没有打开详情时 */
export function canRefreshBookList(activeMainTab: string, selectedBookId: string | null): boolean {
    return activeMainTab === 'books' && !selectedBookId;
}
