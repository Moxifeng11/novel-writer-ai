/**
 * kb-reference-config.ts — 知识库「参考书籍」开关 / 主参考 / 权重
 *
 * 从 `ui/co-writing-view.ts` 抽出：启用上限、顺序与权重规则、落盘与引擎同步。
 * 设置与插件镜像通过宿主注入，纯规则可单测。
 */

/** 参考书籍配置（推给引擎/注入器）。 */
export interface ReferenceBookConfig {
    /** 书籍 ID */
    bookId: string;
    /** 权重（首位固定 1） */
    weight: number;
    /** 是否主参考 */
    isPrimary: boolean;
}

/** 参考书配置宿主。 */
export interface KbReferenceHost {
    /** 当前参考书 ID 顺序 */
    getReferences(): string[];
    /** 已保存的权重表 */
    getWeights(): Record<string, number>;
    /** 写插件镜像字段 */
    mirrorReferences(ids: string[]): void;
    /** 写权重表（不落盘） */
    setWeights(weights: Record<string, number>): void;
    /** 持久化设置 */
    saveSettings(): void;
    /** 推给引擎与注入器 */
    applyConfig(config: ReferenceBookConfig[]): void;
    /** 重渲染书籍列表 */
    renderBookList(): void;
    /** 刷新章节匹配 */
    refreshChapterMatch(): void;
    /** 刷新写作建议 */
    refreshWritingAdvice(): void;
    /** 成功提示 */
    notifySuccess(message: string): void;
    /** 上限提示 */
    notifyLimit(message: string): void;
}

/** 开关决策结果。 */
export interface ToggleReferencePlan {
    /** change = 需要写入；limit = 已达上限 */
    kind: 'change' | 'limit';
    /** 新的参考书顺序 */
    refs: string[];
    /** 提示文本 */
    message: string;
}

/**
 * 计算启用/停用参考书后的列表与提示。
 *
 * @param currentRefs - 当前参考书
 * @param bookId - 目标书籍
 * @param enable - 是否启用
 * @param max - 上限（默认 3）
 * @returns 决策结果
 * @example
 * ```ts
 * planToggleReference(['a', 'b'], 'c', true);
 * ```
 */
export function planToggleReference(
    currentRefs: string[],
    bookId: string,
    enable: boolean,
    max = 3,
): ToggleReferencePlan {
    if (enable) {
        if (currentRefs.length >= max) {
            return { kind: 'limit', refs: currentRefs, message: `最多只能启用 ${max} 本参考书籍` };
        }
        return { kind: 'change', refs: [...currentRefs, bookId], message: '' };
    }
    return { kind: 'change', refs: currentRefs.filter(id => id !== bookId), message: '' };
}

/**
 * 归一化参考权重到 0.1–1，保留两位小数。
 *
 * @param weight - 原始权重
 * @returns 归一化权重
 * @example
 * ```ts
 * normalizeReferenceWeight(0.333);
 * ```
 */
export function normalizeReferenceWeight(weight: number): number {
    return Math.max(0.1, Math.min(1, Math.round(weight * 100) / 100));
}

/**
 * 构建推给引擎的参考书配置（首位主参考、权重 1）。
 *
 * @param ids - 参考书顺序
 * @param weights - 权重表
 * @returns 配置数组
 * @example
 * ```ts
 * buildReferenceBookConfig(['a', 'b'], { b: 0.7 });
 * ```
 */
export function buildReferenceBookConfig(
    ids: string[],
    weights: Record<string, number>,
): ReferenceBookConfig[] {
    return ids.map((id, index) => ({
        bookId: id,
        weight: index === 0 ? 1 : (weights[id] ?? 0.5),
        isPrimary: index === 0,
    }));
}

/**
 * 持久化参考书并同步到引擎。
 *
 * @param host - 宿主
 * @param refs - 新顺序
 * @example
 * ```ts
 * persistReferenceBookIds(host, ['a']);
 * ```
 */
export function persistReferenceBookIds(host: KbReferenceHost, refs: string[]): void {
    host.mirrorReferences(refs);
    host.saveSettings();
    host.applyConfig(buildReferenceBookConfig(refs, host.getWeights()));
}

/**
 * 启用/停用参考书。
 *
 * @param host - 宿主
 * @param bookId - 书籍 ID
 * @param bookName - 书籍名（提示用）
 * @param enable - 是否启用
 * @example
 * ```ts
 * toggleReferenceBook(host, 'book-1', '参考书', true);
 * ```
 */
export function toggleReferenceBook(
    host: KbReferenceHost,
    bookId: string,
    bookName: string,
    enable: boolean,
): void {
    const plan = planToggleReference(host.getReferences(), bookId, enable);
    if (plan.kind === 'limit') {
        host.notifyLimit(plan.message);
        return;
    }
    persistReferenceBookIds(host, plan.refs);
    host.notifySuccess(enable ? `已启用《${bookName}》作为参考` : `已停用《${bookName}》的参考`);
    host.renderBookList();
    host.refreshChapterMatch();
    host.refreshWritingAdvice();
}

/**
 * 设为主参考书（移到首位）。
 *
 * @param host - 宿主
 * @param bookId - 书籍 ID
 * @example
 * ```ts
 * setPrimaryReference(host, 'book-2');
 * ```
 */
export function setPrimaryReference(host: KbReferenceHost, bookId: string): void {
    const currentRefs = host.getReferences();
    const index = currentRefs.indexOf(bookId);
    if (index <= 0) return;
    persistReferenceBookIds(host, [bookId, ...currentRefs.filter(id => id !== bookId)]);
    host.notifySuccess('已设为主参考书籍');
    host.renderBookList();
    host.refreshWritingAdvice();
}

/**
 * 调整参考权重并立即作用到注入器。
 *
 * @param host - 宿主
 * @param bookId - 书籍 ID
 * @param weight - 原始权重
 * @example
 * ```ts
 * adjustReferenceWeight(host, 'book-2', 0.8);
 * ```
 */
export function adjustReferenceWeight(host: KbReferenceHost, bookId: string, weight: number): void {
    const weights = {
        ...host.getWeights(),
        [bookId]: normalizeReferenceWeight(weight),
    };
    host.setWeights(weights);
    host.saveSettings();
    host.applyConfig(buildReferenceBookConfig(host.getReferences(), weights));
    host.refreshWritingAdvice();
}
