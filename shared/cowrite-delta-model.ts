/**
 * cowrite-delta-model.ts — 协同写作「只补差异」（纯函数）
 *
 * 协同写作是句子级高频调用；现状每个请求都重发同一批切片。
 * 这里记录「上次注入的 ID 集合」，同一场景内只渲染新增条目，其余不再重发。
 */

/** 注入快照 */
export interface InjectedSnapshot {
    /** 场景键（场景 ID 或章-场） */
    sceneKey: string;
    /** 已注入的条目 key（kind:id） */
    keys: string[];
    /** 时间 */
    at: number;
}

/** 差异结果 */
export interface CowriteDelta {
    /** 是否同一场景 */
    sameScene: boolean;
    /** 新增 key */
    added: string[];
    /** 已移除 key（场景内容被删） */
    removed: string[];
    /** 未变化 key */
    unchanged: string[];
}

/**
 * 计算两次注入的差异。
 *
 * @param previous - 上次快照（可为 null）
 * @param current - 本次需要的 key
 * @param sceneKey - 当前场景键
 * @returns 差异
 */
export function computeDelta(
    previous: InjectedSnapshot | null,
    current: readonly string[],
    sceneKey: string,
): CowriteDelta {
    const currentSet = new Set(current);
    if (!previous) {
        return { sameScene: false, added: [...currentSet], removed: [], unchanged: [] };
    }
    const previousSet = new Set(previous.keys);
    const added: string[] = [];
    const unchanged: string[] = [];
    for (const key of currentSet) {
        if (previousSet.has(key)) unchanged.push(key);
        else added.push(key);
    }
    const removed = [...previousSet].filter(key => !currentSet.has(key));
    return { sameScene: previous.sceneKey === sceneKey, added, removed, unchanged };
}

/**
 * 是否需要重新注入（同场景且无新增 → 不需要）。
 *
 * @param delta - 差异
 * @returns 需要返回 true
 */
export function shouldInject(delta: CowriteDelta): boolean {
    return !delta.sameScene || delta.added.length > 0 || delta.removed.length > 0;
}

/**
 * 渲染增量段落（只列新增条目；未变化/已移除显式说明）。
 *
 * @param delta - 差异
 * @param renderItem - 把 key 渲染成文本（返回空表示取不到内容）
 * @returns 段落；无需注入返回空串
 */
export function renderDeltaSection(
    delta: CowriteDelta,
    renderItem: (key: string) => string,
): string {
    if (!shouldInject(delta)) return '';
    const lines: string[] = [];
    if (!delta.sameScene) {
        lines.push('【场景已切换：重新装配本场上下文】');
    }
    if (delta.added.length > 0) {
        lines.push('【本场新增上下文（按 ID 精确补充）】');
        for (const key of delta.added) {
            const text = renderItem(key).trim();
            if (text) lines.push(`- ${key}：${text.slice(0, 120)}`);
        }
    }
    if (delta.unchanged.length > 0) {
        lines.push(`【已在上下文中，不重复发送】${delta.unchanged.length} 条：${delta.unchanged.slice(0, 10).join('、')}${delta.unchanged.length > 10 ? ' 等' : ''}`);
    }
    if (delta.removed.length > 0) {
        lines.push(`【已移除】${delta.removed.slice(0, 10).join('、')}${delta.removed.length > 10 ? ' 等' : ''}`);
    }
    return lines.join('\n');
}

/**
 * 生成新快照。
 *
 * @param sceneKey - 场景键
 * @param keys - 本次注入 key
 * @param now - 时间
 * @returns 快照
 */
export function createSnapshot(sceneKey: string, keys: readonly string[], now: number = Date.now()): InjectedSnapshot {
    return { sceneKey, keys: [...new Set(keys)], at: now };
}
