/**
 * layout-assembly.ts — 协同写作视图的布局装配
 *
 * 从 `ui/co-writing-view.ts` 抽出：顶栏装配、编辑器字体选择/Markdown 状态栏、
 * 布局设置回填与编辑区/建议区分隔条。DOM 装配集中在本模块，视图只注入回调；
 * 字体选项、布局状态、状态栏文案走纯函数导出，便于单元测试。
 */
import { SYSTEM_FONT_PRESETS } from '@/services/font-manager';
import { countParagraphs, describeContractShort } from '@/shared/novel-format';
import type { BodyFormatContract } from '@/shared/body-format';
import { buildMarkdownToolbar, type MarkdownToolbarHost } from './markdown-toolbar';
import { createPanelResizer } from '@/ui/panel-resizer';
import type { ModelQuickSwitcherHandle } from '@/ui/model-quick-switcher';

/** 外观与布局设置子集（键名与插件设置保持一致）。 */
export interface LayoutSettings {
    coWriteEditorFont?: string;
    coWriteLayout?: string;
    coWriteEditorWidthRatio?: number;
    coWriteSuggestionPanelVisible?: boolean;
}

/** 左侧预览区句柄。 */
export interface LeftPanelHandles {
    /** 本章简报摘要 */
    briefSummary: HTMLElement;
    /** 本章简报正文 */
    briefContent: HTMLElement;
    /** 正文预览 */
    previewContent: HTMLElement;
}

/**
 * 装配左侧预览区（本章简报 + 可折叠正文预览）。
 *
 * @param leftPanel - 左侧栏容器
 * @returns 简报与预览的句柄
 * @example
 * ```ts
 * const handles = renderLeftPanel(mainArea.createDiv({ cls: 'nw-cowrite-left' }));
 * ```
 */
export function renderLeftPanel(leftPanel: HTMLElement): LeftPanelHandles {
    // 本章简报：把上一步（Scene 展开/大纲/情绪/信息规划）的成果直接摆出来
    const briefSection = leftPanel.createDiv({ cls: 'nw-cowrite-brief' });
    briefSection.createDiv({ cls: 'nw-cowrite-brief-head' })
        .createSpan({ cls: 'nw-cowrite-brief-title', text: '📋 本章简报' });
    const briefSummary = briefSection.createDiv({ cls: 'nw-cowrite-brief-summary', text: '等待章节规划…' });
    const briefContent = briefSection.createDiv({ cls: 'nw-cowrite-brief-body' });
    const previewSection = leftPanel.createDiv({ cls: 'nw-cowrite-preview' });
    previewSection.createDiv({ cls: 'nw-cowrite-preview-label', text: '预览' });
    const previewContent = previewSection.createDiv({ cls: 'nw-cowrite-preview-content' });
    const previewToggle = previewSection.createDiv({ cls: 'nw-cowrite-preview-toggle' });
    previewToggle.createSpan({ text: '收起 ▲' });
    previewToggle.addEventListener('click', () => {
        leftPanel.toggleClass('nw-cowrite-left-collapsed', !leftPanel.hasClass('nw-cowrite-left-collapsed'));
        previewToggle.setText(leftPanel.hasClass('nw-cowrite-left-collapsed') ? '展开 ▼' : '收起 ▲');
    });
    return { briefSummary, briefContent, previewContent };
}

/**
 * 装配右侧 Tab 头并绑定切换回调。
 *
 * @param container - Tab 头部容器
 * @param tabs - Tab 元数据（id / 文案 / 可选提示 / 是否默认选中）
 * @param onSwitch - Tab 切换回调
 * @example
 * ```ts
 * renderTabHeaders(container, [{ id: 'overview', label: '📊 概览', active: true }], (id) => switchTab(id));
 * ```
 */
export function renderTabHeaders<T extends string>(
    container: HTMLElement,
    tabs: ReadonlyArray<{ id: T; label: string; title?: string; active?: boolean }>,
    onSwitch: (id: T) => void,
): void {
    for (const tab of tabs) {
        const el = container.createDiv({
            cls: `nw-cowrite-tab-header${tab.active ? ' is-active' : ''}`,
            text: tab.label,
            attr: tab.title ? { 'data-tab': tab.id, title: tab.title } : { 'data-tab': tab.id },
        });
        el.addEventListener('click', () => onSwitch(tab.id));
    }
}

/** 字体下拉选项。 */
export interface FontOption {
    /** 选项值（写入设置） */
    value: string;
    /** 展示文案 */
    label: string;
}

/** Markdown 状态栏句柄。 */
export interface MarkdownStatusHandles {
    /** 状态栏容器 */
    container: HTMLElement;
    /** 模式（固定 Markdown） */
    modeEl: HTMLElement;
    /** 格式契约摘要 */
    contractEl: HTMLElement;
    /** 字数 */
    wordsEl: HTMLElement;
    /** 段落数 */
    paragraphsEl: HTMLElement;
}

/** 顶栏装配回调。 */
export interface HeaderAssemblyOptions {
    /** 返回完整写作工作台 */
    openWriter: () => void;
    /** 打开知识库管理 */
    openKnowledge: () => void;
    /** 打开写作指纹库 */
    openFingerprintLibrary: () => void;
    /** 打开统一实体管理 */
    openEntityManager: () => void;
    /** 切换精准模式 */
    togglePrecisionMode: () => void;
    /** 刷新资源状态栏 */
    renderAssetStatus: () => void;
    /** 装配模型快速切换器 */
    renderModelSwitcher: (el: HTMLElement) => ModelQuickSwitcherHandle;
}

/** 顶栏装配产物。 */
export interface HeaderHandles {
    /** 章节上下文状态 */
    statusBar: HTMLElement;
    /** 模型快速切换器 */
    modelSwitcher: ModelQuickSwitcherHandle;
    /** 精准模式按钮 */
    precisionModeBtn: HTMLButtonElement;
    /** 资源状态栏 */
    assetStatusBar: HTMLElement;
}

/** 渲染布局后的状态。 */
export interface LayoutState {
    /** 上下堆叠（否则左右分栏） */
    stacked: boolean;
    /** 编辑区宽度百分比（CSS 变量值） */
    editorPercent: string;
    /** 建议面板是否收起 */
    panelCollapsed: boolean;
}

/** 字体选择器回调。 */
export interface FontPickerOptions {
    /** 设置里保存的字体值 */
    saved: string;
    /** 已登记的自定义字体族 */
    customFamilies: readonly string[];
    /** 打开自定义字体管理 */
    openManager: () => void;
    /** 选中字体（''=恢复主题默认） */
    onSelect: (value: string) => void;
}

/** 分隔条装配参数。 */
export interface PanelResizerOptions {
    /** 编辑区/建议区所在容器 */
    container: HTMLElement;
    /** 已插入到正确位置的分隔条节点 */
    element: HTMLElement;
    /** 初始比例（0-1） */
    ratio: number;
    /** 拖动结束回调（百分比数值） */
    onCommit: (percent: number) => void;
    /** 注册卸载清理 */
    registerCleanup: (fn: () => void) => void;
}

/** 自定义字体管理选项值（选中即弹管理面板，不写入设置）。 */
const FONT_MANAGE_VALUE = '__manage__';

/**
 * 解析字体下拉选项与当前选中值。
 *
 * 未知/已删除的字体值回落到「默认（跟随主题）」，与原生 select
 * 对不存在 value 的处理一致。
 *
 * @param saved - 设置里保存的字体值
 * @param customFamilies - 已登记的自定义字体族
 * @returns 选项列表与选中值
 * @example
 * ```ts
 * const { options, selected } = resolveFontOptions('', ['思源宋体']);
 * expect(options.some((o) => o.value === '"思源宋体", sans-serif')).toBe(true);
 * ```
 */
export function resolveFontOptions(
    saved: string,
    customFamilies: readonly string[],
): { options: FontOption[]; selected: string } {
    const options: FontOption[] = [
        { value: '', label: '默认（跟随主题）' },
        ...SYSTEM_FONT_PRESETS,
    ];
    for (const family of customFamilies) {
        options.push({ value: `"${family}", sans-serif`, label: `★ ${family}` });
    }
    options.push({ value: FONT_MANAGE_VALUE, label: '⚙️ 管理自定义字体…' });
    const selected = options.some((option) => option.value === saved) ? saved : '';
    return { options, selected };
}

/**
 * 解析布局设置（堆叠/宽度百分比/建议面板收起）。
 *
 * @param settings - 外观与布局设置子集
 * @returns 布局状态
 * @example
 * ```ts
 * expect(resolveLayoutState({ coWriteLayout: 'stacked' }).stacked).toBe(true);
 * ```
 */
export function resolveLayoutState(settings: LayoutSettings): LayoutState {
    const layout = settings.coWriteLayout || 'split';
    const ratio = settings.coWriteEditorWidthRatio || 0.65;
    const panelVisible = settings.coWriteSuggestionPanelVisible !== false;
    return {
        stacked: layout === 'stacked',
        editorPercent: `${Math.max(40, Math.min(85, ratio * 100))}%`,
        panelCollapsed: !panelVisible,
    };
}

/**
 * 生成 Markdown 状态栏文案。
 *
 * @param text - 编辑器正文
 * @param contract - 当前项目的正文格式契约
 * @returns 模式/契约/字数/段落四段文案
 * @example
 * ```ts
 * expect(formatMarkdownStatus('第一段\n\n第二段', DEFAULT_BODY_FORMAT).paragraphs).toBe('段落 2');
 * ```
 */
export function formatMarkdownStatus(
    text: string,
    contract: BodyFormatContract,
): { mode: string; contract: string; words: string; paragraphs: string } {
    return {
        mode: 'Markdown',
        contract: `格式：${describeContractShort(contract)}`,
        words: `字数 ${text.replace(/\s+/g, '').length}`,
        paragraphs: `段落 ${countParagraphs(text)}`,
    };
}

/**
 * 装配协同视图顶栏（导航 / 资源 / 模式三组入口）。
 *
 * @param header - 顶栏容器
 * @param options - 各入口回调
 * @returns 需要在视图上保留的句柄
 * @example
 * ```ts
 * const handles = renderHeader(header, { ... });
 * view.statusBar = handles.statusBar;
 * ```
 */
export function renderHeader(header: HTMLElement, options: HeaderAssemblyOptions): HeaderHandles {
    // 左区：返回 · 标题 · 章节上下文状态
    const headerLeft = header.createDiv({ cls: 'nw-cowrite-header-left' });
    const backBtn = headerLeft.createEl('button', {
        text: '← 工作台',
        cls: 'nw-float-monitor-toggle nw-cowrite-back-btn',
    });
    backBtn.setAttribute('title', '返回完整写作工作台');
    backBtn.addEventListener('click', () => options.openWriter());
    const titleDiv = headerLeft.createDiv({ cls: 'nw-cowrite-title' });
    titleDiv.createSpan({ cls: 'nw-cowrite-title-icon', text: '\u{1F4DD}' });
    titleDiv.createSpan({ text: '协同写作' });
    // 空态不再显示「加载中...」，改为准确的上下文状态（openChapter 成功后会由 refreshStatusBar 覆盖）
    const statusBar = headerLeft.createDiv({ cls: 'nw-cowrite-status', text: '未绑定章节' });

    // 中区：资源引用入口（知识库 → 指纹库 → 实体，按参考资料使用频率排序）
    const headerTools = header.createDiv({ cls: 'nw-cowrite-header-tools' });
    const kbBtn = headerTools.createEl('button', {
        text: '\u{1F4DA} 知识库管理',
        cls: 'nw-float-monitor-toggle nw-btn-knowledge',
    });
    kbBtn.setAttribute('title', '打开知识库管理视图');
    kbBtn.addEventListener('click', () => options.openKnowledge());
    const fpBtn = headerTools.createEl('button', { text: '🔍 指纹库', cls: 'nw-float-monitor-toggle' });
    fpBtn.setAttribute('title', '打开写作指纹库');
    fpBtn.addEventListener('click', () => options.openFingerprintLibrary());
    const entityBtn = headerTools.createEl('button', { text: '👥 实体', cls: 'nw-float-monitor-toggle' });
    entityBtn.setAttribute('title', '统一实体管理（人物/地点/势力/物品）');
    entityBtn.addEventListener('click', () => options.openEntityManager());

    // 右区：视图模式（精准模式）· 资源状态
    // v8.4: 取消原「⋯ 更多」下拉（与右侧「⚙ 更多工具」功能重复，且其全局 click 监听未随视图卸载）
    //       将「监控 / 分析」并入右侧工具面板，顶栏只保留导航、资源与模式三类入口
    const headerRight = header.createDiv({ cls: 'nw-cowrite-header-right' });
    // 2026-10-28: 原右下角状态栏浮窗移除后，模型快速切换装配到协同顶栏（四个主界面之一）。
    const modelSwitcher = options.renderModelSwitcher(headerRight);
    const precisionBtn = headerRight.createEl('button', {
        text: '\uD83C\uDFAF 精准模式',
        cls: 'nw-precision-mode-btn nw-float-monitor-toggle',
        attr: { title: '精准模式：逐句检索+风格评分+反AI检测' },
    });
    precisionBtn.addEventListener('click', () => options.togglePrecisionMode());

    const assetStatusBar = headerRight.createDiv({ cls: 'nw-asset-status-bar' });
    options.renderAssetStatus();

    return { statusBar, modelSwitcher, precisionModeBtn: precisionBtn, assetStatusBar };
}

/**
 * 装配字体选择器（默认/预设/自定义/管理入口）。
 *
 * @param wrap - 编辑器容器
 * @param options - 当前字体、自定义字体族与回调
 * @example
 * ```ts
 * renderFontPicker(wrap, { saved: '', customFamilies: [], openManager: () => {}, onSelect: () => {} });
 * ```
 */
export function renderFontPicker(wrap: HTMLElement, options: FontPickerOptions): void {
    const group = wrap.createDiv({ cls: 'nw-cowrite-md-group nw-cowrite-font-group' });
    group.createSpan({ cls: 'nw-cowrite-font-label', text: '字体' });
    const select = group.createEl('select', { cls: 'nw-cowrite-font-select' });
    const { options: items, selected } = resolveFontOptions(options.saved, options.customFamilies);
    for (const item of items) {
        select.createEl('option', { value: item.value, text: item.label });
    }
    select.value = selected;
    select.addEventListener('change', () => {
        const value = select.value;
        if (value === FONT_MANAGE_VALUE) {
            select.value = options.saved;
            options.openManager();
            return;
        }
        options.onSelect(value);
    });
}

/**
 * 应用编辑器字体到正文、幽灵建议层与预览层（空串=恢复主题默认）。
 *
 * @param targets - 需要同步字体的三层元素（可为空）
 * @param fontFamily - 字体族 CSS 值
 * @example
 * ```ts
 * applyEditorFont({ editor, ghost, preview }, '"Microsoft YaHei", sans-serif');
 * ```
 */
export function applyEditorFont(
    targets: { editor: HTMLElement | null; ghost: HTMLElement | null; preview: HTMLElement | null },
    fontFamily: string,
): void {
    const family = fontFamily || '';
    if (targets.editor) targets.editor.style.fontFamily = family;
    // 幽灵建议层与预览层同步，保持视觉一致
    if (targets.ghost) targets.ghost.style.fontFamily = family;
    if (targets.preview) targets.preview.style.fontFamily = family;
}

/**
 * 装配 Markdown 工具条（字体选择器 + 格式按钮）。
 *
 * @param wrap - 编辑器容器
 * @param fontOptions - 字体选择器参数
 * @param toolbarHost - 工具条宿主（编辑器访问与编辑回调）
 * @example
 * ```ts
 * renderMarkdownToolbar(wrap, { saved: '', customFamilies: [], openManager: () => {}, onSelect: () => {} }, host);
 * ```
 */
export function renderMarkdownToolbar(
    wrap: HTMLElement,
    fontOptions: FontPickerOptions,
    toolbarHost: MarkdownToolbarHost,
): void {
    renderFontPicker(wrap, fontOptions);
    buildMarkdownToolbar(wrap, toolbarHost);
}

/**
 * 装配编辑器底部 Markdown 状态栏。
 *
 * @param wrap - 编辑器容器
 * @returns 状态栏句柄
 * @example
 * ```ts
 * const handles = renderMarkdownStatus(wrap);
 * ```
 */
export function renderMarkdownStatus(wrap: HTMLElement): MarkdownStatusHandles {
    const status = wrap.createDiv({ cls: 'nw-cowrite-md-status' });
    const modeEl = status.createSpan({ cls: 'nw-cowrite-md-status-item', text: 'Markdown' });
    const contractEl = status.createSpan({ cls: 'nw-cowrite-md-status-item nw-cowrite-md-status-contract' });
    const wordsEl = status.createSpan({ cls: 'nw-cowrite-md-status-item' });
    const paragraphsEl = status.createSpan({ cls: 'nw-cowrite-md-status-item' });
    status.createSpan({ cls: 'nw-cowrite-md-status-hint', text: 'Ctrl+Alt+F 一键排版' });
    return { container: status, modeEl, contractEl, wordsEl, paragraphsEl };
}

/**
 * 刷新 Markdown 状态栏文案。
 *
 * @param handles - 状态栏句柄
 * @param text - 编辑器正文
 * @param contract - 当前项目的正文格式契约
 * @example
 * ```ts
 * refreshMarkdownStatus(handles, '正文', DEFAULT_BODY_FORMAT);
 * ```
 */
export function refreshMarkdownStatus(
    handles: MarkdownStatusHandles,
    text: string,
    contract: BodyFormatContract,
): void {
    const content = formatMarkdownStatus(text, contract);
    handles.modeEl.setText(content.mode);
    handles.contractEl.setText(content.contract);
    handles.wordsEl.setText(content.words);
    handles.paragraphsEl.setText(content.paragraphs);
}

/**
 * 按设置回填布局（堆叠/宽度/建议面板可见性）。
 *
 * @param centerPanel - 编辑区与建议区所在容器
 * @param settings - 外观与布局设置子集
 * @example
 * ```ts
 * applyLayoutFromSettings(centerPanel, { coWriteLayout: 'stacked' });
 * ```
 */
export function applyLayoutFromSettings(centerPanel: HTMLElement, settings: LayoutSettings): void {
    const state = resolveLayoutState(settings);
    centerPanel.toggleClass('is-stacked', state.stacked);
    centerPanel.style.setProperty('--nw-cowrite-editor-percent', state.editorPercent);
    centerPanel.toggleClass('is-panel-collapsed', state.panelCollapsed);
}

/**
 * 装配编辑区 / 建议区拖拽分隔条。
 *
 * 2026-10-29：改用统一原语 createPanelResizer（Pointer Events +
 * 键盘可达 + 双击复位），并复用已就位的节点以保持 DOM 顺序。
 * 比例仍存 coWriteEditorWidthRatio，写入 --nw-cowrite-editor-percent。
 *
 * @param options - 容器、分隔条节点、初始比例、提交与清理回调
 * @example
 * ```ts
 * attachPanelResizer({ container, element, ratio: 0.65, onCommit: () => {}, registerCleanup: (fn) => fn() });
 * ```
 */
export function attachPanelResizer(options: PanelResizerOptions): void {
    const resizer = createPanelResizer({
        container: options.container,
        element: options.element,
        target: options.container,
        orientation: 'horizontal',
        side: 'before',
        unit: 'percent',
        cssVar: '--nw-cowrite-editor-percent',
        min: 40,
        max: 85,
        step: 2,
        value: Math.round(options.ratio * 100),
        defaultValue: 65,
        ariaLabel: '拖动调整编辑区宽度（方向键微调，双击复位）',
        onCommit: options.onCommit,
    });
    options.registerCleanup(() => resizer.destroy());
}
