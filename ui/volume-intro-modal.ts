import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from '../engine/ai-engine';
import { ContextManager } from '../engine/context-manager';
import { mkdirp, showSuccess, showError, showProgress, hideProgress } from '../utils/helpers';
import { pjVolumeOutlineDir, pjControlDir } from '../shared/paths';
import { createLogger } from '../shared/logger';


const log = createLogger('VolumeIntroModal');
export class VolumeIntroModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private contextManager: ContextManager;
    private generateButton: HTMLButtonElement | null = null;
    private originalButtonText: string = '';

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
        this.contextManager = plugin.ctxManager;
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
        contentEl.createEl('h2', { text: '📝 全书简介生成器' });

        const projectSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });

        const populateProjects = async () => {
            const projects = await this.contextManager.detectProjects();
            if (projects.length === 0) {
                contentEl.createEl('p', { text: '❌ 未找到项目，请先创建新项目' });
                return;
            }

            projects.forEach(project => {
                projectSelect.createEl('option', { value: project, text: project });
            });

            this.generateButton = contentEl.createEl('button', { text: '生成全书简介', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
            this.generateButton.onclick = async () => {
                const project = projectSelect.value;
                await this.generateIntro(project);
            };
        };

        populateProjects();
    }

    private async generateIntro(project: string): Promise<void> {
        if (!this.plugin.hasAiCredentials) {
            showError('请先配置 API 密钥或本地模型端点');
            return;
        }

        if (this.generateButton) {
            this.originalButtonText = this.generateButton.textContent || '';
            this.generateButton.disabled = true;
            this.generateButton.textContent = '⏳ 生成中...';
        }
        const genNotice = new Notice('⏳ 正在生成全书简介...', 0);

        try {
            // v4.0：分卷大纲按卷归档，拼接所有 第N卷_分卷大纲.md 作为整体大纲内容
            const volumeDir = pjVolumeOutlineDir(project);
            const volumeFiles = this.app.vault.getFiles()
                .filter(f => f.path.startsWith(`${volumeDir}/`) && f.name.endsWith('_分卷大纲.md'))
                .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'));
            if (volumeFiles.length === 0) {
                showError(`未找到分卷大纲：${volumeDir}/*_分卷大纲.md`);
                return;
            }
            const parts: string[] = [];
            for (const f of volumeFiles) {
                try { parts.push(await this.app.vault.read(f)); } catch (e) { log.warn('[VolumeIntroModal] 读取失败:', f.path, e); }
            }
            const outlineContent = parts.join('\n\n');

            const bookSummary = { totalChapters: '', totalWords: '', totalVolumes: '' };
            const lines = outlineContent.split('\n');

            for (const line of lines) {
                const wm = line.match(/总字数目标[：:]\s*(\S+)/);
                if (wm) bookSummary.totalWords = wm[1];
                const cm = line.match(/总章节数[：:]\s*(\S+)/);
                if (cm) bookSummary.totalChapters = cm[1];
                const vm = line.match(/分卷数[：:]\s*(\S+)/);
                if (vm) bookSummary.totalVolumes = vm[1];
            }

            const volumes: VolumeData[] = [];
            let currentVol: VolumeData | null = null;

            for (const line of lines) {
                const volMatch = line.match(/^###\s+(第\d+卷)/);
                if (volMatch) {
                    if (currentVol) volumes.push(currentVol);
                    currentVol = { name: volMatch[1], sections: {}, chapters: [] };
                    continue;
                }
                if (!currentVol) continue;

                const keyMatch = line.match(/^-\s*\*\*(.*?)\*\*[：:]\s*(.*)/);
                if (keyMatch) {
                    const key = keyMatch[1].trim();
                    const val = keyMatch[2].trim();
                    currentVol.sections[key] = val;
                    continue;
                }

                const chapMatch = line.match(/^\|\s*(\d+)\s*\|(.+)\|/);
                if (chapMatch && currentVol.sections['章节范围']) {
                    currentVol.chapters.push({
                        num: parseInt(chapMatch[1]),
                        conflict: chapMatch[2].trim()
                    });
                }
            }
            if (currentVol) volumes.push(currentVol);

            if (volumes.length === 0) {
                showError('分卷大纲中未解析到任何分卷');
                return;
            }

            const fullSummary = this.buildFullSummary(bookSummary, volumes);

            const sysPrompt = `你是一位资深番茄小说编辑，擅长提炼网络小说的核心卖点。

根据提供的全书大纲数据，生成一份番茄小说风格的简介。

【格式要求】
- 总字数 300-500 字
- 必须有「核心梗」「核心爽点」「世界观亮点」「角色魅力」四个板块
- 用口语化、抓人的语气，像在跟读者对话
- 不要文艺描写，直接抛出悬念和爽点
- 参考番茄热门小说的简介风格：短、快、狠
- 让读者看完就想点进来

【核心梗】—— 用一段话说明这部小说讲什么（世界观背景、主角身份、金手指、最大悬念）
【核心爽点】—— 3-5 个全书最爽的点，用"主角用 X 能力做了 Y 事让 Z 震惊"的句式
【世界观亮点】—— 这个世界的独特之处（1-2 句话）
【角色魅力】—— 主角最吸引人的特质（1-2 句话）`;

            const userPrompt = `请根据以下全书大纲数据，生成这部小说的番茄小说简介。

【全书总览】
- 总字数目标：${bookSummary.totalWords || '未设定'}
- 总章节数：${bookSummary.totalChapters || '未设定'}
- 分卷数：${bookSummary.totalVolumes || volumes.length}

【全卷摘要】
${fullSummary}

要求：
1. 核心梗：一段话说清全书核心矛盾
2. 核心爽点：列出 3-5 个具体爽点
3. 世界观亮点：1-2 句话
4. 角色魅力：1-2 句话
5. 总字数 300-500 字
6. 语气口语化，有冲击力`;

            const result = await this.aiEngine.callAI(sysPrompt, userPrompt, undefined, 0.8, 2048);

            if (result.error) {
                showError(`全书简介生成失败: ${result.error}`);
                return;
            }

            // v4.0：全书简介迁入 04-项目总控/
            await mkdirp(this.app, pjControlDir(project));
            const introPath = `${pjControlDir(project)}/全书简介.md`;
            const introContent = `---
tags: [简介, 全书]
生成时间: ${new Date().toLocaleString()}
章节数: ${bookSummary.totalChapters || ''}
分卷数: ${bookSummary.totalVolumes || volumes.length}
---

# 全书简介

${result.content}
`;

            try {
                const existingIntro = this.app.vault.getAbstractFileByPath(introPath);
                if (existingIntro) {
                    await this.app.vault.delete(existingIntro);
                }
                await this.app.vault.create(introPath, introContent);
            } catch (e) {
                showError(`保存失败: ${(e as Error).message}`);
                return;
            }

            const savedFile = this.app.vault.getAbstractFileByPath(introPath);
            if (savedFile instanceof TFile) {
                await this.plugin.safeOpenFile(savedFile);
            }

            showSuccess('全书简介已生成 → 全书简介.md');
            this.close();
        } finally {
            genNotice.hide();
            if (this.generateButton) {
                this.generateButton.disabled = false;
                this.generateButton.textContent = this.originalButtonText;
            }
        }
    }

    private buildFullSummary(bookSummary: BookSummary, volumes: VolumeData[]): string {
        const parts: string[] = [];

        for (const vol of volumes) {
            parts.push(`\n=== ${vol.name}：${vol.sections['卷名'] || '未命名'} ===`);

            if (vol.sections['章节范围']) parts.push(`章节：${vol.sections['章节范围']}`);

            if (vol.sections['核心剧情']) {
                parts.push(`剧情：${vol.sections['核心剧情']}`);
            }

            if (vol.sections['主线推进']) {
                parts.push(`主线：${vol.sections['主线推进']}`);
            }

            if (vol.sections['本卷高潮']) {
                parts.push(`高潮：${vol.sections['本卷高潮']}`);
            }

            if (vol.sections['结尾过渡']) {
                parts.push(`结尾：${vol.sections['结尾过渡']}`);
            }

            if (vol.chapters.length > 0) {
                const first3 = vol.chapters.slice(0, 3);
                const last3 = vol.chapters.slice(-3);
                const hints: string[] = [];
                for (const c of first3) hints.push(c.conflict);
                for (const c of last3) hints.push(c.conflict);
                parts.push(`关键冲突示例：${hints.join(' / ')}`);
            }
        }

        return parts.join('\n');
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

interface BookSummary {
    totalChapters: string;
    totalWords: string;
    totalVolumes: string;
}

interface VolumeData {
    name: string;
    sections: Record<string, string>;
    chapters: { num: number; conflict: string }[];
}
