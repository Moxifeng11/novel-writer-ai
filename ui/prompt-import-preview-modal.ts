/**
 * prompt-import-preview-modal.ts — 提示词配置导入预览弹窗（功能缺口 ④）
 *
 * 为什么要有这一步：导入 JSON 是破坏性动作。原实现 `change` 事件里直接
 * `importConfig(text)` 整份替换并弹「配置导入成功」——用户看不到会覆盖掉
 * 多少个自定义模板，误选文件就没有后悔药。这里先 dry-run 展示差异，
 * 再让用户选「合并导入」或「覆盖导入」。
 */
import { App, Modal } from 'obsidian';
import type { PromptImportDiff, PromptImportMode } from '@/shared/prompt-manager-import';

/** 导入预览弹窗的入参 */
export interface PromptImportPreviewOptions {
    /** 被选中的文件名（只用于展示） */
    fileName: string;
    /** dry-run 差异统计 */
    diff: PromptImportDiff;
    /** 用户选定模式后的回调（取消时不调用） */
    onConfirm: (mode: PromptImportMode) => void;
}

/**
 * 导入预览弹窗。
 */
export class PromptImportPreviewModal extends Modal {
    private readonly options: PromptImportPreviewOptions;

    /**
     * 构造导入预览弹窗。
     *
     * @param app - Obsidian App
     * @param options - 文件名、差异统计与确认回调
     */
    constructor(app: App, options: PromptImportPreviewOptions) {
        super(app);
        this.options = options;
    }

    /** 渲染弹窗内容（差异分组 + 两种导入模式） */
    onOpen(): void {
        this.modalEl.addClass('nw-scope', 'nw-modal');
        this.titleEl.setText('📥 导入预览');

        const { fileName, diff } = this.options;
        const body = this.contentEl.createDiv({ cls: 'nw-pm-import-body' });
        body.createDiv({ cls: 'nw-pm-import-file', text: `文件：${fileName}` });

        const summary = [
            `模板 新增 ${diff.addedTemplates.length} · 覆盖 ${diff.overwrittenTemplates.length} · 移除 ${diff.removedTemplates.length}`,
            `A/B 测试 新增 ${diff.addedTests.length} · 覆盖 ${diff.overwrittenTests.length}`,
            `使用记录 ${diff.usageInFile} 条`,
        ].join('　');
        body.createDiv({ cls: 'nw-pm-import-summary', text: summary });

        this.renderGroup(body, '➕ 新增模板', diff.addedTemplates, '');
        this.renderGroup(body, '♻️ 覆盖模板', diff.overwrittenTemplates, '');
        this.renderGroup(body, '🗑 覆盖模式将移除的模板', diff.removedTemplates, 'nw-pm-import-item--warn');
        this.renderGroup(body, '🧪 新增 A/B 测试', diff.addedTests, '');
        this.renderGroup(body, '🧪 覆盖 A/B 测试', diff.overwrittenTests, '');

        const empty = diff.addedTemplates.length + diff.overwrittenTemplates.length
            + diff.addedTests.length + diff.overwrittenTests.length === 0;
        if (empty) {
            body.createDiv({
                cls: 'nw-pm-import-empty',
                text: '文件里没有可导入的模板或 A/B 测试。',
            });
        }

        body.createDiv({
            cls: 'nw-pm-import-mode-hint',
            text: '合并导入（推荐）：只覆盖同 id 或同名模板，未提到的模板与使用记录保留。覆盖导入：整份替换当前自定义配置。',
        });

        const footer = this.modalEl.createDiv({ cls: 'nw-modal-footer' });
        footer.createEl('button', {
            text: '取消',
            cls: 'nw-modal-btn-secondary',
            attr: { type: 'button' },
        }).onclick = () => this.close();

        footer.createEl('button', {
            text: '覆盖导入',
            cls: 'nw-modal-btn-secondary nw-pm-import-replace-btn',
            attr: { type: 'button' },
        }).onclick = () => this.confirm('replace');

        footer.createEl('button', {
            text: '合并导入',
            cls: 'nw-modal-btn-primary nw-pm-import-merge-btn',
            attr: { type: 'button' },
        }).onclick = () => this.confirm('merge');
    }

    /** 关闭时清空内容，避免复用实例时残留旧差异 */
    onClose(): void {
        this.contentEl.empty();
    }

    /**
     * 确认导入并关窗。
     *
     * @param mode - 导入模式
     */
    private confirm(mode: PromptImportMode): void {
        this.close();
        this.options.onConfirm(mode);
    }

    /**
     * 渲染一组差异条目（空组不渲染，避免整屏「（0）」）。
     *
     * @param container - 容器
     * @param title - 分组标题
     * @param names - 条目名
     * @param itemClass - 额外条目类名
     */
    private renderGroup(
        container: HTMLElement,
        title: string,
        names: string[],
        itemClass: string,
    ): void {
        if (names.length === 0) return;
        const group = container.createDiv({ cls: 'nw-pm-import-group' });
        group.createDiv({ cls: 'nw-pm-import-group-title', text: `${title}（${names.length}）` });
        const list = group.createDiv({ cls: 'nw-pm-import-list' });
        for (const name of names) {
            list.createDiv({
                cls: itemClass ? `nw-pm-import-item ${itemClass}` : 'nw-pm-import-item',
                text: name,
            });
        }
    }
}