import { App, Modal, Notice, TFile } from 'obsidian';
import { NovelAnalyzer, NovelAnalysisResult } from '../engine/novel-analyzer';
import { barChart, donutChart, wordCloud } from './svg-charts';
import { AddFingerprintModal } from './fingerprint-library-modal';
import { FingerprintExtractor } from '../engine/fingerprint-extractor';
import { createFingerprintEmbedding } from './fingerprint-embedding';
import NovelWriterPlugin from '../main';
import { createLogger } from '../shared/logger';


const log = createLogger('NovelAnalysisModal');
interface NovelAnalysisModalOptions {
    text: string;
    projectName: string;
    plugin: NovelWriterPlugin;
}

/**
 * NovelAnalysisModal 类。
 */
export class NovelAnalysisModal extends Modal {
    private options: NovelAnalysisModalOptions;
    private analyzer: NovelAnalyzer;
    private result: NovelAnalysisResult | null = null;
    private contentContainer!: HTMLElement;
    private loadingEl!: HTMLElement;

    constructor(app: App, options: NovelAnalysisModalOptions) {
        super(app);
        this.options = options;
        this.analyzer = new NovelAnalyzer();
    }

    /**
     * onOpen 方法。
     */
    onOpen() {
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('max-height', '85vh', 'important');
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();

        contentEl.createEl('h3', {
            text: '📊 内容分析',
            attr: { style: 'margin-top:0;margin-bottom:16px;' }
        });

        this.loadingEl = contentEl.createDiv({
            attr: {
                style: 'text-align:center;padding:40px;color:var(--text-muted);font-size:13px;'
            },
            text: '分析中...'
        });

        this.contentContainer = contentEl.createDiv();

        const btnRow = contentEl.createDiv({
            attr: { style: 'display:flex;gap:8px;margin-top:20px;justify-content:flex-end;' }
        });

        const fingerprintBtn = btnRow.createEl('button', {
            text: '🔍 提取为指纹',
            attr: {
                type: 'button',
                style: 'padding:6px 16px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;cursor:pointer;font-size:13px;'
            }
        });
        fingerprintBtn.addEventListener('click', () => this.handleExtractFingerprint());

        const closeBtn = btnRow.createEl('button', {
            text: '关闭',
            attr: {
                type: 'button',
                style: 'padding:6px 16px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;background:transparent;font-size:13px;'
            }
        });
        closeBtn.addEventListener('click', () => this.close());

        this.analyzeText();
    }

    /**
     * onClose 方法。
     */
    onClose() {
        this.contentEl.empty();
    }

    private async analyzeText(): Promise<void> {
        try {
            let text = this.options.text;
            if (!text || text.trim().length === 0) {
                text = await this.loadTextFromFile();
            }

            if (!text || text.trim().length === 0) {
                this.loadingEl.setText('暂无内容可分析');
                return;
            }

            this.result = this.analyzer.analyze(text);
            this.loadingEl.style.display = 'none';
            this.renderResult();
        } catch (e) {
            log.warn('[NovelAnalysisModal] 分析失败:', e);
            this.loadingEl.setText('分析失败，请查看控制台');
        }
    }

    private async loadTextFromFile(): Promise<string> {
        try {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile instanceof TFile) {
                const content = await this.app.vault.read(activeFile);
                return content.replace(/^---[\s\S]*?---\s*/, '').trim();
            }
        } catch {
            // ignore
        }
        return '';
    }

    private renderResult(): void {
        if (!this.result) return;

        this.contentContainer.empty();
        const r = this.result;

        const statsGrid = this.contentContainer.createDiv({
            attr: {
                style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px;'
            }
        });

        const stats = [
            { label: '总字数', value: r.basic.wordCount },
            { label: '段落数', value: r.basic.paragraphCount },
            { label: '句子数', value: r.basic.sentenceCount },
            { label: '平均句长', value: r.length.avgSentenceLength + '字' },
            { label: '平均段长', value: r.length.avgParagraphLength + '字' },
            { label: '对话占比', value: Math.round(r.ratio.dialogueRatio * 100) + '%' },
        ];

        for (const stat of stats) {
            const card = statsGrid.createDiv({
                attr: {
                    style: 'background:var(--background-secondary);border-radius:6px;padding:12px;text-align:center;'
                }
            });
            card.createDiv({
                text: String(stat.value),
                attr: {
                    style: 'font-size:20px;font-weight:600;color:var(--text-normal);margin-bottom:4px;'
                }
            });
            card.createDiv({
                text: stat.label,
                attr: {
                    style: 'font-size:11px;color:var(--text-muted);'
                }
            });
        }

        const sentenceChartSection = this.contentContainer.createDiv({
            attr: { style: 'margin-bottom:20px;' }
        });
        sentenceChartSection.createEl('h4', {
            text: '句式长度分布',
            attr: { style: 'font-size:14px;margin:0 0 8px 0;' }
        });
        const sentenceChartHtml = barChart(r.distribution.sentenceLength, {
            width: 520,
            height: 200
        });
        sentenceChartSection.createDiv().innerHTML = sentenceChartHtml;

        const paragraphChartSection = this.contentContainer.createDiv({
            attr: { style: 'margin-bottom:20px;' }
        });
        paragraphChartSection.createEl('h4', {
            text: '段落长度分布',
            attr: { style: 'font-size:14px;margin:0 0 8px 0;' }
        });
        const paragraphChartHtml = barChart(r.distribution.paragraphLength, {
            width: 520,
            height: 200
        });
        paragraphChartSection.createDiv().innerHTML = paragraphChartHtml;

        const ratioSection = this.contentContainer.createDiv({
            attr: { style: 'margin-bottom:20px;' }
        });
        ratioSection.createEl('h4', {
            text: '内容构成',
            attr: { style: 'font-size:14px;margin:0 0 8px 0;' }
        });
        const donutData = [
            { label: '对话', value: r.ratio.dialogueRatio, color: '#7c3aed' },
            { label: '描写', value: r.ratio.descriptionRatio, color: '#ec4899' },
            { label: '叙述', value: r.ratio.narrationRatio, color: '#10b981' },
        ];
        const donutHtml = donutChart(donutData, { size: 240 });
        ratioSection.createDiv().innerHTML = donutHtml;

        const wordCloudSection = this.contentContainer.createDiv();
        wordCloudSection.createEl('h4', {
            text: '高频词云 Top 20',
            attr: { style: 'font-size:14px;margin:0 0 8px 0;' }
        });
        const top20 = r.topWords.slice(0, 20);
        const cloudHtml = wordCloud(
            top20.map(w => ({ text: w.text, weight: w.count })),
            { width: 520, height: 160 }
        );
        wordCloudSection.createDiv().innerHTML = cloudHtml;
    }

    private handleExtractFingerprint(): void {
        const text = this.options.text;
        if (!text || text.trim().length < 100) {
            new Notice('文本内容过短，无法提取指纹');
            return;
        }

        const projectName = this.options.projectName;
        if (!projectName) {
            new Notice('请先打开一个项目');
            return;
        }

        const plugin = this.options.plugin;
        const { provider, vectorStore } = createFingerprintEmbedding(
            this.app,
            'project',
            plugin.settings,
            projectName,
        );
        const extractor = new FingerprintExtractor(plugin.aiEngine, provider, vectorStore);

        this.close();

        const modal = new AddFingerprintModal(this.app, {
            scope: 'project',
            extractor,
            onCompleted: (fingerprint) => {
                new Notice('✅ 指纹提取完成');
            }
        });

        modal.open();

        setTimeout(() => {
            const textarea = modal.contentEl.querySelector('textarea');
            if (textarea) {
                (textarea as HTMLTextAreaElement).value = text;
                modal.textValue = text;
            }
        }, 100);
    }
}
