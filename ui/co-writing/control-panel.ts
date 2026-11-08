/**
 * control-panel.ts — 协同写作视图的右栏与控制台装配
 *
 * 从 `ui/co-writing-view.ts` 抽出：右栏页签（概览 / 知识库）、概览卡片、
 * 写作控制台（临时指令、核心创作 / 辅助润色 / 更多工具三组按钮）、
 * 监控卡挂载点。DOM 装配集中在本模块，视图只注入回调；
 * 按钮文案、页签定义、场景提示词走纯函数导出，便于单元测试。
 */
import { withButtonBusy } from '@/ui/button-busy';
import { renderTabHeaders } from '@/ui/co-writing/layout-assembly';

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
        { id: 'overview', label: '📊 概览', active: true },
        { id: 'knowledge', label: '📚 知识库', title: '内嵌知识库面板：检索与引用' },
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
        { text: '🕘 历史', action: 'history' },
        { text: '🧠 记忆', action: 'memory' },
        { text: '📥 批量导入', action: 'batch-import' },
        { text: '📊 监控', action: 'monitor' },
        { text: '🔬 分析', action: 'analysis' },
        { text: '🛡 检查', action: 'guard' },
        { text: '📋 质检', action: 'quality' },
        { text: '💾 保存', action: 'save' },
        { text: '✅ 标记完稿', action: 'written' },
    ];
}

/**
 * 控制台动作分组标题（顺序即展示顺序）。
 *
 * @returns 核心创作 / 辅助润色 / 更多工具三组标题
 */
export function getControlSectionTitles(): { core: string; assist: string; tools: string } {
    return { core: '🎯 核心创作', assist: '✨ 辅助润色', tools: '⚙ 更多工具' };
}

/**
 * 「更多工具」开关文案：展开态显示收起。
 *
 * @param open - 面板当前是否展开
 * @returns 开关按钮文案
 */
export function getToolsToggleLabel(open: boolean): string {
    return open ? '⚙ 收起工具' : '⚙ 更多工具';
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
    if ((settings.coWriteModelMode || 'local') !== 'cloud') return '🖥 本地';
    const providerId = settings.coWriteCloudProvider || '';
    if (!providerId) return '☁ 未配置';
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
    hintInput: HTMLInputElement;
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
    completionCard.createDiv({ cls: 'nw-card-title', text: '完成度' });
    completionCard.createDiv({ cls: 'nw-card-value', text: '0%' });
    const completionProgress = completionCard.createDiv({ cls: 'nw-progress' });
    completionProgress.createDiv({ cls: 'nw-progress-fill nw-progress-fill-zero' });

    const tractionCard = cardsArea.createDiv({ cls: 'nw-card' });
    tractionCard.createDiv({ cls: 'nw-card-title', text: '情节牵引' });
    tractionCard.createDiv({ cls: 'nw-card-value', text: '45%' });
    tractionCard.createDiv({ cls: 'nw-card-sub', text: '偏离风险: 低' });

    const wordCard = cardsArea.createDiv({ cls: 'nw-card nw-cowrite-word-card' });
    wordCard.createDiv({ cls: 'nw-card-title', text: '字数' });
    const wordCountDisplay = wordCard.createDiv({ cls: 'nw-card-value', text: '0' });
    const wordGoalDisplay = wordCard.createDiv({ cls: 'nw-card-sub', text: '目标: 3000' });

    // 写作控制台（紧凑模式）
    const controlPanel = overviewTabContent.createDiv({ cls: 'nw-cowrite-control-panel' });
    const controlHead = controlPanel.createDiv({ cls: 'nw-cowrite-control-head' });
    controlHead.createDiv({ cls: 'nw-cowrite-control-title', text: '控制台' });
    // NBI-04: 临时指令「已应用」状态标识，默认隐藏
    const hintStateDisplay = controlHead.createDiv({ cls: 'nw-hint-state', text: '指令已应用' });
    hintStateDisplay.addClass('nw-u-d-none');
    const saveStateDisplay = controlHead.createDiv({ cls: 'nw-cowrite-control-state', text: '未保存' });

    const hintInput = controlPanel.createEl('input', {
        type: 'text',
        cls: 'nw-hint-input',
        placeholder: '临时指令 / 方向（Enter 应用）',
    });

    // 按钮竖向 3 分组（核心创作 / 辅助润色 / 更多工具），每按钮带说明 tooltip
    const actionsArea = controlPanel.createDiv({ cls: 'nw-cowrite-actions-area' });

    // 模式切换（顶部独立一行）
    const modeRow = actionsArea.createDiv({ cls: 'nw-cowrite-action-row' });
    const modelToggleBtn = modeRow.createEl('button', {
        text: '🖥 本地',
        cls: 'nw-btn nw-btn-ghost',
        attr: { title: '切换本地/云端模型' },
    });
    modelToggleBtn.addEventListener('click', () => host.handleModelToggle());

    // —— 核心创作 ——
    const coreSection = actionsArea.createDiv({ cls: 'nw-cowrite-action-section' });
    coreSection.createDiv({ cls: 'nw-cowrite-action-section-title', text: titles.core });
    const coreRow = coreSection.createDiv({ cls: 'nw-cowrite-action-row' });
    const nextNodeBtn = coreRow.createEl('button', {
        text: '⏭ 节点 -/-',
        cls: 'nw-btn nw-btn-primary',
        attr: { title: '推进到下一剧情节点，生成针对性建议' },
    });
    nextNodeBtn.addEventListener('click', () => {
        void withButtonBusy(nextNodeBtn, '⏳ 推进中...', () => host.handleAdvanceNextNode());
    });
    const suggestBtn = coreRow.createEl('button', {
        text: '\u21E5 建议',
        cls: 'nw-btn nw-btn-primary',
        attr: { title: '基于上文生成续写建议（方向可在上方临时指令填写）' },
    });
    suggestBtn.addEventListener('click', () => host.handleTabSuggest());
    const sceneBtn = coreRow.createEl('button', {
        text: '🎬 场景描写',
        cls: 'nw-btn nw-btn-ghost',
        attr: { title: '用当前 Scene 卡的地点/时间/感官钩子生成环境描写，不推进剧情' },
    });
    sceneBtn.addEventListener('click', () => {
        host.applySceneHint(getSceneHintText());
        host.handleTabSuggest();
    });
    const completeBtn = coreRow.createEl('button', {
        text: '📊 结算',
        cls: 'nw-btn nw-btn-primary',
        attr: { title: '结算本章：更新事实/伏笔/时间线' },
    });
    completeBtn.addEventListener('click', () => {
        void withButtonBusy(completeBtn, '⏳ 结算中...', () => host.handleComplete());
    });

    // —— 辅助润色 ——
    const assistSection = actionsArea.createDiv({ cls: 'nw-cowrite-action-section' });
    assistSection.createDiv({ cls: 'nw-cowrite-action-section-title', text: titles.assist });
    const assistRow = assistSection.createDiv({ cls: 'nw-cowrite-action-row' });
    const assocBtn = assistRow.createEl('button', { text: '✨ 联想', cls: 'nw-btn nw-btn-ghost', attr: { title: '联想后续情节走向' } });
    assocBtn.addEventListener('click', () => {
        void withButtonBusy(assocBtn, '⏳ 联想中...', () => host.handleAssociationSuggest());
    });
    const expandBtn = assistRow.createEl('button', { text: '✍️ 扩写', cls: 'nw-btn nw-btn-ghost', attr: { title: '扩写选中段落' } });
    expandBtn.addEventListener('click', () => {
        void withButtonBusy(expandBtn, '⏳ 扩写中...', () => host.handleOutlineExpand());
    });
    const rewriteBtn = assistRow.createEl('button', { text: '✂ 改写', cls: 'nw-btn nw-btn-ghost', attr: { title: '改写选中段落（降 AI 痕迹 / 换文风）' } });
    rewriteBtn.addEventListener('click', () => {
        void withButtonBusy(rewriteBtn, '⏳ 改写中...', () => host.handleRewriteSelection());
    });

    // —— 更多工具（可折叠）——
    const toolsSection = actionsArea.createDiv({ cls: 'nw-cowrite-action-section' });
    const toolsToggle = toolsSection.createEl('button', {
        text: getToolsToggleLabel(false),
        cls: 'nw-btn nw-btn-ghost nw-cowrite-tools-toggle',
    });
    const toolsPanel = toolsSection.createDiv({ cls: 'nw-cowrite-tools-panel nw-cowrite-tools-panel-inline' });

    for (const spec of getToolButtonSpecs()) {
        const el = toolsPanel.createEl('button', { text: spec.text, cls: 'nw-btn nw-btn-ghost' });
        el.addEventListener('click', () => {
            toolsPanel.removeClass('is-open');
            toolsToggle.setText(getToolsToggleLabel(false));
            void withButtonBusy(el, '⏳ 处理中...', () => host.runToolAction(spec.action));
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
