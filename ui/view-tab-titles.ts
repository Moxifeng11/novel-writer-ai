/**
 * 视图页签标题（2026-11-20 真实点击验收补充）
 *
 * 背景：Obsidian 1.7.2+ 会把后台页签做成 DeferredView，`getDisplayText()` 此时返回
 * 视图类型 id 而不是中文名；工作区保存布局时把这个 id 写进 workspace.json，
 * 于是重启后所有「上次没被激活」的插件页签都显示成 `novel-writer-knowledge-base`
 * 这样的原始 id，必须手点一次才会变回中文。
 *
 * 这里给出「视图类型 → 显示名」的单一映射，供启动期补写页签标题使用：
 * 只改页签文字，不触发视图实例化（不加载视图，避免拖慢启动）。
 * 各视图类里的 getDisplayText() 保持原样，是这条映射的真源，改动时两边同步。
 */
import { t } from '@/i18n';

/** 插件自有视图的页签标题；键是 setViewState 使用的视图类型 id */
const VIEW_TAB_TITLES: Record<string, () => string> = {
    'novel-writer-home': () => t('home.viewTitle'),
    'novel-writer-full-writer': () => t('fullwriter.viewTitle'),
    'novel-writer-co-writing': () => t('cowrite.view.title'),
    'novel-writer-knowledge-base': () => t('knowledgebase.view.title'),
    'novel-writer-agent-workbench': () => t('agentWorkbench.title'),
    'novel-writer-writing-fingerprint': () => t('fingerprint.view.title'),
    'novel-writer-project-side-panel': () => t('shellView.sidePanel'),
    'novel-writer-planning-canvas': () => t('shellView.planning'),
    'novel-writer-memory-graph': () => t('shellView.memoryGraph'),
    // 分离式监控面板（DraggablePanel，标题来自 panelTitle）
    'nw-float-monitor-a': () => t('monitorA.viewTitle'),
    'nw-float-monitor-b': () => t('monitorB.viewTitle'),
};

/**
 * 取视图类型的页签显示名。
 * @param viewType - setViewState 使用的视图类型 id
 * @returns 显示名；不是插件自有视图时返回 null
 */
export function pluginViewTabTitle(viewType: string): string | null {
    const make = VIEW_TAB_TITLES[viewType];
    return make ? make() : null;
}

/**
 * 全部可补写的视图类型（测试与排查用）。
 * @returns 视图类型 id 数组
 */
export function pluginViewTypes(): string[] {
    return Object.keys(VIEW_TAB_TITLES);
}
