/**
 * control-panel.ts — 协同写作视图的右栏与控制台装配
 *
 * 从 `ui/co-writing-view.ts` 抽出：右栏页签（概览 / 知识库）、概览卡片、
 * 写作控制台（临时指令、核心创作 / 辅助润色 / 更多工具三组按钮）、
 * 监控卡挂载点。DOM 装配集中在本模块，视图只注入回调；
 * 按钮文案、页签定义、场景提示词走纯函数导出，便于单元测试。
 */
import { withButtonBusy } from '@/ui/button-busy';
import { t } from '@/i18n';
import { renderTabHeaders } from '@/ui/co-writing/layout-assembly';

/** 工具按钮的悬浮说明（E-12：图标/短文案不足以说明用途） */
const TOOL_BUTTON_HINTS: Record<ControlToolAction, string> = {
    history: t('cowrite.panel.tipHistory'),
    memory: t('cowrite.panel.tipMemory'),
    'batch-import': t('cowrite.panel.tipBatchImport'),
    monitor: t('cowrite.panel.tipMonitor'),
    analysis: t('cowrite.panel.tipAnalysis'),
    guard: t('cowrite.panel.tipGuard'),
    quality: t('cowrite.panel.tipQuality'),
    save: t('cowrite.panel.tipSave'),
    written: t('cowrite.panel.tipWritten'),
};

/** 右栏页签定义。 */
export interface RightTabSpec {
    id: 'overview' | 'knowledge';
    label: string;
    title?: string;
    active?: boolean;
}

/**
 * 右栏页签（顺序即渲染顺序，概览默认激活）。
 *
 * @returns 概览与知识库两个页签定义
 */
export function getRightTabSpecs(): RightTabSpec[] {
    return [
        { id: 'overview', label: t('cowrite.panel.tabOverview'), active: true },
        { id: 'knowledge', label: t('cowrite.panel.tabKnowledge'), title: t('cowrite.panel.tabKnowledgeTitle') },
    ];
}

/** 「更多工具」面板的动作标识。 */
export type ControlToolAction =
    | 'history'
    | 'memory'
    | 'batch-import'
    | 'monitor'
    | 'analysis'
    | 'guard'
    | 'quality'
    | 'save'
    | 'written';

/** 「更多工具」按钮定义。 */
export interface ToolButtonSpec {
    text: string;
    action: ControlToolAction;
}

/**
 * 「更多工具」按钮（顺序即展示顺序）。
 *
 * @returns 九个工具按钮的文案与动作
 */
export function getToolButtonSpecs(): ToolButtonSpec[] {
    return [
        { text: t('cowrite.panel.btnHistory'), action: 'history' },
        { text: t('cowrite.panel.btnMemory'), action: 'memory' },
        { text: t('cowrite.panel.btnBatchImport'), action: 'batch-import' },
        { text: t('cowrite.panel.btnMonitor'), action: 'monitor' },
        { text: t('cowrite.panel.btnAnalysis'), action: 'analysis' },
        { text: t('cowrite.panel.btnGuard'), action: 'guard' },
        { text: t('cowrite.panel.btnQuality'), action: 'quality' },
        { text: t('cowrite.panel.btnSave'), action: 'save' },
        { text: t('cowrite.panel.btnWritten'), action: 'written' },
    ];
}

/**
 * 控制台动作分组标题（顺序即展示顺序）。
 *
 * @returns 核心创作 / 辅助润色 / 更多工具三组标题
 */
export function getControlSectionTitles(): { core: string; assist: string; tools: string } {
    return { core: t('cowrite.panel.groupCore'), assist: t('cowrite.panel.groupAssist'), tools: t('cowrite.panel.groupTools') };
}

/**
 * 「更多工具」开关文案：展开态显示收起。
 *
 * @param open - 面板当前是否展开
 * @returns 开关按钮文案
 */
export function getToolsToggleLabel(open: boolean): string {
    return open ? t('cowrite.panel.toolsCollapse') : t('cowrite.panel.groupTools');
}

/**
 * 点击开关后的状态与文案。
 *
 * @param currentlyOpen - 点击前的展开状态
 * @returns 反转后的展开状态与按钮文案
 */
export function getToolsToggleState(currentlyOpen: boolean): { open: boolean; label: string } {
    const open = !currentlyOpen;
    return { open, label: getToolsToggleLabel(open) };
}

/**
 * 「场景描写」临时指令：锁定只写环境与身体感受的边界。
 *
 * @returns 可直接写入临时指令框的提示词
 * @example
 * ```ts
 * const hint = getSceneHintText();
 * ```
 */
export function getSceneHintText(): string {
    return '场景描写：必须使用当前场景卡的地点、时间、sensory_hook 与 body_reaction；'
        + '只写环境与身体感受，不推进剧情、不写对白、不引入新地点。';
}

/** 模型切换按钮所需的设置子集（键名与插件设置保持一致）。 */
export interface ModelToggleSettings {
    coWriteModelMode?: string;
    coWriteCloudProvider?: string;
    customProviders?: Array<{ id: string; name?: string }>;
}

/**
 * 解析模型切换按钮文案。
 *
 * @param settings - 模型相关设置子集
 * @returns 云端显示 provider 名，本地显示「🖥 本地」
 * @example
 * ```ts
 * resolveModelToggleLabel({ coWriteModelMode: 'local' }); // '🖥 本地'
 * ```
 */
export function resolveModelToggleLabel(settings: ModelToggleSettings): string {
    if ((settings.coWriteModelMode || 'local') !== 'cloud') return t('cowrite.panel.modelLocal');
    const providerId = settings.coWriteCloudProvider || '';
    if (!providerId) return t('cowrite.panel.modelUnset');
    const providerName = settings.customProviders?.find((p) => p.id === providerId)?.name || providerId;
    return `☁ ${providerName}`;
}

/** 控制台装配时由视图注入的回调。 */
export interface ControlPanelHost {
    /** 切换右栏页签 */
    switchRightTab: (tab: 'overview' | 'knowledge') => void;
    /** 本地/云端模型切换 */
    handleModelToggle: () => void;
    /** 推进下一剧情节点 */
    handleAdvanceNextNode: () => void;
    /** 生成续写建议 */
    handleTabSuggest: () => void;
    /** 结算本章 */
    handleComplete: () => void;
    /** 联想后续走向 */
    handleAssociationSuggest: () => void;
    /** 扩写选中段落 */
    handleOutlineExpand: () => void;
    /** 改写选中段落 */
    handleRewriteSelection: () => void;
    /** 执行「更多工具」中的某项 */
    runToolAction: (action: ControlToolAction) => void;
    /** 写入场景描写临时指令（视图侧同步 cursorHint 与 facade） */
    applySceneHint: (hint: string) => void;
    /** 刷新模型切换按钮文案 */
    updateModelToggleBtn: () => void;
    /** 渲染监控卡 */
    renderMonitorPanel: () => void;
    /** 注册文档级点击（点击面板外收起工具面板） */
    registerDocumentClick: (handler: () => void) => void;
}

/** 控制台装配产出的元素句柄。 */
export interface ControlPanelHandles {
    rightTabContainer: HTMLElement;
    rightTabHeaders: HTMLElement;
    rightTabContents: HTMLElement;
    overviewTabContent: HTMLElement;
    knowledgeTabContent: HTMLElement;
    metricsContainer: HTMLElement;
    tractionContainer: HTMLElement;
    wordCountDisplay: HTMLElement;
    wordGoalDisplay: HTMLElement;
    hintStateDisplay: HTMLElement;
    saveStateDisplay: HTMLElement;
    /** 临时指令输入（多行；Shift+Enter 换行，Enter 应用） */
    hintInput: HTMLTextAreaElement;
    modelToggleBtn: HTMLButtonElement;
    nextNodeBtn: HTMLButtonElement;
    suggestBtn: HTMLButtonElement;
    warningContainer: HTMLElement;
    monitorContainer: HTMLElement;
}

/**
 * 装配右栏（页签 + 概览卡片 + 写作控制台 + 监控挂载点）。
 *
 * @param rightPanel - 右栏容器
 * @param host - 视图注入的回调
 * @returns 视图后续需要读写的元素句柄
 * @example
 * ```ts
 * const handles = renderControlPanelAssembly(mainArea.createDiv({ cls: 'nw-cowrite-right' }), host);
 * ```
 */
export function renderControlPanelAssembly(
    rightPanel: HTMLElement,
    host: ControlPanelHost,
): ControlPanelHandles {
    const titles = getControlSectionTitles();
    const rightTabContainer = rightPanel.createDiv({ cls: 'nw-cowrite-right-tabs' });

    const rightTabHeaders = rightTabContainer.createDiv({ cls: 'nw-cowrite-tab-headers' });
    renderTabHeaders(rightTabHeaders, getRightTabSpecs(), (id) => host.switchRightTab(id));

    const rightTabContents = rightTabContainer.createDiv({ cls: 'nw-cowrite-tab-contents' });

    const overviewTabContent = rightTabContents.createDiv({
        cls: 'nw-cowrite-tab-content is-active',
        attr: { 'data-tab': 'overview' },
    });

    const cardsArea = overviewTabContent.createDiv({ cls: 'nw-cowrite-cards' });
    const completionCard = cardsArea.createDiv({ cls: 'nw-card' });
    completionCard.createDiv({ cls: 'nw-card-title', text: t('cowrite.monitor.completion') });
    completionCard.createDiv({ cls: 'nw-card-value', text: '0%' });
    const completionProgress = completionCard.createDiv({ cls: 'nw-progress' });
    completionProgress.createDiv({ cls: 'nw-progress-fill nw-progress-fill-zero' });

    const tractionCard = cardsArea.createDiv({ cls: 'nw-card' });
    tractionCard.createDiv({ cls: 'nw-card-title', text: t('cowrite.monitor.traction') });
    tractionCard.createDiv({ cls: 'nw-card-value', text: '45%' });
    tractionCard.createDiv({ cls: 'nw-card-sub', text: t('cowrite.monitor.riskLow') });

    const wordCard = cardsArea.createDiv({ cls: 'nw-card nw-cowrite-word-card' });
    wordCard.createDiv({ cls: 'nw-card-title', text: t('cowrite.monitor.words') });
    const wordCountDisplay = wordCard.createDiv({ cls: 'nw-card-value', text: '0' });
    const wordGoalDisplay = wordCard.createDiv({ cls: 'nw-card-sub', text: t('cowrite.monitor.goalPlaceholder') });

    // 写作控制台（紧凑模式）
    const controlPanel = overviewTabContent.createDiv({ cls: 'nw-cowrite-control-panel' });
    const controlHead = controlPanel.createDiv({ cls: 'nw-cowrite-control-head' });
    controlHead.createDiv({ cls: 'nw-cowrite-control-title', text: t('cowrite.panel.controlTitle') });
    // NBI-04: 临时指令「已应用」状态标识，默认隐藏
    const hintStateDisplay = controlHead.createDiv({ cls: 'nw-hint-state', text: t('cowrite.panel.hintApplied') });
    hintStateDisplay.addClass('nw-u-d-none');
    const saveStateDisplay = controlHead.createDiv({ cls: 'nw-cowrite-control-state', text: t('cowrite.panel.unsaved') });

    // textarea：支持自然换行；Enter 应用，Shift+Enter 换行（见视图 keydown）
    const hintInput = controlPanel.createEl('textarea', {
        cls: 'nw-hint-input',
        placeholder: t('cowrite.panel.hintPlaceholder'),
        attr: { rows: '2' },
    });

    // 按钮竖向 3 分组（核心创作 / 辅助润色 / 更多工具），每按钮带说明 tooltip
    const actionsArea = controlPanel.createDiv({ cls: 'nw-cowrite-actions-area' });

    // 模式切换（顶部独立一行）
    const modeRow = actionsArea.createDiv({ cls: 'nw-cowrite-action-row' });
    const modelToggleBtn = modeRow.createEl('button', {
        text: t('cowrite.panel.modelLocalBtn'),
        cls: 'nw-btn nw-btn-ghost',
        attr: { title: t('cowrite.panel.modelToggleTip') },
    });
    modelToggleBtn.addEventListener('click', () => host.handleModelToggle());

    // —— 核心创作 ——
    const coreSection = actionsArea.createDiv({ cls: 'nw-cowrite-action-section' });
    coreSection.createDiv({ cls: 'nw-cowrite-action-section-title', text: titles.core });
    const coreRow = coreSection.createDiv({ cls: 'nw-cowrite-action-row' });
    const nextNodeBtn = coreRow.createEl('button', {
        text: t('cowrite.panel.nodeIdle'),
        cls: 'nw-btn nw-btn-primary',
        attr: { title: t('cowrite.panel.nodeTip') },
    });
    nextNodeBtn.addEventListener('click', () => {
        void withButtonBusy(nextNodeBtn, t('cowrite.busyAdvancing'), () => host.handleAdvanceNextNode());
    });
    const suggestBtn = coreRow.createEl('button', {
        text: t('cowrite.panel.suggestBtn'),
        cls: 'nw-btn nw-btn-primary',
        attr: { title: t('cowrite.panel.suggestTip') },
    });
    suggestBtn.addEventListener('click', () => host.handleTabSuggest());
    const sceneBtn = coreRow.createEl('button', {
        text: t('cowrite.panel.sceneBtn'),
        cls: 'nw-btn nw-btn-ghost',
        attr: { title: t('cowrite.panel.sceneTip') },
    });
    sceneBtn.addEventListener('click', () => {
        host.applySceneHint(getSceneHintText());
        host.handleTabSuggest();
    });
    const completeBtn = coreRow.createEl('button', {
        text: t('cowrite.panel.settleBtn'),
        cls: 'nw-btn nw-btn-primary',
        attr: { title: t('cowrite.panel.settleTip') },
    });
    completeBtn.addEventListener('click', () => {
        void withButtonBusy(completeBtn, t('cowrite.busySettling'), () => host.handleComplete());
    });

    // —— 辅助润色 ——
    const assistSection = actionsArea.createDiv({ cls: 'nw-cowrite-action-section' });
    assistSection.createDiv({ cls: 'nw-cowrite-action-section-title', text: titles.assist });
    const assistRow = assistSection.createDiv({ cls: 'nw-cowrite-action-row' });
    const assocBtn = assistRow.createEl('button', { text: t('cowrite.panel.assocBtn'), cls: 'nw-btn nw-btn-ghost', attr: { title: t('cowrite.panel.assocTip') } });
    assocBtn.addEventListener('click', () => {
        void withButtonBusy(assocBtn, t('cowrite.busyAssociating'), () => host.handleAssociationSuggest());
    });
    const expandBtn = assistRow.createEl('button', { text: t('cowrite.panel.expandBtn'), cls: 'nw-btn nw-btn-ghost', attr: { title: t('cowrite.panel.expandTip') } });
    expandBtn.addEventListener('click', () => {
        void withButtonBusy(expandBtn, t('cowrite.busyExpanding'), () => host.handleOutlineExpand());
    });
    const rewriteBtn = assistRow.createEl('button', { text: t('cowrite.panel.rewriteBtn'), cls: 'nw-btn nw-btn-ghost', attr: { title: t('cowrite.panel.rewriteTip') } });
    rewriteBtn.addEventListener('click', () => {
        void withButtonBusy(rewriteBtn, t('cowrite.busyRewriting'), () => host.handleRewriteSelection());
    });

    // —— 更多工具（可折叠）——
    const toolsSection = actionsArea.createDiv({ cls: 'nw-cowrite-action-section' });
    const toolsToggle = toolsSection.createEl('button', {
        text: getToolsToggleLabel(false),
        cls: 'nw-btn nw-btn-ghost nw-cowrite-tools-toggle',
    });
    const toolsPanel = toolsSection.createDiv({ cls: 'nw-cowrite-tools-panel nw-cowrite-tools-panel-inline' });

    for (const spec of getToolButtonSpecs()) {
        // E-12：这些按钮只有图标+短名，补 title 说明用途
        const el = toolsPanel.createEl('button', {
            text: spec.text,
            cls: 'nw-btn nw-btn-ghost nw-cowrite-tool-btn',
            attr: { title: TOOL_BUTTON_HINTS[spec.action] ?? spec.text },
        });
        el.addEventListener('click', () => {
            toolsPanel.removeClass('is-open');
            toolsToggle.setText(getToolsToggleLabel(false));
            void withButtonBusy(el, t('cowrite.busyProcessing'), () => host.runToolAction(spec.action));
        });
    }

    // 用 class 驱动显隐（不再依赖内联 style，避免与全局点击监听/闭包引用冲突）
    toolsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = toolsToggle.parentElement?.querySelector('.nw-cowrite-tools-panel');
        if (!panel) return;
        const state = getToolsToggleState(panel.hasClass('is-open'));
        panel.toggleClass('is-open', state.open);
        toolsToggle.setText(state.label);
    });
    // 点击面板外收起（幂等：查询 DOM 当前状态，不依赖闭包引用）
    host.registerDocumentClick(() => {
        rightPanel.querySelectorAll('.nw-cowrite-tools-panel.is-open').forEach((p) => {
            p.removeClass('is-open');
            const t = p.parentElement?.querySelector('.nw-cowrite-tools-toggle');
            if (t) t.setText(getToolsToggleLabel(false));
        });
    });

    host.updateModelToggleBtn();

    const warningContainer = controlPanel.createDiv({ cls: 'nw-warnings' });
    const monitorContainer = controlPanel.createDiv({ cls: 'nw-cowrite-monitor-panel' });
    host.renderMonitorPanel();

    // Tab 2: 知识库
    const knowledgeTabContent = rightTabContents.createDiv({
        cls: 'nw-cowrite-tab-content',
        attr: { 'data-tab': 'knowledge' },
    });

    return {
        rightTabContainer,
        rightTabHeaders,
        rightTabContents,
        overviewTabContent,
        knowledgeTabContent,
        metricsContainer: completionCard,
        tractionContainer: tractionCard,
        wordCountDisplay,
        wordGoalDisplay,
        hintStateDisplay,
        saveStateDisplay,
        hintInput,
        modelToggleBtn,
        nextNodeBtn,
        suggestBtn,
        warningContainer,
        monitorContainer,
    };
}
