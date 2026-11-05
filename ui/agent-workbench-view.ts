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
import NovelWriterPlugin from '@/main';
import { applyNwScope } from '@/utils/helpers';
import { createPanelResizer, type PanelResizerHandle } from './panel-resizer';
import { Platform } from 'obsidian';
import { DshSession } from '@/engine/agent/dsh/dsh-session';
import { buildDshLaunchPlan, buildSandboxPatch } from '@/engine/agent/dsh/dsh-launch';
import { createDshProcessTransport } from '@/engine/agent/dsh/dsh-process';
import { OperationConfirmModal } from './components/progress';
import { showErrorNotice, showWarningNotice } from './components/notice-helpers';
import { GuideAgentEngine } from '@/engine/agent/conversation-engine';
import { AgentHarnessEngine, type HarnessTelemetry } from '@/engine/agent/harness/harness-engine';
import { createCallAIAdapter } from '@/engine/agent/harness/agent-adapter';
import type { AgentChip, AgentContext, AgentIntent, AgentMessage, AgentTurnResult, GuideAgentPort } from '@/engine/agent/agent-types';
import type { HarnessTurnOutcome } from '@/engine/agent/harness/harness-types';
import { createAgentPort, getAgentContext } from './services/agent-port';
import { listProjectIds } from '@/shared/project-catalog';
import type { CreationMode } from '@/shared/creation-mode';
import { resolveProjectMode as resolveModeFromShared } from '@/shared/project-mode';
import { openModelPickerPopover, formatWorkbenchModelBadge, closeExistingPopovers } from './model-picker-popover';
import { VIEW_TYPE_AGENT_WORKBENCH } from '@/shared/view-types';
import { classifyPreviewKind } from '@/shared/preview-kind';
import { createVaultSpillSink, pruneSpillArchive } from './services/agent-spill-store';
import { createAgentSessionStore, type AgentSessionStore } from './services/agent-session-store';
import { findModelCapability } from '@/shared/model-capabilities';
import {
    activeAtToken,
    buildMentionBlock,
    extractMentionPaths,
    filterVaultPaths,
    formatFileMention,
    stripMentionMarkers,
    type MentionToken,
} from '@/shared/file-mention';
import { isImeComposing } from '@/shared/keyboard';

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

/**
 * AgentWorkbenchView 类。
 */
export class AgentWorkbenchView extends ItemView {
    private readonly plugin: NovelWriterPlugin;
    private harnessEngine: AgentHarnessEngine | null = null;
    private ruleEngine: GuideAgentEngine | null = null;
    private port: GuideAgentPort;
    private busy = false;
    /** 当前聚焦项目（文件树/项目卡高亮/项目 chip 用） */
    private activeProject = '';
    /** 当前 Agent 上下文（项目列表变化时同步，供 list_projects 等工具使用） */
    private agentCtx: AgentContext | null = null;
    /** 项目目录增删改后的刷新防抖 */
    private projectRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    /** vault 事件只绑定一次（restart 会重复 onOpen） */
    private projectEventsBound = false;
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
    /** 输入框（textarea：支持 Shift+Enter 换行与 @ 引用） */
    private inputEl: HTMLTextAreaElement | null = null;
    /** 引用条（「引用」某条回复后显示在输入框上方） */
    private quoteBarEl: HTMLElement | null = null;
    private quote: { text: string } | null = null;
    /** @ 引用候选弹层 */
    private mentionEl: HTMLElement | null = null;
    private mentionItems: string[] = [];
    private mentionIndex = 0;
    private mentionToken: MentionToken | null = null;
    /** 库内路径缓存（@ 候选；随文件树刷新重建） */
    private vaultPathCache: string[] = [];
    /** 会话存档（.sessions/agent/<项目>.jsonl） */
    private sessionStore: AgentSessionStore | null = null;
    private sessionTitleEl: HTMLElement | null = null;
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
    /** dsh 可选后端（实验）：仅桌面端、显式开启时存在 */
    private dshSession: DshSession | null = null;
    /** 当前 dsh 回合收集器（assistant/tool 事件按回合归并） */
    private dshTurnCollector: { texts: string[]; tools: Array<{ tool: string; ok: boolean; summary: string }> } | null = null;
    private typingEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.port = createAgentPort(this.app, plugin);
        this.activeProject = plugin.getActiveProject() || '';
    }

    /**
     * 获取视图类型。
     * @returns 文本结果
     */
    getViewType(): string {
        return VIEW_TYPE_AGENT_WORKBENCH;
    }

    /**
     * getDisplayText 方法。
     * @returns 文本结果
     */
    getDisplayText(): string {
        return '🤖 Agent 创作工作台';
    }

    /**
     * getIcon 方法。
     * @returns 文本结果
     */
    getIcon(): string {
        return 'bot';
    }

    /**
     * onOpen 方法。
     */
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

        // 项目删除/重命名/新建后，左栏与 Agent 上下文必须跟着刷新；
        // 旧实现只在 boot 与 Agent 回合后刷新，其他视图删除项目后这里仍显示旧项目。
        if (!this.projectEventsBound) {
            this.projectEventsBound = true;
            const schedule = () => this.scheduleProjectRefresh();
            this.registerEvent(this.app.vault.on('create', schedule));
            this.registerEvent(this.app.vault.on('delete', schedule));
            this.registerEvent(this.app.vault.on('rename', schedule));
        }

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

    /**
     * onClose 方法。
     */
    async onClose(): Promise<void> {
        this.destroyLayoutResizers();
        if (this.projectRefreshTimer !== null) {
            clearTimeout(this.projectRefreshTimer);
            this.projectRefreshTimer = null;
        }
        closeExistingPopovers();
        // 会话代次 +1 并中止在途回合：否则关闭后模型调用/工具仍在跑，
        // 完成后还会往已脱离的 DOM 写消息。
        this.sessionSeq++;
        this.turnAbort?.abort();
        this.turnAbort = null;
        this.harnessEngine = null;
        this.ruleEngine = null;
        this.dshSession?.close();
        this.dshSession = null;
        this.dshTurnCollector = null;
        this.busy = false;
        // 关视图前把节流中的快照写完（最多 1s 未落盘）
        void this.sessionStore?.flush();
        this.sessionStore = null;
        this.contentEl.empty();
    }

    /** 复用已打开的叶子时重启会话（openAgentWorkbench 对已有视图调用） */
    async restart(): Promise<void> {
        this.sessionSeq++;
        this.turnAbort?.abort();
        this.turnAbort = null;
        this.harnessEngine = null;
        this.ruleEngine = null;
        this.dshSession?.close();
        this.dshSession = null;
        this.dshTurnCollector = null;
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
        // 会话标题（首条用户消息前 30 字；恢复的旧会话也能看出在聊什么）
        this.sessionTitleEl = title.createSpan({ cls: 'nw-awb-session-title' });

        const nav = header.createDiv({ cls: 'nw-awb-header-nav' });
        const newSessionBtn = nav.createEl('button', {
            text: '🆕 新会话',
            cls: 'nw-awb-nav-btn',
            attr: { title: '清空当前项目的会话存档，重新开始（spill 存档保留 7 天）' },
        });
        newSessionBtn.addEventListener('click', () => void this.startNewSession());
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

    /** 延迟刷新项目列表/文件树（vault 批量删除会连发多个事件） */
    private scheduleProjectRefresh(): void {
        if (this.projectRefreshTimer !== null) clearTimeout(this.projectRefreshTimer);
        this.projectRefreshTimer = setTimeout(() => {
            this.projectRefreshTimer = null;
            void this.refreshProjectList();
            this.refreshProjectChip();
            this.refreshFileTree();
        }, 250);
    }

    /**
     * 两级项目分类：长篇小说/短篇小说/剧本 三个类型分组（可折叠）→ 类型下项目卡。
     * 类型判定：路径前缀优先，其次读 .project 的创作模式（带缓存）。
     */
    private async refreshProjectList(): Promise<void> {
        if (!this.projectListEl) return;
        const projects = listProjectIds(this.app);
        // Agent 上下文与左栏共用同一份列表；删除项目后 list_projects 立刻一致。
        if (this.agentCtx) this.agentCtx.projects = projects;
        if (this.activeProject && !projects.includes(this.activeProject)) {
            this.activeProject = projects[0] || '';
            if (this.agentCtx) this.agentCtx.activeProject = this.activeProject || null;
            this.harnessEngine?.updateContext({ projects, activeProject: this.activeProject || null });
            this.previewedPath = '';
            this.previewSeq++;
        }
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
        const projects = listProjectIds(this.app);
        if (this.agentCtx) {
            this.agentCtx.projects = projects;
            this.agentCtx.activeProject = project || null;
        }
        this.harnessEngine?.updateContext({
            projects,
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

        // 引用条 + @ 候选弹层 + 多行输入框（Enter 发送 / Shift+Enter 换行 / 输入法不误发）
        this.quoteBarEl = container.createDiv({ cls: 'nw-awb-quote-bar nw-awb-quote-bar-hidden' });
        this.mentionEl = container.createDiv({ cls: 'nw-awb-mention-pop nw-awb-mention-pop-hidden' });
        const inputRow = container.createDiv({ cls: 'nw-awb-input-row' });
        this.inputEl = inputRow.createEl('textarea', {
            cls: 'nw-awb-input',
            attr: {
                rows: '1',
                placeholder: '对 Agent 说点什么…（@ 引用文件，Enter 发送，Shift+Enter 换行）',
            },
        });
        this.inputEl.addEventListener('input', () => {
            this.autoGrowInput();
            this.updateMentionPopup();
        });
        this.inputEl.addEventListener('keydown', (ev: KeyboardEvent) => {
            if (this.onComposerKeydown(ev)) return;
        });
        this.inputEl.addEventListener('blur', () => {
            // 延迟关闭：点击候选时 blur 先于 click，立即关会吞掉选择
            window.setTimeout(() => this.closeMentionPopup(), 120);
        });
        const sendBtn = inputRow.createEl('button', { text: '↑', cls: 'nw-awb-send', attr: { title: '发送' } });
        sendBtn.addEventListener('click', () => void this.submit(this.inputEl?.value || ''));
    }

    /** textarea 自适应高度（1–6 行），空值时复位 */
    private autoGrowInput(): void {
        if (!this.inputEl) return;
        this.inputEl.style.height = 'auto';
        this.inputEl.style.height = `${Math.min(132, this.inputEl.scrollHeight)}px`;
    }

    /**
     * 输入框键盘处理。
     * @returns 是否已消费该按键（true 时调用方不再处理）
     */
    private onComposerKeydown(ev: KeyboardEvent): boolean {
        if (this.mentionItems.length > 0) {
            if (ev.key === 'ArrowDown') {
                ev.preventDefault();
                this.mentionIndex = (this.mentionIndex + 1) % this.mentionItems.length;
                this.renderMentionPopup();
                return true;
            }
            if (ev.key === 'ArrowUp') {
                ev.preventDefault();
                this.mentionIndex = (this.mentionIndex - 1 + this.mentionItems.length) % this.mentionItems.length;
                this.renderMentionPopup();
                return true;
            }
            if (ev.key === 'Enter' || ev.key === 'Tab') {
                if (!isImeComposing(ev)) {
                    ev.preventDefault();
                    this.acceptMention(this.mentionItems[this.mentionIndex]);
                    return true;
                }
            }
            if (ev.key === 'Escape') {
                // 组字中 Esc 应先取消输入法候选，不能顺手关掉 @ 弹层
                if (isImeComposing(ev)) return false;
                ev.preventDefault();
                this.closeMentionPopup();
                return true;
            }
        }
        if (ev.key === 'Enter' && !isImeComposing(ev) && !ev.shiftKey) {
            ev.preventDefault();
            void this.submit(this.inputEl?.value || '');
            return true;
        }
        return false;
    }

    /** 重新计算 @ 候选（光标前处于 `@` 引用中时打开弹层） */
    private updateMentionPopup(): void {
        if (!this.inputEl) return;
        const token = activeAtToken(this.inputEl.value, this.inputEl.selectionStart ?? 0);
        if (!token) {
            this.closeMentionPopup();
            return;
        }
        if (this.vaultPathCache.length === 0) {
            this.vaultPathCache = this.app.vault.getMarkdownFiles().map(file => file.path);
        }
        const items = filterVaultPaths(this.vaultPathCache, token.query, 20);
        if (items.length === 0) {
            this.closeMentionPopup();
            return;
        }
        this.mentionToken = token;
        this.mentionItems = items;
        this.mentionIndex = 0;
        this.renderMentionPopup();
    }

    private renderMentionPopup(): void {
        if (!this.mentionEl) return;
        this.mentionEl.empty();
        this.mentionEl.toggleClass('nw-awb-mention-pop-hidden', this.mentionItems.length === 0);
        this.mentionItems.forEach((path, index) => {
            const item = this.mentionEl!.createDiv({
                cls: `nw-awb-mention-item${index === this.mentionIndex ? ' is-active' : ''}`,
            });
            const slash = path.lastIndexOf('/');
            if (slash > 0) item.createSpan({ cls: 'nw-awb-mention-dir', text: path.slice(0, slash + 1) });
            item.createSpan({ cls: 'nw-awb-mention-name', text: path.slice(slash + 1) });
            // mousedown 阻止 blur，click 才拿得到输入框焦点
            item.addEventListener('mousedown', (event) => event.preventDefault());
            item.addEventListener('click', () => this.acceptMention(path));
        });
    }

    private closeMentionPopup(): void {
        this.mentionItems = [];
        this.mentionToken = null;
        this.mentionIndex = 0;
        this.mentionEl?.empty();
        this.mentionEl?.addClass('nw-awb-mention-pop-hidden');
    }

    /** 用完整路径替换光标前的 `@片段` */
    private acceptMention(path: string): void {
        if (!path) return;
        const token = this.mentionToken;
        const input = this.inputEl;
        this.closeMentionPopup();
        if (!input) return;
        const mention = `${formatFileMention(path)} `;
        if (token) {
            const before = input.value.slice(0, token.start);
            const after = input.value.slice(token.end);
            input.value = `${before}${mention}${after}`;
            const pos = before.length + mention.length;
            input.setSelectionRange(pos, pos);
        } else {
            input.value = `${input.value}${mention}`;
        }
        this.autoGrowInput();
        input.focus();
    }

    /** 设置/清除引用（发送时以「> 原话」前置） */
    private setQuote(text: string | null): void {
        this.quote = text ? { text: text.trim() } : null;
        if (!this.quoteBarEl) return;
        this.quoteBarEl.empty();
        this.quoteBarEl.toggleClass('nw-awb-quote-bar-hidden', !this.quote);
        if (!this.quote) return;
        const preview = this.quote.text.length > 160 ? `${this.quote.text.slice(0, 160)}…` : this.quote.text;
        this.quoteBarEl.createSpan({ cls: 'nw-awb-quote-mark', text: '❝' });
        this.quoteBarEl.createSpan({ cls: 'nw-awb-quote-text', text: preview });
        const clear = this.quoteBarEl.createEl('button', { text: '×', cls: 'nw-awb-quote-clear', attr: { title: '取消引用' } });
        clear.addEventListener('click', () => this.setQuote(null));
        this.inputEl?.focus();
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
        const projects = listProjectIds(this.app);
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
        // 新文件/新项目会让 @ 候选过期：下次输入时重建
        this.vaultPathCache = [];
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

    /** 审批弹窗 10 分钟无响应默认拒绝，避免整个 Agent 回合永久挂起 */
    private async withApprovalTimeout(decision: Promise<boolean>, label: string): Promise<boolean> {
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
            return await Promise.race([
                decision,
                new Promise<boolean>(resolve => {
                    timer = setTimeout(() => {
                        new Notice(`⏱️ ${label}超过 10 分钟未响应，已默认拒绝`, 8000);
                        resolve(false);
                    }, 10 * 60_000);
                }),
            ]);
        } finally {
            if (timer !== null) clearTimeout(timer);
        }
    }

    private async boot(): Promise<void> {
        const session = this.sessionSeq;
        // 清理过期 spill 存档（只动 .sessions/spill/agent 下超过 7 天的自己的文件）
        void pruneSpillArchive(this.app);
        const ctx = getAgentContext(this.app, this.plugin);
        this.agentCtx = ctx;
        this.activeProject = ctx.activeProject || this.activeProject;
        this.setModeBadge(this.plugin.hasAiCredentials);
        // 会话存档按项目分文件；切换项目后重启会话会读/写各自的档
        this.sessionStore = createAgentSessionStore(this.app, () => this.resolveActiveProject());

        // dsh 可选后端：显式开启才走；失败自动回退到内置/规则引擎
        if ((this.plugin.settings.agentBackend || 'native') === 'dsh') {
            const started = await this.bootDsh(ctx);
            if (started) return;
        }

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
                    return {
                        content: result.content,
                        error: result.error,
                        finishReason: result.finishReason,
                        usage: result.usage,
                    };
                }),
                portDeps: { port: this.port, ctx },
                // 默认 ask：覆盖已有文件前确认；显式 allow 才自动放行（用户可在设置中改）
                writeApproval: this.plugin.settings.agentWriteApproval === 'allow' ? 'allow' : 'ask',
                // 工具审批：危险工具一律询问（没有确认端口 = 拒绝）；
                // write_file 新建文件自动放行，覆盖/追加已有文件才确认。
                requestApproval: async (request) => {
                    if (request.sideEffect === 'write' && request.tool === 'write_file') {
                        const target = String(request.args.path || '').trim();
                        if (target) {
                            try {
                                if (!(await this.app.vault.adapter.exists(target))) return true;
                            } catch { /* 路径异常时走确认 */ }
                        }
                    }
                    const confirm = this.port.confirmDangerousAction;
                    if (!confirm) return false;
                    return this.withApprovalTimeout(
                        confirm.call(this.port, {
                            title: `Agent 请求执行「${request.tool}」`,
                            detail: request.reason,
                        }),
                        `Agent 审批「${request.tool}」`,
                    );
                },
                // 会话压缩（dsh compaction 思路）：30 轮触发，保留最近 12 轮
                compaction: { thresholdTurns: 30, keepTurns: 12 },
                // 大结果落盘（dsh spill）：超过 6000 字符写 .sessions/spill，日志只留定位符
                spill: createVaultSpillSink(this.app, () => this.resolveActiveProject()),
                // 窗口占用用当前模型的能力表估算（无 tokenizer，按投影字符 ÷1.5 近似）
                contextWindowTokens: findModelCapability(this.plugin.settings.defaultModel || '').maxContext,
                // 会话持久化（dsh session-persistence-jsonl）：每回合结束落盘快照
                onSessionChange: (snapshot) => this.sessionStore?.save(snapshot),
                signal: abort.signal,
            });
            try {
                this.harnessEngine = harness;
                // 有存档就先恢复历史，不再重放开场白（dsh session restore）
                const snapshot = await this.sessionStore?.load();
                if (session !== this.sessionSeq) return;
                if (snapshot && snapshot.events.length > 0) {
                    harness.restore(snapshot);
                    const history = harness.getHistory();
                    if (history.length > 0) {
                        this.renderRestoredHistory(history);
                        this.renderTelemetry();
                        this.renderPlan();
                        this.refreshSessionTitle();
                        return;
                    }
                }
                const outcome = await harness.start();
                // 启动期间会话已被重启/关闭：旧问候不得写进新会话
                if (session !== this.sessionSeq) return;
                this.renderOutcome(outcome);
                this.refreshSessionTitle();
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

    /**
     * 启动 dsh 后端（D）。返回 false 表示未启用/失败，调用方继续走 native。
     *
     * 写入语义：协议没有逐次审批，只能整会话 read-only 或 workspace-write；
     * 选择写入时先弹一次确认（用户已了解范围是整个 vault）。
     */
    private async bootDsh(ctx: ReturnType<typeof getAgentContext>): Promise<boolean> {
        if (Platform.isMobile) {
            showWarningNotice('dsh 后端仅支持桌面端，已回退到内置 Agent', { timeout: 6000 });
            return false;
        }
        try {
            const adapter = this.app.vault.adapter as unknown as {
                getBasePath?: () => string;
                exists?: (path: string) => Promise<boolean>;
                mkdir?: (path: string) => Promise<void>;
                write?: (path: string, data: string) => Promise<void>;
            };
            const base = adapter.getBasePath?.() || '';
            if (!base) {
                showErrorNotice('无法获取 vault 路径，dsh 后端不可用', { timeout: 6000 });
                return false;
            }
            const pluginDir = this.plugin.manifest.dir || `${this.app.vault.configDir}/plugins/novel-writer-ai`;
            const relHome = `${pluginDir}/data/dsh`;
            const home = `${base}/${relHome}`;
            if (adapter.exists && adapter.mkdir && !(await adapter.exists(relHome))) {
                await adapter.mkdir(relHome);
            }

            let allowWrite = this.plugin.settings.dshAllowVaultWrite === true;
            if (allowWrite) {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: 'dsh 将可写入整个 vault',
                    description: 'DeepSeek Harness 的 SDK 协议没有逐次审批通道。确认后，本次会话可以修改 vault 内任何笔记。',
                    warning: '建议先在测试库试用；只读模式下 dsh 不会写入任何文件。',
                    confirmText: '仍要允许写入',
                    cancelText: '改为只读',
                });
                allowWrite = await this.withApprovalTimeout(Promise.resolve(confirmed), 'dsh 写入确认');
            }
            const sandbox = allowWrite ? 'workspace-write' : 'read-only';
            const patchPath = `${home}/sandbox.yml`;
            if (adapter.write) await adapter.write(`${relHome}/sandbox.yml`, buildSandboxPatch(sandbox, base));

            // 口令锁定时 settings.apiKey 可能是 aes256... 密文；必须解密后再注入子进程。
            let dshApiKey = this.plugin.settings.apiKey || '';
            if (dshApiKey) {
                try {
                    dshApiKey = await this.plugin.decryptKey(dshApiKey);
                } catch (e) {
                    showErrorNotice(e instanceof Error ? e.message : String(e), { title: '无法解锁 dsh 所需 API Key', timeout: 8000 });
                    return false;
                }
                // decryptKey 在用户取消/口令错误时会原样返回密文；不能把密文当 Key 注入。
                if (dshApiKey.startsWith('aes256v2:') || dshApiKey.startsWith('aes256:')) {
                    new Notice('Dsh 需要可读取的 API key：请先在设置中解锁密钥口令', 8000);
                    return false;
                }
            }
            const plan = buildDshLaunchPlan({
                home,
                workspace: base,
                sandbox,
                sandboxPatchPath: patchPath,
                packageVersion: this.plugin.settings.dshVersion,
                apiKey: dshApiKey,
                env: {
                    PATH: (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.PATH || '',
                    Path: (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.Path || '',
                    HOME: (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.HOME || '',
                },
            });
            const transport = await createDshProcessTransport(plan, {
                cwd: base,
                isDesktop: true,
                passthroughEnv: {
                    PATH: (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.PATH || '',
                    Path: (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.Path || '',
                },
            });
            const sessionId = `nw-${ctx.activeProject || 'default'}-${Date.now()}`;
            const dsh = new DshSession({
                transport,
                sessionId,
                sink: {
                    onAssistantText: text => this.dshTurnCollector?.texts.push(text),
                    onToolResult: result => this.dshTurnCollector?.tools.push({
                        tool: result.name || 'tool',
                        ok: result.ok,
                        summary: result.text.slice(0, 300),
                    }),
                    onStderr: line => console.warn('[dsh]', line),
                },
            });
            await dsh.initialize({
                cwd: base,
                provider: this.plugin.settings.dshProvider || 'deepseek-official',
                model: this.plugin.settings.dshModel || this.plugin.settings.defaultModel || 'deepseek-chat',
                maxTokens: 4000,
            });
            this.dshSession = dsh;
            if (this.modeBadgeEl) {
                this.modeBadgeEl.setText(`🐋 dsh · ${sandbox === 'read-only' ? '只读' : '可写'}`);
                this.modeBadgeEl.addClass('is-ai');
            }
            this.appendSystemNote(
                `已连接 DeepSeek Harness（${sandbox === 'read-only' ? '只读' : '可写'}）。`
                + '会话由 dsh 自行持久化；点关闭/重启会终止进程。',
            );
            return true;
        } catch (e) {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: 'dsh 启动失败，已回退到内置 Agent', timeout: 8000 });
            this.dshSession?.close();
            this.dshSession = null;
            return false;
        }
    }

    private async runDshTurn(text: string, session: number): Promise<void> {
        const dsh = this.dshSession;
        if (!dsh) return;
        this.dshTurnCollector = { texts: [], tools: [] };
        this.showTyping();
        try {
            await dsh.prompt(text);
            await dsh.waitForIdle(this.plugin.settings.dshTurnTimeoutMs || 180_000);
            if (session !== this.sessionSeq) return;
            const collected = this.dshTurnCollector;
            this.dshTurnCollector = null;
            this.hideTyping();
            this.renderOutcome({
                messages: (collected?.texts.length ? collected.texts : ['（dsh 没有返回可见回复）'])
                    .map(item => ({ role: 'agent' as const, text: item })),
                chips: [],
                done: true,
                usedAi: true,
                degraded: false,
                toolCalls: collected?.tools || [],
            });
        } catch (e) {
            if (session !== this.sessionSeq) return;
            this.hideTyping();
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: 'dsh 回合失败', timeout: 8000 });
        } finally {
            if (session === this.sessionSeq) this.dshTurnCollector = null;
        }
    }

    private async switchToRuleEngine(): Promise<void> {
        this.harnessEngine = null;
        // 降级时沿用工作台自己的当前项目：getAgentContext 读的是插件活动文件，
        // 可能与用户在左栏选的项目不一致，后续创建/打开会作用到错误项目。
        const ctx = getAgentContext(this.app, this.plugin);
        if (this.activeProject) ctx.activeProject = this.activeProject;
        this.agentCtx = ctx;
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

    /** 会话标题（首条用户消息前 30 字） */
    private refreshSessionTitle(): void {
        if (!this.sessionTitleEl) return;
        const title = this.harnessEngine?.getSessionTitle() || '';
        this.sessionTitleEl.setText(title ? `· ${title}` : '');
        this.sessionTitleEl.toggleClass('nw-awb-session-title-empty', !title);
    }

    /** 回填存档里的历史（dsh session restore）：只重放用户/助手气泡，工具行省略 */
    private renderRestoredHistory(history: Array<{ role: 'user' | 'agent'; text: string }>): void {
        if (!this.messagesEl) return;
        this.messagesEl.empty();
        for (const item of history) {
            if (item.role === 'user') this.renderUserBubble(item.text);
            else this.renderMessage({ role: 'agent', text: item.text });
        }
        this.appendSystemNote(`已恢复上次会话（${history.length} 条消息）。点「🆕 新会话」可清空重来。`);
        this.scrollToEnd();
    }

    /** 「新会话」：清空本项目存档并重建引擎（spill 存档不在此列） */
    private async startNewSession(): Promise<void> {
        if (this.busy) {
            new Notice('当前回合仍在执行，请稍后再开新会话', 3000);
            return;
        }
        await this.sessionStore?.clear();
        this.setQuote(null);
        this.resetComposer();
        this.lastUserText = '';
        await this.restart();
    }

    /**
     * 提交一次用户输入。
     * source='input' 表示键盘/发送按钮（可清空草稿）；chip/项目卡点击不清草稿，
     * 否则用户正在写的半句话会被静默丢弃。
     */
    private async submit(raw: string, source: 'input' | 'chip' | 'project' = 'input'): Promise<void> {
        let text = raw.trim();
        if (!text) return;

        // 引用消息：以「> 原话」前置（只作用于手输，chip/项目卡点击不带上旧引用）
        const isCommandToken = text === '__retry__' || text === '__fallback_rule__';
        if (this.quote && source === 'input' && !isCommandToken) {
            text = `> ${this.quote.text.slice(0, 600)}\n\n${text}`;
            this.setQuote(null);
        }

        // 控制令牌不上屏、不写进会话历史（旧实现把 __retry__/__fallback_rule__ 当用户消息）
        if (text === '__fallback_rule__') {
            if (this.inputEl) this.resetComposer();
            // 回合进行中切离线：先中止 harness 回合，否则它会继续跑完剩余步骤
            this.turnAbort?.abort();
            this.dshSession?.close();
            this.dshSession = null;
            await this.switchToRuleEngine();
            return;
        }
        if (text === '__retry__') {
            if (this.busy) return;
            if (this.inputEl) this.resetComposer();
            await this.retryLastTurn();
            return;
        }

        if (this.busy) {
            // 回合进行中：补充消息进入收件箱（吸收 dsh steering），
            // 模型下一步就能看到，不必等整轮结束，也不打断当前工具链。
            // 补充消息同样带上 @ 引用清单，否则模型看不到用户刚引用的文件。
            const steerBlock = buildMentionBlock(extractMentionPaths(text));
            const accepted = this.harnessEngine?.steer(steerBlock ? `${text}\n\n${steerBlock}` : text) ?? false;
            if (accepted) {
                if (source === 'input' && this.inputEl) this.resetComposer();
                this.pushUser(stripMentionMarkers(text));
                this.appendSystemNote('已插入当前回合，模型下一步会看到');
            } else {
                new Notice('当前回合仍在执行，请稍后再发', 2500);
            }
            return;
        }

        if (source === 'input' && this.inputEl) this.resetComposer();
        // @ 引用：气泡只显示用户输入，引擎收到「输入 + 引用文件清单」（内容仍按需 read_file）
        const mentionBlock = buildMentionBlock(extractMentionPaths(text));
        const payload = mentionBlock ? `${text}\n\n${mentionBlock}` : text;
        this.pushUser(stripMentionMarkers(text));
        this.lastUserText = payload;
        await this.runTurn(payload);
    }

    /** 清空输入框并复位高度/候选弹层 */
    private resetComposer(): void {
        if (!this.inputEl) return;
        this.inputEl.value = '';
        this.closeMentionPopup();
        this.autoGrowInput();
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
            if (this.dshSession) {
                await this.runDshTurn(text, session);
                return;
            }
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
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: '对话处理失败', timeout: 6000 });
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
        this.refreshSessionTitle();
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
        // 引用这条消息（dsh message-quotes）：悬停出现，点击后输入框上方显示引用条
        const quoteBtn = row.createEl('button', {
            text: '❝',
            cls: 'nw-awb-quote-btn',
            attr: { title: '引用这条消息（发送时作为引文前置）' },
        });
        quoteBtn.addEventListener('click', () => this.setQuote(message.text));
    }

    private pushUser(text: string): void {
        this.renderUserBubble(text);
        this.renderChips([]);
        this.scrollToEnd();
    }

    /** 用户气泡（新消息与恢复历史共用） */
    private renderUserBubble(text: string): void {
        if (!this.messagesEl) return;
        const row = this.messagesEl.createDiv({ cls: 'nw-awb-row nw-awb-row-user' });
        row.createDiv({ cls: 'nw-awb-bubble', text });
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
            contextTokens: 0, windowUsage: 0, spilledResults: 0, spilledChars: 0,
            modelSteps: 0, toolMs: 0, trimmedTurns: 0, compactionCalls: 0, promptTokens: 0, completionTokens: 0,
        };

        // 遥测网格：复用既有的 grid 容器
        const grid = this.telemetryEl.querySelector('[data-nw-awb-telemetry-grid]');
        if (grid) {
            grid.empty();
            const cells: Array<[string, string]> = [
                ['轮次', String(telemetry.turns)],
                ['模型调用', String(telemetry.modelCalls)],
                ['模型步数', String(telemetry.modelSteps)],
                ['工具调用', `${telemetry.toolOk}/${telemetry.toolCalls}`],
                ['失败', String(telemetry.toolFail)],
                ['工具耗时', telemetry.toolMs > 0 ? `${(telemetry.toolMs / 1000).toFixed(1)}s` : '0'],
                ['裁剪', telemetry.trimmedTurns > 0 ? `${telemetry.trimmedTurns} 轮` : '0'],
                // dsh token-meter / pruner 的可观测化：裁剪与压缩省下的上下文
                ['省字符', telemetry.prunedChars > 0 ? `${Math.round(telemetry.prunedChars / 1000)}k` : '0'],
                ['压缩', telemetry.compactionCalls > 0 ? `${telemetry.compactions}（${telemetry.compactionCalls} 次）` : String(telemetry.compactions)],
                // v4.20 dsh token-meter：会话上下文规模与窗口占用
                ['上下文', telemetry.contextTokens > 0 ? `~${Math.round(telemetry.contextTokens / 1000)}k` : '0'],
                ['窗口', telemetry.windowUsage > 0 ? `${Math.round(telemetry.windowUsage * 100)}%` : '—'],
                ['落盘', telemetry.spilledResults > 0 ? `${telemetry.spilledResults} 条 / 省 ${Math.round(telemetry.spilledChars / 1000)}k` : '0'],
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
