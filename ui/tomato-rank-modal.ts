import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from '../engine/ai-engine';

export class TomatoRankModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private analyzeButton: HTMLButtonElement | null = null;
    private originalButtonText: string = '';

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();
        contentEl.createEl('h2', { text: '🍅 番茄榜单分析' });

        this.analyzeButton = contentEl.createEl('button', { text: '开始分析热门趋势', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        this.analyzeButton.onclick = async () => {
            await this.analyzeRank();
        };
    }

    private async analyzeRank(): Promise<void> {
        if (!this.plugin.settings.apiKey) {
            new Notice('❌ 请先配置API密钥', 5000);
            return;
        }

        if (this.analyzeButton) {
            this.originalButtonText = this.analyzeButton.textContent || '';
            this.analyzeButton.disabled = true;
            this.analyzeButton.textContent = '⏳ 生成中...';
        }
        const genNotice = new Notice('⏳ 正在分析番茄小说热门榜单...', 0);

        try {
            const sysPrompt = '你是一个番茄小说榜单分析师。请基于你的知识库，分析当前番茄小说畅销榜和在读榜的热门趋势。';

            const userPrompt = `请分析番茄小说平台当前最热门的题材趋势，输出以下结构：

## 畅销榜 TOP 趋势
- 列出3-5个当前最热门的题材类型
- 每个题材给出2-3部代表作的书名关键词
- 说明该题材的核心爽点

## 在读榜 TOP 趋势
- 列出3-5个在读人数最高的题材
- 说明该题材吸引读者的核心原因

## 题材推荐
- 推荐3个当前最有潜力的创作方向
- 每个方向说明：目标读者年龄段、核心情绪共鸣点、世界观设定建议

请直接输出分析结果，不需要额外解释。`;

            const result = await this.aiEngine.callAI(sysPrompt, userPrompt, undefined, 0.8, 2048);

            if (result.error) {
                new Notice(`❌ 榜单分析失败: ${result.error}`, 5000);
                return;
            }

            const ts = new Date();
            const timestamp = `${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}_${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')}`;
            const reportPath = `番茄榜单分析_${timestamp}.md`;

            const content = `---
tags: [榜单分析]
生成时间: ${new Date().toLocaleString()}
---

# 番茄榜单分析报告

${result.content}
`;

            await this.app.vault.create(reportPath, content);
            const file = this.app.vault.getAbstractFileByPath(reportPath);
            if (file instanceof TFile) {
                await this.plugin.safeOpenFile(file);
            }

            new Notice('✅ 番茄榜单分析完成', 3000);
            this.close();
        } finally {
            genNotice.hide();
            if (this.analyzeButton) {
                this.analyzeButton.disabled = false;
                this.analyzeButton.textContent = this.originalButtonText;
            }
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
