/**
 * agent-workbench-view.ts — Agent 创作工作台（交互方式革命的主载体）
 *
 * 参考 dsh Web 工作台三栏布局：
 *   左栏  两级项目分类：长篇小说/短篇小说/剧本 三个类型分组（可折叠）→ 类型下项目卡；
 *         创作阶段链与界面直达在其后。
 *   中栏  对话区：固定高度消息区（内滚不撑高界面）、工具调用时间线内嵌、
 *         底部输入条 = 项目切换 chip + 模型选择徽章（两级弹层）+ 输入 + ↑发送。
 *   右栏  文件面板：活动项目的文件树（目录展开/折叠，文件点击预览）+ 文件预览区；
 *         会话遥测与记忆槽位折叠在底部。
 *
 * 双引擎：有凭据走 AI Harness（模型+工具），无凭据/失败一键降级规则引擎。
 */
import { ItemView, MarkdownRenderer, Menu, Notice, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import NovelWriterPlugin from '../main';
import { applyNwScope } from '../utils/helpers';
import { createPanelResizer, type PanelResizerHandle } from './panel-resizer';
import { GuideAgentEngine } from '../engine/agent/conversation-engine';
import { AgentHarnessEngine, type HarnessTelemetry } from '../engine/agent/harness/harness-engine';
import { createCallAIAdapter } from '../engine/agent/harness/agent-adapter';
import type { AgentChip, AgentIntent, AgentMessage, AgentTurnResult, GuideAgentPort } from '../engine/agent/agent-types';
import type { HarnessTurnOutcome } from '../engine/agent/harness/harness-types';
import { createAgentPort, getAgentContext } from './services/agent-port';
import { listProjects } from './export-manuscript-modal';
import type { CreationMode } from '../shared/creation-mode';
import { resolveProjectMode as resolveModeFromShared } from '../shared/project-mode';
import { openModelPickerPopover, formatWorkbenchModelBadge, closeExistingPopovers } from './model-picker-popover';
import { VIEW_TYPE_AGENT_WORKBENCH } from '../shared/view-types';
import { classifyPreviewKind } from '../shared/preview-kind';

const STAGES: Array<{ key: string; label: string; hint: string }> = [
    { key: 'create', label: '① 新建项目', hint: '长篇/短篇/剧本' },
    { key: 'research', label: '② 前期调研', hint: '短篇分类/剧本定位' },
    { key: 'setting', label: '③ 世界观与设定', hint: '结构/角色/实体' },
    { key: 'outline', label: '④ 大纲与规划', hint: '分卷/章节/信息规划' },
    { key: 'body', label: '⑤ 章节正文', hint: '一键成文/协同写作' },
    { key: 'quality', label: '⑥ 质检修订', hint: '质检/消痕/定向修订' },
    { key: 'settle', label: '⑦ 章节结算', hint: '状态/实体/记忆' },
    { key: 'export', label: '⑧ 导出成稿', hint: 'TXT/DOCX/发布格式' },
];

const TYPE_SECTIONS: Array<{ mode: CreationMode; label: string }> = [
    { mode: 'long', label: '长篇小说' },
    { mode: 'short', label: '短篇小说' },
    { mode: 'script', label: '剧本' },
];

const MODE_LIBRARY_ROOTS = ['长篇小说', '短篇小说', '剧本'];

export class AgentWorkbenchView extends ItemView {
    private readonly plugin: NovelWriterPlugin;
    private harnessEngine: AgentHarnessEngine | null = null;
    private ruleEngine: GuideAgentEngine | null = null;
    private port: GuideAgentPort;
    private busy = false;
    /** 当前聚焦项目（文件树/项目卡高亮/项目 chip 用） */
    private activeProject = '';
    /** 项目 → 创作类型缓存 */
    private projectTypeCache = new Map<string, CreationMode>();
    /** 文件树展开的目录集合 */
    private expandedDirs = new Set<string>();
    /** 左栏类型分组折叠态（重渲染后恢复；旧实现存在闭包 class 上，每回合被重置） */
    private collapsedGroups = new Set<string>();
    /** 预览中的文件路径 */
    private previewedPath = '';
    /** 预览代次：快速点两个文件时，先发起后返回的读取不能覆盖后点文件 */
    private previewSeq = 0;
    /** 会话代次：restart/onClose 后旧回合的回调不得写进新会话 */
    private sessionSeq = 0;
    /** 当前会话的中止器（关闭/重启时取消在途回合与工具） */
    private turnAbort: AbortController | null = null;
    /** 上一条用户消息（供「重试」重放；不把控制令牌写进历史） */
    private lastUserText = '';

    private messagesEl: HTMLElement | null = null;
    private chipsEl: HTMLElement | null = null;
    private inputEl: HTMLInputElement | null = null;
    private projectListEl: HTMLElement | null = null;
    private projectChipEl: HTMLElement | null = null;
    private modelBadgeEl: HTMLButtonElement | null = null;
    private fileTreeEl: HTMLElement | null = null;
    private previewEl: HTMLElement | null = null;
    private previewPathEl: HTMLElement | null = null;
    private telemetryEl: HTMLElement | null = null;
    private memoryEl: HTMLElement | null = null;
    private toolLogEl: HTMLElement | null = null;
    private modeBadgeEl: HTMLElement | null = null;
    private planEl: HTMLElement | null = null;
    /** 第 4 轮：统一拖拽原语的句柄，onClose 时释放 */
    private layoutResizers: PanelResizerHandle[] = [];
    private typingEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.port = createAgentPort(this.app, plugin);
        this.activeProject = plugin.getActiveProject() || '';
    }

    getViewType(): string {
        return VIEW_TYPE_AGENT_WORKBENCH;
    }

    getDisplayText(): string {
        return '🤖 Agent 创作工作台';
    }

    getIcon(): string {
        return 'bot';
    }

    async onOpen(): Promise<void> {
        applyNwScope(this);
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-awb');

        this.renderHeader();
        const layout = contentEl.createDiv({ cls: 'nw-awb-layout' });
        this.layoutEl = layout;
        // 恢复折叠状态（设置持久化）
        if (this.plugin.settings.agentWorkbenchLeftCollapsed) {
            layout.addClass('nw-awb-left-collapsed');
            const btn = this.contentEl.querySelector('.nw-awb-collapse-btn');
            if (btn) btn.textContent = '⇥';
        }
        if (this.plugin.settings.agentWorkbenchRightCollapsed) {
            layout.addClass('nw-awb-right-collapsed');
            const btns = this.contentEl.querySelectorAll('.nw-awb-collapse-btn');
            if (btns.length > 1) btns[1].textContent = '⇤';
        }
        const left = layout.createDiv({ cls: 'nw-awb-left' });
        const center = layout.createDiv({ cls: 'nw-awb-center' });
        const right = layout.createDiv({ cls: 'nw-awb-right' });
        this.renderLeftPanel(left);
        this.renderCenter(center);
        this.renderRightPanel(right);
        this.initLayoutResizers(layout, left, center, right);

        void this.boot();
    }

    /**
     * 三栏自由调比例：左右两条拖拽分隔条，拖动改宽度并持久化。
     * 中栏 flex:1 自动占剩余空间；宽度存 settings，重开恢复。
     * 2026-10-29 第 4 轮：改用统一原语 `createPanelResizer`
     * （Pointer Events / 键盘可达 / 双击复位 / CSS 变量单一真源）。
     */
    private initLayoutResizers(layout: HTMLElement, left: HTMLElement, center: HTMLElement, right: HTMLElement): void {
        const DEFAULT_LEFT = 210;
        const DEFAULT_RIGHT = 360;

        const leftResizer = createPanelResizer({
            container: layout,
            target: left,
            side: 'before',
            min: 160,
            max: 600,
            value: this.plugin.settings.agentWorkbenchLeftWidth ?? DEFAULT_LEFT,
            defaultValue: DEFAULT_LEFT,
            className: 'nw-awb-resizer nw-awb-resizer-left',
            ariaLabel: '拖动调整左栏宽度（方向键微调，双击复位）',
            onCommit: (width) => {
                this.plugin.settings.agentWorkbenchLeftWidth = width;
                void this.plugin.saveSettings();
            },
        });
        left.classList.add('nw-awb-panel-resizable');

        const rightResizer = createPanelResizer({
            container: layout,
            target: right,
            side: 'after',
            min: 280,
            max: 760,
            value: this.plugin.settings.agentWorkbenchRightWidth ?? DEFAULT_RIGHT,
            defaultValue: DEFAULT_RIGHT,
            className: 'nw-awb-resizer nw-awb-resizer-right',
            ariaLabel: '拖动调整右栏宽度（方向键微调，双击复位）',
            onCommit: (width) => {
                this.plugin.settings.agentWorkbenchRightWidth = width;
                void this.plugin.saveSettings();
            },
        });
        right.classList.add('nw-awb-panel-resizable');

        // 分隔条必须插在左右栏与中栏之间：
        // leftResizer 已 append 到 layout 末尾，需要移到 center 之前；
        // rightResizer 移到 right 之前。
        layout.insertBefore(leftResizer.el, center);
        layout.insertBefore(rightResizer.el, right);

        this.layoutResizers = [leftResizer, rightResizer];
    }

    /** 释放拖拽监听（onClose 调用，避免视图关闭后仍持有 DOM 引用） */
    private destroyLayoutResizers(): void {
        for (const handle of this.layoutResizers) handle.destroy();
        this.layoutResizers = [];
    }

    async onClose(): Promise<void> {
        this.destroyLayoutResizers();
        closeExistingPopovers();
        // 会话代次 +1 并中止在途回合：否则关闭后模型调用/工具仍在跑，
        // 完成后还会往已脱离的 DOM 写消息。
        this.sessionSeq++;
        this.turnAbort?.abort();
        this.turnAbort = null;
        this.harnessEngine = null;
        this.ruleEngine = null;
        this.busy = false;
        this.contentEl.empty();
    }

    /** 复用已打开的叶子时重启会话（openAgentWorkbench 对已有视图调用） */
    async restart(): Promise<void> {
        this.sessionSeq++;
        this.turnAbort?.abort();
        this.turnAbort = null;
        this.harnessEngine = null;
        this.ruleEngine = null;
        this.busy = false;
        this.previewedPath = '';
        this.lastUserText = '';
        await this.onOpen();
    }

    // ─── 头部 ───────────────────────────────────────────────

    private layoutEl: HTMLElement | null = null;

    private renderHeader(): void {
        const header = this.contentEl.createDiv({ cls: 'nw-awb-header' });
        const title = header.createDiv({ cls: 'nw-awb-header-title' });
        title.createSpan({ text: '🤖 Agent 创作工作台' });
        this.modeBadgeEl = title.createSpan({ cls: 'nw-awb-mode-badge', text: '启动中…' });

        const nav = header.createDiv({ cls: 'nw-awb-header-nav' });
        const collapseLeft = nav.createEl('button', { text: '⇤', cls: 'nw-awb-nav-btn nw-awb-collapse-btn', attr: { title: '折叠/展开左栏（项目导航）' } });
        collapseLeft.addEventListener('click', () => {
            const collapsed = this.layoutEl?.hasClass('nw-awb-left-collapsed');
            this.layoutEl?.toggleClass('nw-awb-left-collapsed', !collapsed);
            this.plugin.settings.agentWorkbenchLeftCollapsed = !collapsed;
            void this.plugin.saveSettings();
            collapseLeft.setText(collapsed ? '⇤' : '⇥');
        });
        const collapseRight = nav.createEl('button', { text: '⇥', cls: 'nw-awb-nav-btn nw-awb-collapse-btn', attr: { title: '折叠/展开右栏（文件预览）' } });
        collapseRight.addEventListener('click', () => {
            const collapsed = this.layoutEl?.hasClass('nw-awb-right-collapsed');
            this.layoutEl?.toggleClass('nw-awb-right-collapsed', !collapsed);
            this.plugin.settings.agentWorkbenchRightCollapsed = !collapsed;
            void this.plugin.saveSettings();
            collapseRight.setText(collapsed ? '⇥' : '⇤');
        });
        const navBtns: Array<[string, string, () => void]> = [
            ['📖 工作台', '项目与章节', () => void this.plugin.openFullWriterView()],
            ['✍️ 协同写作', '句级协同', () => void this.plugin.openCoWritingFromActiveContext()],
            ['📚 知识库', '资料库', () => void this.plugin.openKnowledgeBaseView()],
            ['🔍 指纹库', '风格指纹', () => this.plugin.executeCommand('novel-writer-fingerprint-library')],
        ];
        for (const [label, tip, onClick] of navBtns) {
            const btn = nav.createEl('button', { text: label, cls: 'nw-awb-nav-btn' });
            btn.setAttr('title', tip);
            btn.addEventListener('click', onClick);
        }
    }

    // ─── 左栏：两级项目分类 ─────────────────────────────────

    private async renderLeftPanel(container: HTMLElement): Promise<void> {
        container.createEl('h4', { text: '项目', cls: 'nw-awb-panel-title' });
        this.projectListEl = container.createDiv({ cls: 'nw-awb-project-list' });
        await this.refreshProjectList();

        container.createEl('h4', { text: '创作计划', cls: 'nw-awb-panel-title' });
        this.planEl = container.createDiv({ cls: 'nw-awb-plan' });
        this.renderPlan();

        container.createEl('h4', { text: '创作阶段', cls: 'nw-awb-panel-title' });
        const stages = container.createDiv({ cls: 'nw-awb-stages' });
        for (const stage of STAGES) {
            const item = stages.createDiv({ cls: 'nw-awb-stage' });
            item.createSpan({ text: stage.label, cls: 'nw-awb-stage-label' });
            item.createSpan({ text: stage.hint, cls: 'nw-awb-stage-hint' });
            item.setAttr('title', `对 Agent 说「${stage.label.replace(/^[①-⑧]\s*/, '')}」即可进入该阶段`);
        }

        container.createEl('h4', { text: '界面直达', cls: 'nw-awb-panel-title' });
        const quick = container.createDiv({ cls: 'nw-awb-quick' });
        const quickBtns: Array<[string, () => void]> = [
            ['⚙️ 设置', () => { this.plugin.openPluginSettings(); }],
            ['🧬 故事结构', () => this.openStorySettingsForActive()],
            ['📊 质量看板', () => this.plugin.executeCommand('novel-writer-quality-dashboard')],
            ['📦 导出成稿', () => this.plugin.executeCommand('novel-writer-export-manuscript')],
        ];
        for (const [label, onClick] of quickBtns) {
            const btn = quick.createEl('button', { text: label, cls: 'nw-awb-quick-btn' });
            btn.addEventListener('click', onClick);
        }
    }

    /** 当前聚焦项目（供故事结构等直达按钮） */
    private resolveActiveProject(): string {
        const fromMemory = this.harnessEngine?.getSlots()?.pickedProject;
        return this.activeProject
            || (typeof fromMemory === 'string' ? fromMemory : '')
            || this.plugin.getActiveProject()
            || '';
    }

    private openStorySettingsForActive(): void {
        const active = this.resolveActiveProject();
        if (active) {
            this.port.openStorySettings(active);
        } else {
            new Notice('先选择或创建一个项目，再调整故事结构', 4000);
        }
    }

    /**
     * 两级项目分类：长篇小说/短篇小说/剧本 三个类型分组（可折叠）→ 类型下项目卡。
     * 类型判定：路径前缀优先，其次读 .project 的创作模式（带缓存）。
     */
    private async refreshProjectList(): Promise<void> {
        if (!this.projectListEl) return;
        const projects = listProjects(this.app);
        // 每回合都会重建列表：保留滚动位置与分组折叠态（旧实现两者都被重置）
        const scrollTop = this.projectListEl.scrollTop;
        const grouped: Record<CreationMode, string[]> = { long: [], short: [], script: [] };
        const fallback: string[] = [];

        for (const project of projects) {
            const mode = await this.resolveProjectMode(project);
            (grouped[mode] || fallback).push(project);
        }

        this.projectListEl.empty();
        let hasAny = false;
        for (const section of TYPE_SECTIONS) {
            const list = grouped[section.mode];
            const collapsed = this.collapsedGroups.has(section.mode);
            const typeEl = this.projectListEl.createDiv({ cls: 'nw-awb-type' });
            const typeHeader = typeEl.createDiv({ cls: 'nw-awb-type-header' });
            typeHeader.createSpan({ cls: 'nw-awb-type-chevron', text: collapsed ? '▸' : '▾' });
            typeHeader.createSpan({ cls: 'nw-awb-type-label', text: section.label });
            typeHeader.createSpan({ cls: 'nw-awb-type-count', text: String(list.length) });
            const cards = typeEl.createDiv({ cls: 'nw-awb-type-cards' });
            if (collapsed) cards.addClass('nw-awb-collapsed');
            if (list.length === 0) {
                // 全空时由底部统一提示，避免三栏各写一遍「暂无项目」
                if (projects.length > 0) {
                    cards.createDiv({ cls: 'nw-awb-project-empty', text: '暂无项目' });
                }
                continue;
            }
            hasAny = true;
            typeHeader.addEventListener('click', () => {
                const nowCollapsed = !cards.hasClass('nw-awb-collapsed');
                cards.toggleClass('nw-awb-collapsed', nowCollapsed);
                if (nowCollapsed) this.collapsedGroups.add(section.mode);
                else this.collapsedGroups.delete(section.mode);
                const chevron = typeHeader.querySelector('.nw-awb-type-chevron');
                if (chevron) chevron.textContent = nowCollapsed ? '▸' : '▾';
            });
            for (const project of list) {
                const name = project.split('/').pop() || project;
                const card = cards.createDiv({
                    cls: 'nw-awb-project-card' + (project === this.activeProject ? ' is-active' : ''),
                });
                card.createSpan({ cls: 'nw-awb-project-name', text: name });
                card.setAttr('title', `${project}（点击告知 Agent 切换到该项目）`);
                card.addEventListener('click', () => {
                    this.setActiveProject(project);
                    void this.submit(`我要操作项目「${project}」`, 'project');
                });
            }
        }
        if (fallback.length > 0) {
            const typeEl = this.projectListEl.createDiv({ cls: 'nw-awb-type' });
            typeEl.createDiv({ cls: 'nw-awb-type-header is-static' }).createSpan({ cls: 'nw-awb-type-label', text: '其他位置' });
            const cards = typeEl.createDiv({ cls: 'nw-awb-type-cards' });
            hasAny = true;
            for (const project of fallback) {
                const card = cards.createDiv({ cls: 'nw-awb-project-card', text: project });
                card.addEventListener('click', () => {
                    this.setActiveProject(project);
                    void this.submit(`我要操作项目「${project}」`, 'project');
                });
            }
        }
        if (!hasAny && projects.length === 0) {
            this.projectListEl.createDiv({ cls: 'nw-awb-project-empty', text: '还没有项目，对 Agent 说「新建长篇」开始' });
        }
        this.projectListEl.scrollTop = scrollTop;
    }

    /** 项目 → 创作类型：统一走 shared/project-mode（与命令守卫、流程页同一口径） */
    private async resolveProjectMode(project: string): Promise<CreationMode> {
        const mode = await resolveModeFromShared(this.app, project);
        this.projectTypeCache.set(project, mode);
        return mode;
    }

    private setActiveProject(project: string): void {
        this.activeProject = project;
        this.harnessEngine?.updateContext({
            projects: listProjects(this.app),
            activeProject: project,
        });
        // 切项目必须清掉旧预览：右栏会继续显示上一个项目的文件内容，
        // 而文件树/路径标签已经指向新项目，用户会误把 A 的内容当成 B 的。
        if (this.previewedPath && !this.previewedPath.startsWith(`${project}/`)) {
            this.previewedPath = '';
            this.previewSeq++;
            this.previewEl?.empty();
            this.previewEl?.createDiv({ cls: 'nw-awb-preview-empty', text: '从右侧文件树选择文件预览' });
        }
        this.refreshProjectList();
        this.refreshProjectChip();
        this.refreshFileTree();
    }

    // ─── 中栏：对话区 + 输入条 ───────────────────────────────

    private renderCenter(container: HTMLElement): void {
        this.messagesEl = container.createDiv({ cls: 'nw-awb-messages' });
        this.chipsEl = container.createDiv({ cls: 'nw-awb-chips' });

        // 输入条上方的工具行：项目切换 chip + 模型选择徽章（参考图 2/3 的输入框细节）
        const toolbar = container.createDiv({ cls: 'nw-awb-input-toolbar' });
        this.projectChipEl = toolbar.createDiv({ cls: 'nw-awb-chip-project' });
        this.projectChipEl.setAttr('title', '切换 Agent 当前操作的项目');
        this.projectChipEl.addEventListener('click', (event) => {
            this.openProjectChipMenu(event);
        });
        this.modelBadgeEl = toolbar.createEl('button', {
            cls: 'nw-awb-chip-model',
            attr: { title: '选择 API 供应商与模型（两级菜单）；滑杆调节思考强度' },
        });
        this.modelBadgeEl.addEventListener('click', () => {
            if (!this.modelBadgeEl) return;
            openModelPickerPopover(this.modelBadgeEl, this.plugin, () => this.refreshModelBadge());
        });
        this.refreshProjectChip();
        this.refreshModelBadge();

        const inputRow = container.createDiv({ cls: 'nw-awb-input-row' });
        this.inputEl = inputRow.createEl('input', {
            type: 'text',
            cls: 'nw-awb-input',
            attr: { placeholder: '对 Agent 说点什么…（Enter 发送，例如「新建长篇」或「看看我的进度」）' },
        });
        this.inputEl.addEventListener('keydown', (ev: KeyboardEvent) => {
            // Shift+Enter 不发送（单行输入框没有换行语义，但用户按 Shift 时不应误发）
            if (ev.key === 'Enter' && !ev.isComposing && !ev.shiftKey) {
                ev.preventDefault();
                void this.submit(this.inputEl?.value || '');
            }
        });
        const sendBtn = inputRow.createEl('button', { text: '↑', cls: 'nw-awb-send', attr: { title: '发送' } });
        sendBtn.addEventListener('click', () => void this.submit(this.inputEl?.value || ''));
    }

    /** 项目切换 chip：显示当前项目，点击弹出原生分组菜单 */
    private refreshProjectChip(): void {
        if (!this.projectChipEl) return;
        const current = this.resolveActiveProject();
        const name = current ? (current.split('/').pop() || current) : '未选择项目';
        this.projectChipEl.empty();
        this.projectChipEl.createSpan({ cls: 'nw-awb-chip-project-icon', text: '📋' });
        this.projectChipEl.createSpan({ cls: 'nw-awb-chip-project-label', text: name });
        this.projectChipEl.createSpan({ cls: 'nw-awb-chip-project-caret', text: '▾' });
    }

    private refreshModelBadge(): void {
        if (!this.modelBadgeEl) return;
        this.modelBadgeEl.setText(`🔌 ${formatWorkbenchModelBadge(this.plugin)}`);
    }

    /** 项目 chip 的快捷菜单：三个类型分组 → 项目（原生 Menu，分组标题用禁用项承载） */
    private openProjectChipMenu(event: MouseEvent): void {
        const menu = new Menu();
        const projects = listProjects(this.app);
        const groups: Record<string, string[]> = { 长篇小说: [], 短篇小说: [], 剧本: [], 其他: [] };
        for (const project of projects) {
            const prefix = project.split('/')[0];
            const cached = this.projectTypeCache.get(project);
            const bucket = MODE_LIBRARY_GROUP_LOOKUP[prefix]
                || (cached === 'short' ? '短篇小说'
                    : cached === 'script' ? '剧本'
                        : cached === 'long' ? '长篇小说' : '其他');
            groups[bucket].push(project);
        }
        for (const [group, list] of Object.entries(groups)) {
            if (list.length === 0) continue;
            menu.addItem(item => {
                item.setTitle(`— ${group} —`).setDisabled(true);
            });
            for (const project of list) {
                menu.addItem(item => item.setTitle(`${project === this.activeProject ? '✓ ' : ''}${project}`).onClick(() => {
                    this.setActiveProject(project);
                    void this.submit(`我要操作项目「${project}」`, 'project');
                }));
            }
        }
        menu.showAtMouseEvent(event);
    }

    // ─── 右栏：文件树 + 预览 ─────────────────────────────────

    private renderRightPanel(container: HTMLElement): void {
        container.createEl('h4', { text: '文件', cls: 'nw-awb-panel-title' });
        const fileRoot = container.createDiv({ cls: 'nw-awb-file-root' });
        const toolbar = fileRoot.createDiv({ cls: 'nw-awb-file-toolbar' });
        this.previewPathEl = toolbar.createDiv({ cls: 'nw-awb-file-rootpath', text: this.fileTreeRootLabel() });
        const reloadBtn = toolbar.createEl('button', { text: '⟳', cls: 'nw-awb-file-reload', attr: { title: '刷新文件树' } });
        reloadBtn.addEventListener('click', () => this.refreshFileTree());

        const fileSplit = fileRoot.createDiv({ cls: 'nw-awb-file-split' });
        this.fileTreeEl = fileSplit.createDiv({ cls: 'nw-awb-file-tree' });
        const previewWrap = fileSplit.createDiv({ cls: 'nw-awb-preview' });
        previewWrap.createDiv({ cls: 'nw-awb-preview-title', text: '预览' });
        this.previewEl = previewWrap.createDiv({ cls: 'nw-awb-preview-body' });
        this.previewEl.createDiv({ cls: 'nw-awb-preview-empty', text: '从目录中选择一个文件' });

        // 遥测与记忆：折叠区（右栏以文件预览为主）
        const telemetryDetails = container.createEl('details', { cls: 'nw-awb-telemetry-details' });
        telemetryDetails.createEl('summary', { text: '会话遥测与记忆' });
        this.telemetryEl = telemetryDetails.createDiv({ cls: 'nw-awb-telemetry' });
        const grid = this.telemetryEl.createDiv({ cls: 'nw-awb-telemetry-grid' });
        grid.setAttr('data-nw-awb-telemetry-grid', '1');
        this.memoryEl = telemetryDetails.createDiv({ cls: 'nw-awb-memory' });
        this.toolLogEl = telemetryDetails.createDiv({ cls: 'nw-awb-toollog' });

        this.refreshFileTree();
    }

    private fileTreeRoot(): string {
        return this.resolveActiveProject();
    }

    private fileTreeRootLabel(): string {
        const root = this.fileTreeRoot();
        return root || '（未选择项目）';
    }

    /** 刷新文件树：根 = 当前聚焦项目；无项目时显示模式库根目录 */
    private refreshFileTree(): void {
        if (!this.fileTreeEl || !this.previewPathEl) return;
        // 每回合都会重建文件树：保留滚动位置（长树里点一个文件就跳回顶部）
        const scrollTop = this.fileTreeEl.scrollTop;
        this.fileTreeEl.empty();
        const root = this.fileTreeRoot();
        this.previewPathEl.setText(root || '（未选择项目）');

        if (root) {
            const abstract = this.app.vault.getAbstractFileByPath(root);
            if (abstract instanceof TFolder) {
                this.renderTreeChildren(this.fileTreeEl, abstract, true);
                this.fileTreeEl.scrollTop = scrollTop;
                return;
            }
            this.fileTreeEl.createDiv({ cls: 'nw-awb-file-missing', text: `项目目录不存在：${root}` });
            this.fileTreeEl.scrollTop = scrollTop;
            return;
        }

        // 无项目：列出模式库根目录
        for (const name of MODE_LIBRARY_ROOTS) {
            const folder = this.app.vault.getAbstractFileByPath(name);
            if (folder instanceof TFolder) {
                this.renderTreeRow(this.fileTreeEl, folder, false);
            }
        }
        const meta = this.app.vault.getAbstractFileByPath('元文件');
        if (meta instanceof TFolder) this.renderTreeRow(this.fileTreeEl, meta, false);
        // renderTreeRow 的参数类型经 instanceof 收窄后已是 TFolder | TFile
        if (this.fileTreeEl.children.length === 0) {
            this.fileTreeEl.createDiv({ cls: 'nw-awb-file-missing', text: 'vault 中还没有项目目录' });
        }
        this.fileTreeEl.scrollTop = scrollTop;
    }

    /** 渲染一层目录内容（目录优先，名称自然排序） */
    private renderTreeChildren(container: HTMLElement, folder: TFolder, expanded: boolean): void {
        if (!expanded) return;
        const entries = [...folder.children] as Array<TFolder | TFile>;
        entries.sort((a, b) => {
            const aDir = a instanceof TFolder ? 0 : 1;
            const bDir = b instanceof TFolder ? 0 : 1;
            if (aDir !== bDir) return aDir - bDir;
            return a.name.localeCompare(b.name, 'zh-Hans-CN');
        });
        if (entries.length === 0) {
            container.createDiv({ cls: 'nw-awb-file-empty', text: '（空目录）' });
            return;
        }
        for (const entry of entries) {
            this.renderTreeRow(container, entry, false);
        }
    }

    private renderTreeRow(container: HTMLElement, entry: TFolder | TFile, expanded: boolean): void {
        if (entry instanceof TFolder) {
            const isOpen = expanded || this.expandedDirs.has(entry.path);
            const row = container.createDiv({ cls: 'nw-awb-tree-row is-dir' });
            row.createSpan({ cls: 'nw-awb-tree-caret', text: isOpen ? '▾' : '▸' });
            row.createSpan({ cls: 'nw-awb-tree-name', text: entry.name });
            row.addEventListener('click', () => {
                if (this.expandedDirs.has(entry.path)) this.expandedDirs.delete(entry.path);
                else this.expandedDirs.add(entry.path);
                this.refreshFileTree();
            });
            if (isOpen) {
                const childContainer = container.createDiv({ cls: 'nw-awb-tree-children' });
                this.renderTreeChildren(childContainer, entry, true);
            }
            return;
        }

        const isActive = entry.path === this.previewedPath;
        const row = container.createDiv({ cls: 'nw-awb-tree-row is-file' + (isActive ? ' is-active' : '') });
        row.createSpan({ cls: 'nw-awb-tree-caret', text: '' });
        row.createSpan({ cls: 'nw-awb-tree-name', text: entry.name });
        row.setAttr('title', entry.path);
        row.addEventListener('click', () => {
            this.previewedPath = entry.path;
            this.refreshFileTree();
            void this.renderPreview(entry);
        });
    }

    /**
     * 文件预览自适应：按内容类型选渲染方式。
     * - 图片 → <img>（vault.getResourcePath，不读内容）；
     * - 音频/视频 → <audio>/<video controls>；
     * - Markdown → MarkdownRenderer 渲染（标题/列表/代码块/表格）；
     * - 其余文本 → pre 等宽展示；不认识的二进制 → 占位提示。
     */
    private async renderPreview(file: TFile): Promise<void> {
        if (!this.previewEl) return;
        // 预览代次：快速点 A 再点 B 时，A 的异步读取可能后完成并覆盖 B。
        const token = ++this.previewSeq;
        this.previewEl.empty();
        const kind = classifyPreviewKind(file.extension);
        try {
            if (kind === 'image') {
                const img = this.previewEl.createEl('img', { cls: 'nw-awb-preview-image' });
                img.src = this.app.vault.getResourcePath(file);
                img.setAttr('alt', file.name);
                return;
            }
            if (kind === 'audio') {
                const audio = this.previewEl.createEl('audio', { cls: 'nw-awb-preview-media' });
                audio.setAttr('controls', '');
                audio.setAttr('src', this.app.vault.getResourcePath(file));
                return;
            }
            if (kind === 'video') {
                const video = this.previewEl.createEl('video', { cls: 'nw-awb-preview-media' });
                video.setAttr('controls', '');
                video.setAttr('src', this.app.vault.getResourcePath(file));
                return;
            }
            if (kind === 'markdown') {
                const content = await this.app.vault.cachedRead(file);
                if (token !== this.previewSeq) return;
                const target = this.previewEl.createDiv({ cls: 'nw-awb-preview-markdown' });
                await MarkdownRenderer.render(this.app, content, target, file.path, this);
                if (token !== this.previewSeq) target.remove();
                return;
            }
            if (kind === 'text') {
                const content = await this.app.vault.cachedRead(file);
                if (token !== this.previewSeq) return;
                const pre = this.previewEl.createEl('pre', { cls: 'nw-awb-preview-content' });
                pre.setText(content.slice(0, 200_000));
                return;
            }
            this.previewEl.createDiv({
                cls: 'nw-awb-preview-empty',
                text: `暂不支持预览 .${file.extension} 文件（${file.path}）`,
            });
        } catch (e) {
            this.previewEl.createDiv({
                cls: 'nw-awb-preview-empty',
                text: `读取失败：${e instanceof Error ? e.message : String(e)}`,
            });
        }
    }

    // ─── 引擎装配与消息处理 ─────────────────────────────────

    private async boot(): Promise<void> {
        const session = this.sessionSeq;
        const ctx = getAgentContext(this.app, this.plugin);
        this.activeProject = ctx.activeProject || this.activeProject;
        this.setModeBadge(this.plugin.hasAiCredentials);

        if (this.plugin.hasAiCredentials) {
            // 每次装配一个新会话就换一个中止器：关闭/重启时能真正停掉在途回合与工具
            const abort = new AbortController();
            this.turnAbort = abort;
            const harness = new AgentHarnessEngine({
                ctx,
                adapter: createCallAIAdapter(async (system, user, opts) => {
                    const result = await this.plugin.aiEngine.callAI(system, user, undefined, 0.6, 2500, {
                        bypassCache: true,
                        signal: opts?.signal,
                    });
                    return { content: result.content, error: result.error, finishReason: result.finishReason };
                }),
                portDeps: { port: this.port, ctx },
                // 会话压缩（dsh compaction 思路）：30 轮触发，保留最近 12 轮
                compaction: { thresholdTurns: 30, keepTurns: 12 },
                signal: abort.signal,
            });
            try {
                this.harnessEngine = harness;
                const outcome = await harness.start();
                // 启动期间会话已被重启/关闭：旧问候不得写进新会话
                if (session !== this.sessionSeq) return;
                this.renderOutcome(outcome);
                return;
            } catch (e) {
                if (session !== this.sessionSeq) return;
                console.warn('[AgentWorkbench] Harness 启动失败，回退规则引擎:', e);
                this.harnessEngine = null;
                new Notice('AI 引导启动失败，已切换到离线逐步引导', 5000);
            }
        }
        if (session !== this.sessionSeq) return;
        this.ruleEngine = new GuideAgentEngine(ctx, this.port);
        this.renderTurn(this.ruleEngine.start());
    }

    private async switchToRuleEngine(): Promise<void> {
        this.harnessEngine = null;
        // 降级时沿用工作台自己的当前项目：getAgentContext 读的是插件活动文件，
        // 可能与用户在左栏选的项目不一致，后续创建/打开会作用到错误项目。
        const ctx = getAgentContext(this.app, this.plugin);
        if (this.activeProject) ctx.activeProject = this.activeProject;
        this.ruleEngine = new GuideAgentEngine(ctx, this.port);
        this.setModeBadge(false);
        this.renderTurn(this.ruleEngine.start());
    }

    private setModeBadge(aiMode: boolean | null): void {
        if (!this.modeBadgeEl) return;
        if (aiMode === null) {
            this.modeBadgeEl.setText('启动中…');
            return;
        }
        this.modeBadgeEl.setText(aiMode ? '🤖 AI 驱动' : '🧭 离线引导');
        this.modeBadgeEl.toggleClass('is-ai', aiMode);
    }

    /**
     * 提交一次用户输入。
     * source='input' 表示键盘/发送按钮（可清空草稿）；chip/项目卡点击不清草稿，
     * 否则用户正在写的半句话会被静默丢弃。
     */
    private async submit(raw: string, source: 'input' | 'chip' | 'project' = 'input'): Promise<void> {
        const text = raw.trim();
        if (!text) return;

        // 控制令牌不上屏、不写进会话历史（旧实现把 __retry__/__fallback_rule__ 当用户消息）
        if (text === '__fallback_rule__') {
            if (this.inputEl) this.inputEl.value = '';
            // 回合进行中切离线：先中止 harness 回合，否则它会继续跑完剩余步骤
            this.turnAbort?.abort();
            await this.switchToRuleEngine();
            return;
        }
        if (text === '__retry__') {
            if (this.busy) return;
            if (this.inputEl) this.inputEl.value = '';
            await this.retryLastTurn();
            return;
        }

        if (this.busy) {
            // 回合进行中：补充消息进入收件箱（吸收 dsh steering），
            // 模型下一步就能看到，不必等整轮结束，也不打断当前工具链。
            const accepted = this.harnessEngine?.steer(text) ?? false;
            if (accepted) {
                if (source === 'input' && this.inputEl) this.inputEl.value = '';
                this.pushUser(text);
                this.appendSystemNote('已插入当前回合，模型下一步会看到');
            } else {
                new Notice('当前回合仍在执行，请稍后再发', 2500);
            }
            return;
        }

        if (source === 'input' && this.inputEl) this.inputEl.value = '';
        this.pushUser(text);
        this.lastUserText = text;
        await this.runTurn(text);
    }

    /** 「重试」：重放上一条用户消息，不重复渲染用户气泡 */
    private async retryLastTurn(): Promise<void> {
        if (!this.lastUserText) {
            new Notice('没有可重试的消息', 3000);
            return;
        }
        this.appendSystemNote('已重试上一条消息');
        await this.runTurn(this.lastUserText);
    }

    /** 对话区追加一条系统提示（不进入引擎历史） */
    private appendSystemNote(text: string): void {
        if (!this.messagesEl) return;
        const row = this.messagesEl.createDiv({ cls: 'nw-awb-row nw-awb-row-system' });
        row.createDiv({ cls: 'nw-awb-bubble nw-awb-bubble-system', text });
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    /** 真正驱动一个回合（harness 或规则引擎） */
    private async runTurn(text: string): Promise<void> {
        const session = this.sessionSeq;
        this.busy = true;
        try {
            if (this.harnessEngine) {
                this.showTyping();
                const outcome = await this.harnessEngine.handle(text);
                // 会话已重启/关闭：旧回合结果不得写进新会话的 DOM
                if (session !== this.sessionSeq) return;
                this.hideTyping();
                this.renderOutcome(outcome);
                return;
            }
            if (!this.ruleEngine) return;
            const turn = await this.ruleEngine.handle(text);
            if (session !== this.sessionSeq) return;
            this.renderTurn(turn);
            await this.runIntent(turn.intent);
        } catch (e) {
            if (session !== this.sessionSeq) return;
            this.hideTyping();
            console.error('[AgentWorkbench] 处理输入失败:', e);
            new Notice(`对话处理失败：${e instanceof Error ? e.message : String(e)}`, 6000);
        } finally {
            if (session === this.sessionSeq) this.busy = false;
        }
    }

    private async runIntent(intent: AgentIntent): Promise<void> {
        if (!this.ruleEngine) return;
        switch (intent.kind) {
            case 'create_long_project': {
                const outcome = await this.port.createProject(intent.params);
                this.renderTurn(this.ruleEngine.reportAction('create_project', {
                    ok: outcome.created,
                    detail: outcome.created ? `${outcome.fileCount} 个文件` : outcome.reason,
                    projectId: outcome.projectId,
                }));
                break;
            }
            case 'open_wizard': {
                const ok = await this.port.openWizard(intent.project);
                this.renderTurn(this.ruleEngine.reportAction('open_wizard', { ok, detail: ok ? undefined : '请先在项目与章节页手动点击「向导」' }));
                break;
            }
            case 'open_flow': {
                const ok = await Promise.resolve(this.port.openFlow?.(intent.project) ?? false);
                this.renderTurn(this.ruleEngine.reportAction('open_flow', { ok }));
                break;
            }
            case 'open_story_settings': {
                const ok = this.port.openStorySettings(intent.project);
                this.renderTurn(this.ruleEngine.reportAction('open_story_settings', { ok }));
                break;
            }
            case 'open_full_writer': {
                const ok = await Promise.resolve(this.port.openFullWriter(intent.project));
                this.renderTurn(this.ruleEngine.reportAction('open_full_writer', { ok }));
                break;
            }
            case 'create_short_project': {
                const outcome = await this.port.createShortProject?.(intent.params);
                this.renderTurn(this.ruleEngine.reportAction('create_short_project', {
                    ok: Boolean(outcome?.created),
                    detail: outcome?.created ? '已写入前期调研' : outcome?.reason,
                    projectId: outcome?.projectId,
                }));
                break;
            }
            case 'create_script_project': {
                const outcome = await this.port.createScriptProject?.(intent.params);
                this.renderTurn(this.ruleEngine.reportAction('create_script_project', {
                    ok: Boolean(outcome?.created),
                    detail: outcome?.created ? '已写入前期调研' : outcome?.reason,
                    projectId: outcome?.projectId,
                }));
                break;
            }
            case 'open_pre_research': {
                const ok = this.port.openPreResearch(intent.mode, intent.project);
                this.renderTurn(this.ruleEngine.reportAction('open_pre_research', { ok }));
                break;
            }
            default:
                break;
        }
    }

    // ─── 渲染 ───────────────────────────────────────────────

    private renderOutcome(outcome: HarnessTurnOutcome): void {
        for (const message of outcome.messages) {
            this.renderMessage(message as AgentMessage);
        }
        const last = outcome.messages[outcome.messages.length - 1];
        this.renderChips((last?.chips as AgentChip[] | undefined) || outcome.chips.map(chip => ({ ...chip })));
        this.renderTelemetry();
        this.renderPlan();
        // Agent 新建项目后会把 pickedProject 写进记忆：视图必须跟着切过去，
        // 否则项目 chip/文件树/高亮仍停在旧项目（旧实现只在用户手点项目卡时同步）。
        const picked = this.harnessEngine?.getSlots()?.pickedProject;
        if (typeof picked === 'string' && picked && picked !== this.activeProject) {
            this.setActiveProject(picked);
        }
        this.refreshProjectList();
        this.refreshProjectChip();
        this.refreshModelBadge();
        this.refreshFileTree();
        this.scrollToEnd();
    }

    private renderTurn(turn: AgentTurnResult): void {
        for (const message of turn.messages) {
            this.renderMessage(message);
        }
        this.renderChips(turn.messages[turn.messages.length - 1]?.chips || []);
        this.renderTelemetry();
        this.renderPlan();
        this.refreshProjectList();
        this.refreshProjectChip();
        this.refreshFileTree();
        this.scrollToEnd();
    }

    /**
     * 渲染一条消息。
     * 工具调用行（role=system）吸收 dsh ToolRow：折叠为「图标 + 摘要」一行，
     * 点击展开完整参数/结果详情，再次点击收起。
     */
    private renderMessage(message: AgentMessage): void {
        if (!this.messagesEl) return;
        const row = this.messagesEl.createDiv({ cls: `nw-awb-row nw-awb-row-${message.role}` });
        const bubble = row.createDiv({ cls: 'nw-awb-bubble' });

        if (message.role === 'system') {
            const lines = message.text.split('\n');
            const head = lines[0] || '';
            const detail = lines.slice(1).join('\n').trim();

            const headRow = bubble.createDiv({ cls: 'nw-awb-line nw-awb-tool-head' });
            headRow.createSpan({ cls: 'nw-awb-tool-text', text: head });

            if (detail) {
                const caret = headRow.createSpan({ cls: 'nw-awb-tool-caret', text: '▾' });
                let detailEl: HTMLElement | null = null;
                headRow.addEventListener('click', (event) => {
                    event.stopPropagation();
                    if (detailEl) {
                        detailEl.remove();
                        detailEl = null;
                        caret.setText('▾');
                        return;
                    }
                    detailEl = bubble.createDiv({ cls: 'nw-awb-tool-detail', text: detail });
                    caret.setText('▴');
                });
            }
            return;
        }

        for (const line of message.text.split('\n')) {
            if (line.startsWith('· ')) {
                bubble.createDiv({ text: line, cls: 'nw-awb-line nw-awb-line-bullet' });
            } else if (line.length === 0) {
                bubble.createDiv({ cls: 'nw-awb-line nw-awb-line-spacer' });
            } else {
                bubble.createDiv({ text: line, cls: 'nw-awb-line' });
            }
        }
        void row;
    }

    private pushUser(text: string): void {
        if (!this.messagesEl) return;
        const row = this.messagesEl.createDiv({ cls: 'nw-awb-row nw-awb-row-user' });
        row.createDiv({ cls: 'nw-awb-bubble', text });
        this.renderChips([]);
        this.scrollToEnd();
    }

    private renderChips(chips: AgentChip[]): void {
        if (!this.chipsEl) return;
        this.chipsEl.empty();
        const hasDetails = chips.some(c => c.description || c.bestFor || c.risk || c.preview);
        this.chipsEl.toggleClass('nw-awb-chips-detailed', hasDetails);
        for (const chip of chips) {
            if (hasDetails) {
                const btn = this.chipsEl.createEl('button', { cls: 'nw-agent-choice' });
                btn.createSpan({ text: chip.label, cls: 'nw-agent-choice-label' });
                if (chip.description) btn.createSpan({ text: chip.description, cls: 'nw-agent-choice-desc' });
                const meta = [
                    chip.bestFor ? `适用：${chip.bestFor}` : '',
                    chip.preview ? `预览：${chip.preview}` : '',
                    chip.risk ? `风险：${chip.risk}` : '',
                ].filter(Boolean);
                if (meta.length > 0) {
                    btn.createSpan({ text: meta.join(' · '), cls: 'nw-agent-choice-meta' });
                }
                btn.addEventListener('click', () => void this.submit(chip.value, 'chip'));
            } else {
                const btn = this.chipsEl.createEl('button', { text: chip.label, cls: 'nw-agent-chip' });
                if (chip.description) btn.setAttr('title', chip.description);
                btn.addEventListener('click', () => void this.submit(chip.value, 'chip'));
            }
        }
        this.chipsEl.toggleClass('nw-awb-chips-empty', chips.length === 0);
    }

    /** 创作计划卡片：update_plan 工具维护的步骤实时渲染 */
    private renderPlan(): void {
        if (!this.planEl) return;
        this.planEl.empty();
        const steps = this.harnessEngine?.getPlan() || [];
        if (steps.length === 0) {
            this.planEl.createDiv({ cls: 'nw-awb-plan-empty', text: 'Agent 建立计划后在此显示' });
            return;
        }
        for (const step of steps) {
            const row = this.planEl.createDiv({ cls: 'nw-awb-plan-row is-' + step.status });
            row.createSpan({ cls: 'nw-awb-plan-icon', text: step.status === 'done' ? '✓' : step.status === 'in_progress' ? '◐' : '○' });
            row.createSpan({ cls: 'nw-awb-plan-step', text: step.step });
        }
    }

    /** 打字指示器：等待模型时显示三点 shimmer */
    private showTyping(): void {
        if (!this.messagesEl || this.typingEl) return;
        this.typingEl = this.messagesEl.createDiv({ cls: 'nw-awb-row nw-awb-row-agent' });
        const bubble = this.typingEl.createDiv({ cls: 'nw-awb-bubble nw-awb-typing' });
        bubble.createSpan({ cls: 'nw-awb-typing-dot' });
        bubble.createSpan({ cls: 'nw-awb-typing-dot' });
        bubble.createSpan({ cls: 'nw-awb-typing-dot' });
        this.scrollToEnd();
    }

    private hideTyping(): void {
        this.typingEl?.remove();
        this.typingEl = null;
    }

    private renderTelemetry(): void {
        if (!this.telemetryEl || !this.memoryEl || !this.toolLogEl) return;
        const telemetry: HarnessTelemetry = this.harnessEngine?.getTelemetry() || {
            turns: 0, modelCalls: 0, toolCalls: 0, toolOk: 0, toolFail: 0, byTool: {}, lastToolCalls: [],
            prunedChars: 0, prunedResults: 0, compactions: 0, compactedEvents: 0, steers: 0,
        };

        // 遥测网格：复用既有的 grid 容器
        const grid = this.telemetryEl.querySelector('[data-nw-awb-telemetry-grid]');
        if (grid) {
            grid.empty();
            const cells: Array<[string, string]> = [
                ['轮次', String(telemetry.turns)],
                ['模型调用', String(telemetry.modelCalls)],
                ['工具调用', `${telemetry.toolOk}/${telemetry.toolCalls}`],
                ['失败', String(telemetry.toolFail)],
                // dsh token-meter / pruner 的可观测化：裁剪与压缩省下的上下文
                ['省字符', telemetry.prunedChars > 0 ? `${Math.round(telemetry.prunedChars / 1000)}k` : '0'],
                ['压缩', String(telemetry.compactions)],
            ];
            for (const [label, value] of cells) {
                const cell = grid.createDiv({ cls: 'nw-awb-telemetry-cell' });
                cell.createDiv({ cls: 'nw-awb-telemetry-value', text: value });
                cell.createDiv({ cls: 'nw-awb-telemetry-label', text: label });
            }
        }

        this.memoryEl.empty();
        const slots = this.harnessEngine?.getSlots() || {};
        const keys = Object.keys(slots).filter(key => slots[key] !== undefined && slots[key] !== '');
        if (keys.length === 0) {
            this.memoryEl.createDiv({ cls: 'nw-awb-memory-empty', text: 'Agent 还没有记录信息' });
        } else {
            const memoryTitle = this.memoryEl.createDiv({ cls: 'nw-awb-toollog-title', text: '记忆槽位' });
            void memoryTitle;
            for (const key of keys.slice(0, 14)) {
                const row = this.memoryEl.createDiv({ cls: 'nw-awb-memory-row' });
                row.createSpan({ cls: 'nw-awb-memory-key', text: key });
                row.createSpan({ cls: 'nw-awb-memory-value', text: String(slots[key]).slice(0, 40) });
            }
            if (keys.length > 14) {
                this.memoryEl.createDiv({ cls: 'nw-awb-memory-empty', text: `…共 ${keys.length} 项` });
            }
        }

        this.toolLogEl.empty();
        if (telemetry.lastToolCalls.length === 0) {
            this.toolLogEl.createDiv({ cls: 'nw-awb-memory-empty', text: '暂无工具调用' });
        } else {
            const toolTitle = this.toolLogEl.createDiv({ cls: 'nw-awb-toollog-title', text: '最近工具调用' });
            void toolTitle;
            for (const call of telemetry.lastToolCalls) {
                const row = this.toolLogEl.createDiv({ cls: 'nw-awb-toollog-row' + (call.ok ? '' : ' is-fail') });
                row.createSpan({ cls: 'nw-awb-toollog-icon', text: call.ok ? '✓' : '✗' });
                row.createSpan({ cls: 'nw-awb-toollog-name', text: call.tool });
                row.createSpan({ cls: 'nw-awb-toollog-summary', text: call.summary.slice(0, 24) });
            }
        }
    }

    private scrollToEnd(): void {
        requestAnimationFrame(() => {
            if (this.messagesEl) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        });
    }
}

const MODE_LIBRARY_GROUP_LOOKUP: Record<string, string> = {
    长篇小说: '长篇小说',
    短篇小说: '短篇小说',
    剧本: '剧本',
};
