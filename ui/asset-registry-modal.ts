/**
 * asset-registry-modal.ts — 资产总览
 *
 * 只读展示当前项目的写作资产：规则、提示词模板、文笔指纹、知识库、写作配置，
 * 以及每个资产的来源/版本/是否生效。修改仍去各自的设置页/视图。
 */
import { App, Modal, Notice, TFile } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { listProjectIds } from '@/shared/project-catalog';
import { projectDisplayName } from '@/domains/kernel/project-locator';
import { collectAssetRegistry, type AssetEntry, type AssetKind, type AssetRegistryReport } from '@/engine/asset-registry';
import { StyleFingerprintLibrary } from '@/engine/style-fingerprint-library';

const KIND_LABEL: Record<AssetKind, string> = {
    rules: '📜 写作规则',
    'prompt-template': '🧠 提示词模板',
    'style-fingerprint': '🖌 文笔指纹',
    'knowledge-book': '📚 知识库',
    'writing-profile': '🎛 写作配置',
};

const KIND_ORDER: AssetKind[] = ['rules', 'prompt-template', 'style-fingerprint', 'knowledge-book', 'writing-profile'];

/**
 * 资产总览弹窗。
 */
export class AssetRegistryModal extends Modal {
    private readonly plugin: NovelWriterPlugin;
    private readonly project: string;
    private bodyEl: HTMLElement | null = null;
    private loading = false;

    /**
     * @param app - Obsidian 应用实例
     * @param plugin - 插件实例
     * @param project - 项目 ID；空时取当前项目或第一个项目
     */
    constructor(app: App, plugin: NovelWriterPlugin, project?: string) {
        super(app);
        this.plugin = plugin;
        this.project = project || plugin.getActiveProject() || listProjectIds(app)[0] || '';
    }

    /** 打开并加载资产清单。 */
    onOpen(): void {
        this.modalEl.addClass('nw-scope', 'nw-modal');
        this.titleEl.setText('🧩 资产总览');
        this.contentEl.empty();
        this.contentEl.addClass('nw-asset-registry');
        this.bodyEl = this.contentEl.createDiv();
        void this.load();
    }

    /** 关闭时清空。 */
    onClose(): void {
        this.contentEl.empty();
    }

    private async load(): Promise<void> {
        if (!this.bodyEl || this.loading) return;
        this.loading = true;
        this.bodyEl.empty();
        if (!this.project) {
            const empty = this.bodyEl.createDiv({ cls: 'nw-empty-state' });
            empty.createDiv({ cls: 'nw-empty-state-icon', text: '🧩' });
            empty.createDiv({ cls: 'nw-empty-state-title', text: '还没有项目' });
            empty.createDiv({ cls: 'nw-empty-state-description', text: '资产总览按项目展示生效来源；先创建一个项目。' });
            this.loading = false;
            return;
        }
        const loading = this.bodyEl.createDiv({ cls: 'nw-unit-loading', text: '正在收集资产…' });
        try {
            const report = await collectAssetRegistry(this.app, this.project, {
                promptManager: this.plugin.promptManager ?? null,
                knowledgeBaseManager: this.plugin.knowledgeBaseManager ?? null,
                fingerprintLibrary: StyleFingerprintLibrary.get(this.app, this.project),
            });
            loading.remove();
            this.render(report);
        } catch (error) {
            loading.remove();
            const box = this.bodyEl.createDiv({ cls: 'nw-flow-error' });
            box.createDiv({ cls: 'nw-flow-error-title', text: '资产收集失败' });
            box.createDiv({ cls: 'nw-flow-error-detail', text: error instanceof Error ? error.message : String(error) });
        } finally {
            this.loading = false;
        }
    }

    private render(report: AssetRegistryReport): void {
        if (!this.bodyEl) return;
        const head = this.bodyEl.createDiv({ cls: 'nw-project-health-head' });
        head.createEl('h3', { text: `《${projectDisplayName(report.project)}》` });
        const refresh = head.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '刷新' });
        refresh.addEventListener('click', () => { void this.load(); });

        const summary = this.bodyEl.createDiv({ cls: 'nw-project-health-summary' });
        for (const kind of KIND_ORDER) {
            const chip = summary.createDiv({ cls: 'nw-project-health-chip' });
            chip.createSpan({ text: KIND_LABEL[kind].replace(/^\S+\s/, '') });
            chip.createEl('strong', { text: String(report.summary[kind]) });
        }

        if (report.effective.length > 0) {
            const effective = this.bodyEl.createDiv({ cls: 'nw-asset-effective' });
            effective.createEl('h4', { text: '当前生效' });
            for (const line of report.effective.slice(0, 24)) {
                effective.createDiv({ cls: 'nw-asset-effective-row', text: line });
            }
        }

        for (const kind of KIND_ORDER) {
            const entries = report.entries.filter(entry => entry.kind === kind);
            if (entries.length === 0) continue;
            this.renderKind(this.bodyEl, kind, entries);
        }
    }

    private renderKind(host: HTMLElement, kind: AssetKind, entries: AssetEntry[]): void {
        const section = host.createDiv({ cls: 'nw-asset-kind' });
        section.createEl('h4', { text: `${KIND_LABEL[kind]}（${entries.length}）` });
        const list = section.createDiv({ cls: 'nw-asset-list' });
        for (const entry of entries) this.renderEntry(list, entry);
    }

    private renderEntry(host: HTMLElement, entry: AssetEntry): void {
        const row = host.createDiv({ cls: `nw-asset-row${entry.enabled ? '' : ' nw-is-muted'}` });
        const main = row.createDiv({ cls: 'nw-asset-row-main' });
        main.createSpan({ cls: 'nw-asset-name', text: entry.name });
        main.createSpan({ cls: 'nw-asset-source', text: entry.source });
        if (entry.version) main.createSpan({ cls: 'nw-asset-version', text: `v${entry.version}` });
        main.createSpan({
            cls: `nw-asset-state ${entry.enabled ? 'nw-is-on' : 'nw-is-off'}`,
            text: entry.enabled ? '生效' : '未生效',
        });
        row.createDiv({ cls: 'nw-asset-impact', text: entry.impact });
        if (entry.path) {
            const open = row.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '打开' });
            open.addEventListener('click', () => {
                const file = this.app.vault.getAbstractFileByPath(entry.path!);
                if (file instanceof TFile) {
                    void this.app.workspace.getLeaf(false).openFile(file);
                    this.close();
                } else {
                    new Notice(`文件不存在：${entry.path}`);
                }
            });
        }
    }
}
