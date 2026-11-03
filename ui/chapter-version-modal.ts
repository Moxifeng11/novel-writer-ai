/**
 * chapter-version-modal.ts — 版本对比与回滚模态框
 *
 * 功能：
 * - 左侧：版本列表（时间倒序）
 * - 右侧：diff 对比视图（并排/行内模式切换）
 * - 支持字符级 diff 高亮
 * - 显示统计信息
 * - 回滚到指定版本
 */
import { Modal, Setting, Notice, ButtonComponent } from 'obsidian';
import type { App } from 'obsidian';
import { ChapterVersionService } from '@/services/chapter-version-service';
import { ENGINE_NAMES } from '@/shared/engine-names';
import type { EngineRegistry } from '@/engine/engine-registry';
import type { VersionMeta, ContentType, DiffStats, LineDiff } from '@/shared/version-types';
import {
    formatVersionTime,
    VERSION_TYPE_LABELS,
    CONTENT_TYPE_LABELS,
    lineDiff,
    computeDiffStats,
    charDiff,
} from '@/shared/diff-utils';
import { createEmptyState } from './components/empty-state';

type DiffViewMode = 'side-by-side' | 'inline';
type DiffGranularity = 'line' | 'char';

/**
 * 章节版本弹窗选项列表结构定义。
 */
export interface ChapterVersionModalOptions {
    project: string;
    contentType: ContentType;
    contentKey: string;
    sourcePath: string;
    currentContent: string;
    onRollback?: (version: VersionMeta) => Promise<void>;
    onSaveVersion?: () => Promise<VersionMeta | null>;
}

/**
 * 章节版本弹窗。
 */
export class ChapterVersionModal extends Modal {
    private options: ChapterVersionModalOptions;
    private service: ChapterVersionService;
    private versions: VersionMeta[] = [];
    private selectedVersion: VersionMeta | null = null;
    private compareVersion: VersionMeta | null = null;
    private diffViewMode: DiffViewMode = 'side-by-side';
    private diffGranularity: DiffGranularity = 'line';
    private diffStats: DiffStats | null = null;
    private currentLineDiffs: LineDiff[] = [];
    private selectedLineIndices: Set<number> = new Set();

    private leftPanel!: HTMLElement;
    private rightPanel!: HTMLElement;
    private statsBar!: HTMLElement;

    constructor(app: App, options: ChapterVersionModalOptions, engineRegistry?: EngineRegistry) {
        super(app);
        this.options = options;
        this.service = engineRegistry?.get(ENGINE_NAMES.CHAPTER_VERSION_SERVICE)
            ?? new ChapterVersionService(app);
    }

    /**
     * onOpen 方法。
     */
    async onOpen(): Promise<void> {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('novel-writer-version-modal');
        this.titleEl.setText(`📜 版本历史 - ${this.options.contentKey}`);

        const { contentEl } = this;
        contentEl.empty();

        const toolbar = contentEl.createDiv({ cls: 'nw-version-toolbar' });
        this.renderToolbar(toolbar);

        const mainContainer = contentEl.createDiv({ cls: 'nw-version-main' });

        this.leftPanel = mainContainer.createDiv({ cls: 'nw-version-left' });
        this.rightPanel = mainContainer.createDiv({ cls: 'nw-version-right' });

        this.statsBar = contentEl.createDiv({ cls: 'nw-version-stats' });

        await this.loadVersions();
        this.renderVersionList();

        if (this.versions.length > 0) {
            this.selectedVersion = this.versions[0];
            await this.renderDiff();
        } else {
            this.renderEmptyState();
        }
    }

    // ============================================================
    // 工具栏
    // ============================================================

    private renderToolbar(container: HTMLElement): void {
        const left = container.createDiv({ cls: 'nw-version-toolbar-left' });

        new Setting(left)
            .addButton(btn => {
                btn
                    .setButtonText('💾 保存当前版本')
                    .setCta()
                    .onClick(async () => {
                        if (this.options.onSaveVersion) {
                            const newVersion = await this.options.onSaveVersion();
                            if (newVersion) {
                                new Notice('✅ 版本已保存');
                                await this.loadVersions();
                                this.selectedVersion = newVersion;
                                this.renderVersionList();
                                await this.renderDiff();
                            }
                        }
                    });
            });

        const right = container.createDiv({ cls: 'nw-version-toolbar-right' });

        const viewModeGroup = right.createDiv({ cls: 'nw-version-btn-group' });
        const sideBySideBtn = viewModeGroup.createEl('button', {
            cls: 'nw-version-toggle-btn is-active',
            text: '并排对比',
        });
        const inlineBtn = viewModeGroup.createEl('button', {
            cls: 'nw-version-toggle-btn',
            text: '行内对比',
        });

        sideBySideBtn.addEventListener('click', () => {
            this.diffViewMode = 'side-by-side';
            sideBySideBtn.addClass('is-active');
            inlineBtn.removeClass('is-active');
            this.renderDiffView();
        });

        inlineBtn.addEventListener('click', () => {
            this.diffViewMode = 'inline';
            inlineBtn.addClass('is-active');
            sideBySideBtn.removeClass('is-active');
            this.renderDiffView();
        });

        const granularityGroup = right.createDiv({ cls: 'nw-version-btn-group' });
        const lineBtn = granularityGroup.createEl('button', {
            cls: 'nw-version-toggle-btn is-active',
            text: '行级',
        });
        const charBtn = granularityGroup.createEl('button', {
            cls: 'nw-version-toggle-btn',
            text: '字符级',
        });

        lineBtn.addEventListener('click', () => {
            this.diffGranularity = 'line';
            lineBtn.addClass('is-active');
            charBtn.removeClass('is-active');
            this.renderDiffView();
        });

        charBtn.addEventListener('click', () => {
            this.diffGranularity = 'char';
            charBtn.addClass('is-active');
            lineBtn.removeClass('is-active');
            this.renderDiffView();
        });
    }

    // ============================================================
    // 版本列表
    // ============================================================

    private async loadVersions(): Promise<void> {
        this.versions = await this.service.getVersions(
            this.options.project,
            this.options.contentType,
            this.options.contentKey,
            this.options.sourcePath,
        );
    }

    private renderVersionList(): void {
        this.leftPanel.empty();

        const header = this.leftPanel.createDiv({ cls: 'nw-version-list-header' });
        header.createSpan({ text: `版本列表 (${this.versions.length})` });

        if (this.versions.length === 0) {
            this.leftPanel.createDiv({
                cls: 'nw-version-empty',
                text: '暂无版本记录，点击「保存当前版本」创建第一个版本。',
            });
            return;
        }

        const list = this.leftPanel.createDiv({ cls: 'nw-version-list' });

        this.versions.forEach((version, index) => {
            const item = list.createDiv({
                cls: `nw-version-item${this.selectedVersion?.id === version.id ? ' is-selected' : ''}`,
            });

            const mainInfo = item.createDiv({ cls: 'nw-version-item-main' });
            const versionBadge = mainInfo.createSpan({
                cls: 'nw-version-badge',
                text: `v${version.version}`,
            });
            const typeBadge = mainInfo.createSpan({
                cls: `nw-version-type-badge type-${version.type}`,
                text: VERSION_TYPE_LABELS[version.type] || version.type,
            });

            const timeInfo = item.createDiv({ cls: 'nw-version-item-time' });
            timeInfo.setText(formatVersionTime(version.createdAt));

            const wordInfo = item.createDiv({ cls: 'nw-version-item-meta' });
            const delta = version.wordCountDelta;
            const deltaText = delta >= 0 ? `+${delta}` : `${delta}`;
            const deltaCls = delta > 0 ? 'delta-add' : delta < 0 ? 'delta-del' : 'delta-zero';
            wordInfo.createSpan({ text: `${version.wordCount} 字` });
            wordInfo.createSpan({ cls: `nw-version-delta ${deltaCls}`, text: `(${deltaText})` });

            if (version.tags && version.tags.length > 0) {
                const tagContainer = item.createDiv({ cls: 'nw-version-tags' });
                version.tags.forEach((tag: string) => {
                    tagContainer.createSpan({ cls: 'nw-version-tag', text: tag });
                });
            }

            if (version.note) {
                const noteEl = item.createDiv({ cls: 'nw-version-note' });
                noteEl.setText(version.note);
            }

            const actions = item.createDiv({ cls: 'nw-version-item-actions' });

            const rollbackBtn = actions.createEl('button', {
                cls: 'nw-version-rollback-btn',
                text: '⏪ 回滚到此版本',
            });
            rollbackBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.confirmRollback(version);
            });

            item.addEventListener('click', () => {
                this.selectedVersion = version;
                this.selectedLineIndices.clear();
                this.renderVersionList();
                this.renderDiff();
            });
        });
    }

    // ============================================================
    // Diff 对比视图
    // ============================================================

    private async renderDiff(): Promise<void> {
        if (!this.selectedVersion) {
            this.renderEmptyState();
            return;
        }

        try {
            const versionContent = await this.service.getVersionContent(this.selectedVersion);
            this.currentLineDiffs = lineDiff(versionContent, this.options.currentContent);
            this.diffStats = computeDiffStats(
                this.currentLineDiffs,
                versionContent,
                this.options.currentContent,
            );
            this.renderDiffView();
            this.renderStats();
        } catch (e) {
            this.rightPanel.createDiv({
                cls: 'nw-version-error',
                text: `加载版本内容失败: ${e instanceof Error ? e.message : String(e)}`,
            });
        }
    }

    private renderDiffView(): void {
        this.rightPanel.empty();

        if (!this.selectedVersion || !this.diffStats) {
            return;
        }

        const diffHeader = this.rightPanel.createDiv({ cls: 'nw-diff-header' });
        diffHeader.createSpan({
            cls: 'nw-diff-header-label',
            text: `比较：v${this.selectedVersion.version} → 当前`,
        });

        const diffContainer = this.rightPanel.createDiv({ cls: 'nw-diff-container' });

        if (this.diffViewMode === 'side-by-side') {
            this.renderSideBySideDiff(diffContainer);
        } else {
            this.renderInlineDiff(diffContainer);
        }
    }

    private renderSideBySideDiff(container: HTMLElement): void {
        const wrapper = container.createDiv({ cls: 'nw-diff-side-by-side' });

        const oldPanel = wrapper.createDiv({ cls: 'nw-diff-panel nw-diff-old' });
        const oldHeader = oldPanel.createDiv({ cls: 'nw-diff-panel-header' });
        oldHeader.setText(`v${this.selectedVersion?.version}（旧版本）`);
        const oldContent = oldPanel.createDiv({ cls: 'nw-diff-content' });

        const newPanel = wrapper.createDiv({ cls: 'nw-diff-panel nw-diff-new' });
        const newHeader = newPanel.createDiv({ cls: 'nw-diff-panel-header' });
        newHeader.setText('当前版本');
        const newContent = newPanel.createDiv({ cls: 'nw-diff-content' });

        let oldLineNum = 1;
        let newLineNum = 1;

        for (const diff of this.currentLineDiffs) {
            if (diff.op === 'equal') {
                this.renderLine(oldContent, diff.content, 'equal', oldLineNum);
                this.renderLine(newContent, diff.content, 'equal', newLineNum);
                oldLineNum++;
                newLineNum++;
            } else if (diff.op === 'delete') {
                this.renderLine(oldContent, diff.content, 'delete', oldLineNum);
                this.renderEmptyLine(newContent);
                oldLineNum++;
            } else if (diff.op === 'insert') {
                this.renderEmptyLine(oldContent);
                this.renderLine(newContent, diff.content, 'insert', newLineNum);
                newLineNum++;
            } else if (diff.op === 'replace') {
                this.renderLine(oldContent, diff.content, 'delete', oldLineNum);
                const newLineText = this.findNewLineForReplace(diff.oldLine);
                this.renderLine(newContent, newLineText || diff.content, 'insert', newLineNum);
                oldLineNum++;
                newLineNum++;
            }
        }
    }

    private findNewLineForReplace(oldLineIndex: number): string | null {
        let nextIsInsert = false;
        for (const diff of this.currentLineDiffs) {
            if (nextIsInsert && diff.op === 'insert') {
                return diff.content;
            }
            if (diff.op === 'replace' && diff.oldLine === oldLineIndex) {
                nextIsInsert = true;
            }
        }
        return null;
    }

    private renderInlineDiff(container: HTMLElement): void {
        const diffContent = container.createDiv({ cls: 'nw-diff-inline' });

        let lineNum = 1;

        for (const diff of this.currentLineDiffs) {
            const lineEl = diffContent.createDiv({ cls: `nw-diff-line nw-diff-${diff.op}` });

            const gutter = lineEl.createSpan({ cls: 'nw-diff-gutter' });
            if (diff.op !== 'delete') {
                gutter.setText(String(lineNum));
                lineNum++;
            } else {
                gutter.setText(' ');
            }

            const actionIcon = lineEl.createSpan({ cls: 'nw-diff-action' });
            if (diff.op === 'insert') {
                actionIcon.setText('+');
            } else if (diff.op === 'delete') {
                actionIcon.setText('-');
            } else if (diff.op === 'replace') {
                actionIcon.setText('~');
            } else {
                actionIcon.setText(' ');
            }

            const textSpan = lineEl.createSpan({ cls: 'nw-diff-text' });
            if (this.diffGranularity === 'char' && (diff.op === 'replace' || diff.op === 'insert' || diff.op === 'delete')) {
                this.renderCharDiff(textSpan, diff);
            } else {
                textSpan.setText(diff.content || ' ');
            }
        }
    }

    private renderCharDiff(container: HTMLElement, lineDiff: LineDiff): void {
        let oldText = '';
        let newText = '';

        if (lineDiff.op === 'delete') {
            oldText = lineDiff.content;
        } else if (lineDiff.op === 'insert') {
            newText = lineDiff.content;
        } else if (lineDiff.op === 'replace') {
            oldText = lineDiff.content;
            newText = this.findNewLineForReplace(lineDiff.oldLine) || '';
        }

        if (oldText && newText) {
            const charDiffs = charDiff(oldText, newText);
            for (const cd of charDiffs) {
                const span = container.createSpan({ cls: `nw-char-diff nw-diff-${cd.op}` });
                span.setText(cd.content || ' ');
            }
        } else if (oldText) {
            const span = container.createSpan({ cls: 'nw-char-diff nw-diff-delete' });
            span.setText(oldText);
        } else if (newText) {
            const span = container.createSpan({ cls: 'nw-char-diff nw-diff-insert' });
            span.setText(newText);
        }
    }

    private renderLine(container: HTMLElement, content: string, type: string, lineNum: number): void {
        const lineEl = container.createDiv({ cls: `nw-diff-line nw-diff-${type}` });

        const gutter = lineEl.createSpan({ cls: 'nw-diff-gutter' });
        gutter.setText(String(lineNum));

        const textSpan = lineEl.createSpan({ cls: 'nw-diff-text' });
        textSpan.setText(content || ' ');
    }

    private renderEmptyLine(container: HTMLElement): void {
        const lineEl = container.createDiv({ cls: 'nw-diff-line diff-empty' });
        const gutter = lineEl.createSpan({ cls: 'nw-diff-gutter' });
        gutter.setText(' ');
        lineEl.createSpan({ cls: 'nw-diff-text', text: ' ' });
    }

    // ============================================================
    // 统计信息
    // ============================================================

    private renderStats(): void {
        this.statsBar.empty();

        if (!this.diffStats) return;

        const stats = this.statsBar.createDiv({ cls: 'nw-version-stats-inner' });

        const addStat = stats.createSpan({ cls: 'nw-stat-item stat-add' });
        addStat.setText(`+${this.diffStats.addedLines} 行增加`);

        const delStat = stats.createSpan({ cls: 'nw-stat-item stat-del' });
        delStat.setText(`-${this.diffStats.deletedLines} 行删除`);

        const modStat = stats.createSpan({ cls: 'nw-stat-item stat-mod' });
        modStat.setText(`~${this.diffStats.modifiedLines} 行修改`);

        const totalStat = stats.createSpan({ cls: 'nw-stat-item' });
        totalStat.setText(`${this.diffStats.totalLines} 行总计`);

        const ratioStat = stats.createSpan({ cls: 'nw-stat-item' });
        const ratio = (this.diffStats.changeRatio * 100).toFixed(1);
        ratioStat.setText(`变更率: ${ratio}%`);
    }

    // ============================================================
    // 回滚功能
    // ============================================================

    private async confirmRollback(version: VersionMeta): Promise<void> {
        const confirmModal = new RollbackConfirmModal(this.app, version, this.diffStats, async (confirmed) => {
            if (confirmed) {
                if (this.options.onRollback) {
                    await this.options.onRollback(version);
                    new Notice(`✅ 已回滚到 v${version.version}`);
                    this.close();
                }
            }
        });
        confirmModal.open();
    }

    // ============================================================
    // 空状态
    // ============================================================

    private renderEmptyState(): void {
        this.rightPanel.empty();
        this.rightPanel.appendChild(createEmptyState({
            icon: 'data',
            title: '暂无版本对比',
            description: '选择左侧的版本查看对比，或先保存当前版本开始记录历史。',
            actionText: this.options.onSaveVersion ? '保存当前版本' : undefined,
            onAction: this.options.onSaveVersion
                ? async () => {
                    const newVersion = await this.options.onSaveVersion!();
                    if (newVersion) {
                        await this.loadVersions();
                        this.selectedVersion = newVersion;
                        this.renderVersionList();
                        await this.renderDiff();
                        new Notice(`✅ 已保存 v${newVersion.version}`);
                    }
                }
                : undefined,
        }));
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * 回滚确认对话框
 */
class RollbackConfirmModal extends Modal {
    private version: VersionMeta;
    private stats: DiffStats | null;
    private onConfirm: (confirmed: boolean) => void;

    constructor(
        app: App,
        version: VersionMeta,
        stats: DiffStats | null,
        onConfirm: (confirmed: boolean) => void,
    ) {
        super(app);
        this.version = version;
        this.stats = stats;
        this.onConfirm = onConfirm;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.titleEl.setText('⚠️ 确认回滚');

        const { contentEl } = this;
        contentEl.empty();

        const warningBox = contentEl.createDiv({ cls: 'nw-rollback-warning' });
        warningBox.createDiv({
            cls: 'nw-rollback-warning-title',
            text: `确定要回滚到 v${this.version.version} 吗？`,
        });
        warningBox.createDiv({
            cls: 'nw-rollback-warning-desc',
            text: '回滚前会自动保存当前版本作为备份，您可以随时从版本历史中恢复。',
        });

        const infoBox = contentEl.createDiv({ cls: 'nw-rollback-info' });
        infoBox.createDiv({ cls: 'nw-rollback-info-row' })
            .createSpan({ text: `版本类型: ` })
            .appendChild(
                (() => {
                    const s = document.createElement('span');
                    s.className = 'nw-rollback-info-value';
                    s.textContent = VERSION_TYPE_LABELS[this.version.type] || this.version.type;
                    return s;
                })()
            );
        infoBox.createDiv({ cls: 'nw-rollback-info-row' })
            .createSpan({ text: `创建时间: ` })
            .appendChild(
                (() => {
                    const s = document.createElement('span');
                    s.className = 'nw-rollback-info-value';
                    s.textContent = formatVersionTime(this.version.createdAt);
                    return s;
                })()
            );
        infoBox.createDiv({ cls: 'nw-rollback-info-row' })
            .createSpan({ text: `字数: ` })
            .appendChild(
                (() => {
                    const s = document.createElement('span');
                    s.className = 'nw-rollback-info-value';
                    s.textContent = `${this.version.wordCount} 字`;
                    return s;
                })()
            );

        if (this.version.note) {
            infoBox.createDiv({ cls: 'nw-rollback-info-row' })
                .createSpan({ text: `备注: ` })
                .appendChild(
                    (() => {
                        const s = document.createElement('span');
                        s.className = 'nw-rollback-info-value';
                        s.textContent = this.version.note;
                        return s;
                    })()
                );
        }

        if (this.stats) {
            const statsBox = contentEl.createDiv({ cls: 'nw-rollback-stats' });
            statsBox.createDiv({ cls: 'nw-rollback-stats-title', text: '预计变化：' });
            const statsRow = statsBox.createDiv({ cls: 'nw-rollback-stats-row' });
            statsRow.createSpan({
                cls: 'nw-stat-item stat-add',
                text: `+${this.stats.addedLines} 行`,
            });
            statsRow.createSpan({
                cls: 'nw-stat-item stat-del',
                text: `-${this.stats.deletedLines} 行`,
            });
            statsRow.createSpan({
                cls: 'nw-stat-item stat-mod',
                text: `~${this.stats.modifiedLines} 行`,
            });
        }

        new Setting(contentEl)
            .addButton(btn => {
                btn
                    .setButtonText('取消')
                    .onClick(() => {
                        this.close();
                        this.onConfirm(false);
                    });
            })
            .addButton(btn => {
                btn
                    .setButtonText('✅ 确认回滚')
                    .setWarning()
                    .onClick(() => {
                        this.close();
                        this.onConfirm(true);
                    });
            });
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
