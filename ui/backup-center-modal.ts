/**
 * backup-center-modal.ts — 版本与备份中心
 *
 * 聚合 `_versions/` 版本快照、步骤/结算产物与插件配置备份；
 * 版本条目可直接回滚（当前内容自动存为 rollback 版本）。
 */
import { App, Modal, Notice, TFile } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { listProjectIds } from '@/shared/project-catalog';
import { projectDisplayName } from '@/domains/kernel/project-locator';
import { ENGINE_NAMES } from '@/shared/engine-names';
import { collectBackupCenter, type BackupCenterEntry, type BackupCenterReport } from '@/services/backup-center-service';
import type { ChapterVersionService } from '@/services/chapter-version-service';
import { ChapterVersionModal } from './chapter-version-modal';
import { OperationConfirmModal } from './components/progress';

const KIND_LABEL: Record<BackupCenterEntry['kind'], string> = {
    version: '🗂 版本快照',
    'step-result': '🧾 步骤/结算产物',
    'settings-backup': '⚙️ 配置备份',
};

const KIND_ORDER: BackupCenterEntry['kind'][] = ['version', 'step-result', 'settings-backup'];

/**
 * 版本与备份中心弹窗。
 */
export class BackupCenterModal extends Modal {
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

    /** 打开并加载。 */
    onOpen(): void {
        this.modalEl.addClass('nw-scope', 'nw-modal');
        this.titleEl.setText('🗂 版本与备份中心');
        this.contentEl.empty();
        this.contentEl.addClass('nw-backup-center');
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
            empty.createDiv({ cls: 'nw-empty-state-icon', text: '🗂' });
            empty.createDiv({ cls: 'nw-empty-state-title', text: '还没有项目' });
            empty.createDiv({ cls: 'nw-empty-state-description', text: '版本与备份按项目组织；先创建一个项目。' });
            this.loading = false;
            return;
        }
        const loading = this.bodyEl.createDiv({ cls: 'nw-unit-loading', text: '正在扫描版本与备份…' });
        try {
            const report = await collectBackupCenter(this.app, this.project);
            loading.remove();
            this.render(report);
        } catch (error) {
            loading.remove();
            const box = this.bodyEl.createDiv({ cls: 'nw-flow-error' });
            box.createDiv({ cls: 'nw-flow-error-title', text: '备份扫描失败' });
            box.createDiv({ cls: 'nw-flow-error-detail', text: error instanceof Error ? error.message : String(error) });
        } finally {
            this.loading = false;
        }
    }

    private render(report: BackupCenterReport): void {
        if (!this.bodyEl) return;
        const head = this.bodyEl.createDiv({ cls: 'nw-project-health-head' });
        head.createEl('h3', { text: `《${projectDisplayName(report.project)}》` });
        head.createSpan({ cls: 'nw-project-health-meta', text: `回滚记录 ${report.rollbackCount} 条` });
        const refresh = head.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '刷新' });
        refresh.addEventListener('click', () => { void this.load(); });

        const summary = this.bodyEl.createDiv({ cls: 'nw-project-health-summary' });
        for (const kind of KIND_ORDER) {
            const chip = summary.createDiv({ cls: 'nw-project-health-chip' });
            chip.createSpan({ text: KIND_LABEL[kind].replace(/^\S+\s/, '') });
            chip.createEl('strong', { text: String(report.summary[kind]) });
        }

        if (report.entries.length === 0) {
            const empty = this.bodyEl.createDiv({ cls: 'nw-empty-state' });
            empty.createDiv({ cls: 'nw-empty-state-icon', text: '🗂' });
            empty.createDiv({ cls: 'nw-empty-state-title', text: '暂无版本与备份' });
            empty.createDiv({ cls: 'nw-empty-state-description', text: '保存版本、跑完步骤或触发设置迁移后，这里会出现可追溯的历史。' });
            return;
        }

        for (const kind of KIND_ORDER) {
            const entries = report.entries.filter(entry => entry.kind === kind);
            if (entries.length === 0) continue;
            const section = this.bodyEl.createDiv({ cls: 'nw-asset-kind' });
            section.createEl('h4', { text: `${KIND_LABEL[kind]}（${entries.length}）` });
            const list = section.createDiv({ cls: 'nw-asset-list' });
            for (const entry of entries.slice(0, 60)) this.renderEntry(list, entry);
        }
    }

    private renderEntry(host: HTMLElement, entry: BackupCenterEntry): void {
        const row = host.createDiv({ cls: 'nw-asset-row' });
        const main = row.createDiv({ cls: 'nw-asset-row-main' });
        main.createSpan({ cls: 'nw-asset-name', text: entry.label });
        if (entry.updatedAt) {
            main.createSpan({ cls: 'nw-asset-version', text: new Date(entry.updatedAt).toLocaleString() });
        }
        row.createDiv({ cls: 'nw-asset-impact', text: entry.detail });

        const open = row.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '打开' });
        open.addEventListener('click', () => {
            const file = this.app.vault.getAbstractFileByPath(entry.path);
            if (file instanceof TFile) {
                void this.app.workspace.getLeaf(false).openFile(file);
                this.close();
            } else {
                new Notice(`文件不存在或不可索引：${entry.path}`);
            }
        });

        if (entry.version) {
            const rollback = row.createEl('button', { cls: 'nw-btn nw-btn-primary', text: '回滚' });
            rollback.addEventListener('click', () => { void this.rollback(entry); });

            const history = row.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '📜 历史' });
            history.addEventListener('click', () => { void this.openVersionHistory(entry); });
        }
    }

    private async rollback(entry: BackupCenterEntry): Promise<void> {
        const version = entry.version;
        if (!version?.sourcePath) return;
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: `回滚到 ${version.contentKey} v${version.version}`,
            description: '当前内容会自动保存为一个 rollback 版本，然后再写入目标版本。',
            warning: '回滚会覆盖当前文件内容；如需保留请先手动保存版本。',
            confirmText: '继续回滚',
            cancelText: '取消',
        });
        if (!confirmed) return;
        const service = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.CHAPTER_VERSION_SERVICE)
            ?? null as ChapterVersionService | null;
        if (!service) {
            new Notice('版本服务未初始化，请重启插件后再试', 6000);
            return;
        }
        try {
            const current = await this.app.vault.adapter.read(version.sourcePath);
            const result = await service.rollbackToVersion(version, current);
            if (!result.success) {
                new Notice('回滚失败：写入被拒绝', 6000);
                return;
            }
            new Notice(`✅ 已回滚到 v${version.version}（当前内容已自动备份）`, 5000);
            this.close();
        } catch (error) {
            new Notice(`回滚失败：${error instanceof Error ? error.message : String(error)}`, 8000);
        }
    }

    /**
     * 打开版本历史弹窗（复用 ChapterVersionModal），支持版本对比与恢复。
     *
     * 读取 sourcePath 当前内容作为对比基准；回滚/保存版本均以落盘的最新内容为准，
     * 回滚成功后刷新备份列表。
     *
     * @param entry - 备份中心条目（须包含 version 元数据）
     */
    private async openVersionHistory(entry: BackupCenterEntry): Promise<void> {
        const version = entry.version;
        if (!version?.sourcePath) return;
        const service = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.CHAPTER_VERSION_SERVICE)
            ?? null as ChapterVersionService | null;
        if (!service) {
            new Notice('版本服务未初始化，请重启插件后再试', 6000);
            return;
        }
        let current: string;
        try {
            current = await this.app.vault.adapter.read(version.sourcePath);
        } catch (error) {
            new Notice(`读取当前文件失败：${error instanceof Error ? error.message : String(error)}`, 8000);
            return;
        }
        new ChapterVersionModal(this.app, {
            project: version.project,
            contentType: version.contentType,
            contentKey: version.contentKey,
            sourcePath: version.sourcePath,
            currentContent: current,
            onRollback: async (v) => {
                try {
                    const latest = await this.app.vault.adapter.read(version.sourcePath);
                    const result = await service.rollbackToVersion(v, latest);
                    if (!result.success) {
                        throw new Error('写入被拒绝');
                    }
                    new Notice(`✅ 已回滚到 v${v.version}（当前内容已自动备份）`, 5000);
                    await this.load();
                } catch (error) {
                    new Notice(`回滚失败：${error instanceof Error ? error.message : String(error)}`, 8000);
                    throw error;
                }
            },
            onSaveVersion: async () => {
                try {
                    const latest = await this.app.vault.adapter.read(version.sourcePath);
                    return await service.saveVersion(
                        version.project,
                        version.contentType,
                        version.contentKey,
                        version.sourcePath,
                        latest,
                        { type: 'manual' },
                    );
                } catch (error) {
                    new Notice(`保存版本失败：${error instanceof Error ? error.message : String(error)}`, 8000);
                    return null;
                }
            },
        }, this.plugin.engineRegistry).open();
    }
}
