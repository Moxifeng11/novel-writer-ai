/**
 * quick-tools-panel.ts — 常驻快捷工具面板
 *
 * 取代「点按钮 → 弹窗」的隐藏式入口：项目页右侧、章节页标题栏都直接内联渲染
 * 分类工具，用户一眼可见、一步可用。
 */
import { setIcon } from 'obsidian';
import { TOOL_GROUPS, type ToolButton, type ToolGroup } from './tool-catalog';

export interface ProjectQuickAction {
    label: string;
    icon: string;
    desc?: string;
    primary?: boolean;
    onClick: () => void;
}

export interface QuickToolsPanelOptions {
    executeCommand: (commandId: string) => void;
    /** 当前选中的项目（用于展示项目级快捷操作） */
    project?: string | null;
    projectActions?: ProjectQuickAction[];
    /** 只展示指定工具（章节页高频工具条）；为空则展示全部分组 */
    tools?: ToolButton[];
    /** 按项目类型切换的工具目录；为空时使用长篇全量目录 */
    toolGroups?: ToolGroup[];
    /** 面板标题，默认「⚡ 快捷工具」 */
    title?: string;
    subtitle?: string;
    /** 紧凑模式：单行图标条，用于标题栏 */
    compact?: boolean;
    /** 点击工具后的额外回调（例如刷新页面） */
    onCommandExecuted?: (commandId: string) => void;
}

function renderToolButton(
    parent: HTMLElement,
    tool: ToolButton,
    opts: QuickToolsPanelOptions
): void {
    const btn = parent.createEl('button', {
        cls: opts.compact ? 'nw-qt-chip' : 'nw-qt-tool',
        attr: { title: `${tool.label}\n${tool.desc}` },
    });
    btn.type = 'button';

    const iconEl = btn.createSpan({ cls: opts.compact ? 'nw-qt-chip-icon' : 'nw-qt-tool-icon' });
    // setIcon 需要合法图标名；emoji 直接作为文本渲染更稳
    if (/^[a-z-]+$/.test(tool.icon)) {
        setIcon(iconEl, tool.icon);
    } else {
        iconEl.setText(tool.icon);
    }

    btn.createSpan({ text: tool.label, cls: opts.compact ? 'nw-qt-chip-label' : 'nw-qt-tool-label' });

    btn.onclick = (e) => {
        e.stopPropagation();
        // 防重入：连点会并发执行同一条命令（打开多个弹窗 / 重复发起 AI 请求）
        if (btn.disabled) return;
        btn.disabled = true;
        btn.addClass('is-executing');
        try {
            opts.executeCommand(tool.commandId);
            opts.onCommandExecuted?.(tool.commandId);
        } finally {
            // 命令是 fire-and-forget（异步打开弹窗）：短暂冷却即可挡住双击/连点
            window.setTimeout(() => {
                btn.disabled = false;
                btn.removeClass('is-executing');
            }, 400);
        }
    };
}

function renderProjectActions(parent: HTMLElement, opts: QuickToolsPanelOptions): void {
    if (!opts.project || !opts.projectActions || opts.projectActions.length === 0) return;

    const section = parent.createDiv({ cls: 'nw-qt-project' });
    const head = section.createDiv({ cls: 'nw-qt-project-head' });
    head.createSpan({ text: `📖 ${opts.project}`, cls: 'nw-qt-project-name' });

    const grid = section.createDiv({ cls: 'nw-qt-project-actions' });
    for (const action of opts.projectActions) {
        const btn = grid.createEl('button', {
            cls: `nw-qt-action${action.primary ? ' is-primary' : ''}`,
            attr: { title: action.desc || action.label },
        });
        btn.type = 'button';
        btn.createSpan({ text: action.icon, cls: 'nw-qt-action-icon' });
        btn.createSpan({ text: action.label, cls: 'nw-qt-action-label' });
        btn.onclick = (e) => {
            e.stopPropagation();
            action.onClick();
        };
    }
}

/**
 * 在容器内渲染常驻工具面板。
 * @param container - 容器元素
 * @param opts - 选项
 */
export function renderQuickToolsPanel(container: HTMLElement, opts: QuickToolsPanelOptions): void {
    const panel = container.createDiv({
        cls: opts.compact ? 'nw-quick-tools is-compact' : 'nw-quick-tools',
    });

    if (!opts.compact) {
        const header = panel.createDiv({ cls: 'nw-qt-header' });
        header.createDiv({ text: opts.title || '⚡ 快捷工具', cls: 'nw-qt-title' });
        header.createDiv({ text: opts.subtitle || '分类功能，一步直达', cls: 'nw-qt-subtitle' });
    }

    renderProjectActions(panel, opts);

    if (opts.tools && opts.tools.length > 0) {
        const row = panel.createDiv({ cls: 'nw-qt-chip-row' });
        for (const tool of opts.tools) renderToolButton(row, tool, opts);
        return;
    }

    const groups: ToolGroup[] = opts.toolGroups ?? TOOL_GROUPS;
    for (const group of groups) {
        const collapsed = Boolean(group.defaultCollapsed);
        const groupEl = panel.createDiv({ cls: `nw-qt-group${collapsed ? ' is-collapsed' : ''}` });
        const head = groupEl.createEl('button', {
            cls: 'nw-qt-group-title',
            attr: { type: 'button', 'aria-expanded': String(!collapsed) },
        });
        head.createSpan({ text: group.label, cls: 'nw-qt-group-label' });
        head.createSpan({ text: String(group.buttons.length), cls: 'nw-qt-group-count' });
        head.createSpan({ text: '▾', cls: 'nw-qt-group-caret' });
        head.onclick = (e) => {
            e.stopPropagation();
            const next = !groupEl.classList.contains('is-collapsed');
            groupEl.classList.toggle('is-collapsed', next);
            head.setAttribute('aria-expanded', String(!next));
        };
        const grid = groupEl.createDiv({ cls: 'nw-qt-tool-grid' });
        for (const tool of group.buttons) renderToolButton(grid, tool, opts);
    }
}
