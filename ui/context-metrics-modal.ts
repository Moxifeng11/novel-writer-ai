/**
 * context-metrics-modal.ts — 上下文注入量体检面板
 *
 * 展示 `plugin.measureContextMetrics` 的结果：旧策略整份注入 vs 当前场景精确注入，
 * 以及结论与建议（是否值得开启严格模式/去重开关）。
 */

import { App, Modal } from 'obsidian';
import type NovelWriterPlugin from '@/main';

/**
 * 注入量体检面板。
 */
export class ContextMetricsModal extends Modal {
    /**
     * @param app - Obsidian 应用
     * @param plugin - 插件实例
     * @param project - 项目路径
     */
    constructor(
        app: App,
        private readonly plugin: NovelWriterPlugin,
        private readonly project: string,
    ) {
        super(app);
    }

    /** 打开面板并加载数据 */
    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: '📊 上下文注入量体检' });
        contentEl.createEl('p', {
            text: `项目：${this.project}`,
            cls: 'setting-item-description',
        });
        const loading = contentEl.createEl('p', { text: '正在统计…' });

        void this.load(loading);
    }

    /** 关闭时清理 */
    onClose(): void {
        this.contentEl.empty();
    }

    /** 加载并渲染统计结果 */
    private async load(loading: HTMLElement): Promise<void> {
        try {
            const result = await this.plugin.measureContextMetrics(this.project, 1);
            loading.remove();
            const { contentEl } = this;
            const table = contentEl.createEl('table');
            const head = table.createEl('thead').createEl('tr');
            head.createEl('th', { text: '策略' });
            head.createEl('th', { text: '字符' });
            head.createEl('th', { text: '估算 token' });
            const body = table.createEl('tbody');
            const beforeRow = body.createEl('tr');
            beforeRow.createEl('td', { text: `旧：整份注入（${result.legacyFiles} 个文件）` });
            beforeRow.createEl('td', { text: String(result.beforeChars) });
            beforeRow.createEl('td', { text: String(Math.ceil(result.beforeChars / 2)) });
            const afterRow = body.createEl('tr');
            afterRow.createEl('td', { text: '新：场景精确注入' });
            afterRow.createEl('td', { text: String(result.afterChars) });
            afterRow.createEl('td', { text: String(Math.ceil(result.afterChars / 2)) });

            contentEl.createEl('h4', { text: '结论' });
            contentEl.createEl('pre', { text: result.report });

            const ratio = result.beforeChars > 0 ? Math.round((1 - result.afterChars / result.beforeChars) * 1000) / 10 : 0;
            contentEl.createEl('p', {
                text: ratio >= 50
                    ? `注入体积下降 ${ratio}%：可考虑在设置里开启「正文步场景精确注入（实验）」。`
                    : `注入体积变化 ${ratio}%（场景上下文尚未覆盖大部分内容，建议先补齐 Scene 展开）。`,
            });
        } catch (error) {
            loading.setText(`统计失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
