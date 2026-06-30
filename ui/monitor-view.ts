import { ItemView, WorkspaceLeaf } from 'obsidian';
import { ContextPanel } from './rendering/context-panel';
import { GatheredContext } from '../engine/context-manager';
import type { NovelWriterPluginAPI } from '../shared/plugin-api';

export const VIEW_TYPE_MONITOR = 'novel-writer-monitor';

/**
 * 上下文监控侧栏视图（v5.2 拆窗）。
 * 将原三联式中的「上下文监控」面板独立到右侧栏 leaf，
 * 让主区正文写作获得更大宽度、信息密度更合理。
 *
 * 数据由 FullWriterView 通过 setData(...) 推送，本视图只负责渲染。
 */
export class NovelMonitorView extends ItemView {
    private plugin: NovelWriterPluginAPI;
    private panel: ContextPanel;

    // 由 FullWriterView 推送的渲染数据
    private context: GatheredContext | null = null;
    private project = '';
    private chapterNum = 0;
    private estimateTotalChars: () => number = () => 0;
    private bodyEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPluginAPI) {
        super(leaf);
        this.plugin = plugin;
        this.panel = new ContextPanel(this.app);
    }

    getViewType(): string {
        return VIEW_TYPE_MONITOR;
    }

    getDisplayText(): string {
        return '上下文监控';
    }

    getIcon(): string {
        return 'gauge';
    }

    async onOpen(): Promise<void> {
        const root = this.containerEl.children[1] as HTMLElement;
        root.empty();
        root.addClass('novel-writer-monitor-view');
        this.bodyEl = root.createDiv({ cls: 'novel-writer-monitor-body' });
        this.renderBody();
    }

    async onClose(): Promise<void> {
        this.bodyEl = null;
    }

    /** 由 FullWriterView 推送最新数据并触发重渲染 */
    public setData(
        context: GatheredContext | null,
        project: string,
        chapterNum: number,
        estimateTotalChars: () => number,
    ): void {
        this.context = context;
        this.project = project;
        this.chapterNum = chapterNum;
        this.estimateTotalChars = estimateTotalChars;
        this.renderBody();
    }

    private renderBody(): void {
        if (!this.bodyEl) return;
        this.bodyEl.empty();
        if (!this.project) {
            this.bodyEl.createDiv({
                cls: 'novel-writer-monitor-empty',
                text: '打开「创作工作台」并加载章节后，这里会显示上下文监控。',
            });
            return;
        }
        try {
            this.panel.render(
                this.bodyEl,
                this.context,
                this.project,
                this.chapterNum,
                this.plugin,
                this.estimateTotalChars,
            );
        } catch (e) {
            console.warn('[小说工坊] 监控面板渲染异常:', e);
            this.bodyEl.createDiv({ cls: 'novel-writer-fw-warning', text: '⚠️ 上下文面板渲染失败' });
        }
    }
}
