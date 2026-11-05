/**
 * dashboard-status.ts — 协同写作状态栏与人工率仪表盘
 *
 * 从 `ui/co-writing-view.ts` 抽出：字数/目标/保存状态展示、精准模式人工率面板。
 * 纯格式化函数与 DOM 渲染分离，便于锁定字数进度与脏状态判定。
 */
import { calculateHumanRate, renderHumanRate } from '@/ui/co-writing/human-rate';

/** 状态栏宿主。 */
export interface StatusBarHost {
    /** 状态栏容器 */
    statusBar: HTMLElement | null;
    /** 字数展示元素 */
    wordCountDisplay: { setText(text: string): void } | null;
    /** 目标展示元素 */
    wordGoalDisplay: { setText(text: string): void } | null;
    /** 项目名 */
    project: string;
    /** 卷名 */
    volume: string;
    /** 章节名 */
    chapterName: string;
    /** 章号 */
    chapterNum: number;
    /** 正文 */
    editorText: string;
    /** 目标字数 */
    wordGoal: number;
}

/** 人工率仪表盘宿主。 */
export interface HumanRateHost {
    /** 仪表盘容器 */
    container: HTMLElement | null;
    /** 精准模式开关 */
    precisionMode: boolean;
    /** 正文 */
    editorText: string;
}

/**
 * 生成状态栏文本。
 *
 * @param opts - 状态栏字段（项目/卷/章节/字数）
 * @param opts.project - 项目名
 * @param opts.volume - 卷名
 * @param opts.chapterName - 章节名
 * @param opts.chapterNum - 章号
 * @param opts.wordCount - 字数
 * @returns 状态栏文本
 * @example
 * ```ts
 * formatStatusLine({ project: '项目', volume: '第1卷', chapterName: '风起', chapterNum: 3, wordCount: 1200 });
 * ```
 */
export function formatStatusLine(opts: {
    project: string;
    volume: string;
    chapterName: string;
    chapterNum: number;
    wordCount: number;
}): string {
    return `📍 ${opts.project || '未选择项目'} · ${opts.volume} · ${opts.chapterName || `第${opts.chapterNum}章`} · 字数 ${opts.wordCount}`;
}

/**
 * 计算目标字数进度（0–100）。
 *
 * @param count - 当前字数
 * @param goal - 目标字数
 * @returns 进度百分比
 * @example
 * ```ts
 * computeWordGoalProgress(1500, 3000);
 * ```
 */
export function computeWordGoalProgress(count: number, goal: number): number {
    return Math.min(100, Math.round(count / goal * 100));
}

/**
 * 是否为未保存/加载中的脏状态。
 *
 * @param state - 保存状态文本
 * @returns 是否显示脏标记
 * @example
 * ```ts
 * isDirtyState('编辑中');
 * ```
 */
export function isDirtyState(state: string): boolean {
    return state !== '已保存' && state !== '已加载';
}

/**
 * 渲染状态栏字数与目标。
 *
 * @param host - 状态栏宿主
 * @example
 * ```ts
 * renderStatusBar({ statusBar, wordCountDisplay, wordGoalDisplay, project, volume, chapterName, chapterNum, editorText, wordGoal });
 * ```
 */
export function renderStatusBar(host: StatusBarHost): void {
    if (!host.statusBar) return;
    const count = host.editorText.trim().length;
    host.statusBar.empty();
    host.statusBar.createSpan({
        text: formatStatusLine({
            project: host.project,
            volume: host.volume,
            chapterName: host.chapterName,
            chapterNum: host.chapterNum,
            wordCount: count,
        }),
    });
    host.wordCountDisplay?.setText(String(count));
    if (host.wordGoalDisplay) {
        const progress = computeWordGoalProgress(count, host.wordGoal);
        host.wordGoalDisplay.setText(`目标: ${host.wordGoal} · ${progress}%`);
    }
}

/**
 * 更新保存状态显示。
 *
 * @param display - 保存状态元素
 * @param state - 状态文本
 * @example
 * ```ts
 * updateSaveStateDisplay(display, '编辑中');
 * ```
 */
export function updateSaveStateDisplay(
    display: (HTMLElement & { setText(text: string): void; toggleClass(cls: string, value: boolean): void }) | null,
    state: string,
): void {
    if (!display) return;
    display.setText(state);
    display.toggleClass('is-dirty', isDirtyState(state));
}

/**
 * 渲染人工率仪表盘（精准模式关闭时显示占位）。
 *
 * @param host - 仪表盘宿主
 * @example
 * ```ts
 * renderHumanRatePanel({ container, precisionMode: true, editorText });
 * ```
 */
export function renderHumanRatePanel(host: HumanRateHost): void {
    if (!host.container) return;
    host.container.empty();
    if (!host.precisionMode) {
        host.container.createDiv({ cls: 'nw-hr-header' });
        host.container.createDiv({ cls: 'nw-hr-disabled', text: '精准模式未开启' });
        return;
    }
    renderHumanRate(host.container, calculateHumanRate(host.editorText));
}

/**
 * 更新人工率仪表盘。
 *
 * @param host - 仪表盘宿主
 * @example
 * ```ts
 * updateHumanRatePanel({ container, precisionMode: true, editorText });
 * ```
 */
export function updateHumanRatePanel(host: HumanRateHost): void {
    if (!host.container) return;
    if (!host.precisionMode) {
        renderHumanRatePanel(host);
        return;
    }
    renderHumanRate(host.container, calculateHumanRate(host.editorText));
}
