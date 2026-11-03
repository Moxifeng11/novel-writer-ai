import { App, Modal, Notice, TFile } from 'obsidian';
import { SUBDIR_OUTLINE_ROOT, pjVolumeOutlineDir } from '@/shared/paths';

import NovelWriterPlugin from '@/main';
import { ContextManager } from '@/engine/context-manager';
import { AIEngine } from '@/engine/ai-engine';
import { readMergedVolumeOutline } from '@/utils/helpers';

/**
 * NovelTagsModal 类。
 */
export class NovelTagsModal extends Modal {
    private plugin: NovelWriterPlugin;
    private contextManager: ContextManager;
    private aiEngine: AIEngine;
    private analyzeButton: HTMLButtonElement | null = null;
    private originalButtonText: string = '';

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.contextManager = plugin.ctxManager;
        this.aiEngine = plugin.aiEngine;
    }

    /**
     * onOpen 方法。
     */
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
        contentEl.createEl('h2', { text: '🏷️ 作品标签分析' });

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

            // 与工作台/项目页保持一致：优先当前项目，避免默认落到列表第一个
            const active = this.plugin.getActiveProject();
            projectSelect.value = active && projects.includes(active) ? active : projects[0];

            this.analyzeButton = contentEl.createEl('button', { text: '分析作品标签', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
            this.analyzeButton.onclick = async () => {
                await this.analyzeTags(projectSelect.value);
            };
        };

        populateProjects();
    }

    private async analyzeTags(project: string): Promise<void> {
        // v4.0：合并读取 分卷大纲/第N卷_分卷大纲.md（兼容旧单文件）
        const outlineContent = await readMergedVolumeOutline(this.app, project);
        if (!outlineContent || outlineContent.trim().length === 0) {
            new Notice(`❌ 未找到分卷大纲：${pjVolumeOutlineDir(project)}第N卷_分卷大纲.md`, 5000);
            return;
        }

        const { bookSummary, volumes } = this.parseOutline(outlineContent);

        if (volumes.length === 0) {
            new Notice('❌ 分卷大纲中未解析到任何分卷', 5000);
            return;
        }

        const resultPath = `${project}/${SUBDIR_OUTLINE_ROOT}/作品标签分析.md`;
        const existingFile = this.app.vault.getAbstractFileByPath(resultPath);

        if (existingFile) {
            const confirm = window.confirm('⚠️ 作品标签分析.md 已存在，是否覆盖？');
            if (!confirm) return;
        }

        if (!this.plugin.hasAiCredentials) {
            new Notice('❌ 请先配置 API 密钥或本地模型端点', 5000);
            return;
        }

        if (this.analyzeButton) {
            this.originalButtonText = this.analyzeButton.textContent || '';
            this.analyzeButton.disabled = true;
            this.analyzeButton.textContent = '⏳ 生成中...';
        }
        const genNotice = new Notice('⏳ 正在分析作品标签...', 0);

        try {
            const fullSummary = this.buildFullSummary(volumes);

            const sysPrompt = `你是一位资深网络小说平台编辑，精通番茄小说和起点中文网的标签分类体系。

根据提供的全书大纲数据，分析这部小说的标签分类，输出一份完整的标签分析报告。

【番茄小说标签分类体系】

一、频道分类（男频）
- 都市：现代都市、医路青云、商海沉浮、豪门世家、官场风云、娱乐明星
- 玄幻：异世大陆、高武世界、魔法奇幻、位面纪元
- 修仙：修真文明、仙侠世界、现代修真、神话修真
- 科幻：未来世界、星际文明、机甲战争、末世危机、进化变异、超级科技
- 悬疑：悬疑推理、探险生存、灵异鬼怪、世界秘闻
- 历史：历史穿越、架空历史、古代争霸、民国风云
- 游戏：游戏竞技、电子竞技、游戏世界、虚拟网游
- 现实：人生百态、社会悬疑、商战职场
- 轻小说：校园日常、搞笑日常、恋爱日常

二、频道分类（女频）
- 现代言情、古代言情、仙侠奇缘、浪漫青春、玄幻言情
- 科幻空间、悬疑推理、轻小说、短篇

三、热门标签词（关键，番茄算法重度依赖这些标签）
- 主角相关：无敌、重生、穿越、天才、强者归来、系统、绑定、签到
- 剧情相关：扮猪吃虎、升级流、种田、基建、无限流、直播、召唤
- 风格相关：搞笑、轻松、爽文、热血、黑暗、腹黑、治愈
- 设定相关：脑洞、副本、卡牌、模拟器、面板、数据化、异能、魔法

【起点中文网标签分类体系】

一、男生频道
- 玄幻：东方玄幻、异世大陆、上古神话、高武世界、王朝争霸
- 奇幻：魔法奇幻、史诗奇幻、黑暗奇幻、现代魔法、剑与魔法
- 武侠：传统武侠、国术无双、武侠架空、古武未来
- 仙侠：修真文明、现代修真、神话修真、古典仙侠
- 都市：都市生活、异术超能、娱乐明星、商海沉浮、官场风云、豪门世家
- 现实：人间百态、社会悬疑、短篇叙事、民俗传说
- 军事：战争幻想、军事历史、谍战特工、军旅生涯
- 历史：历史穿越、架空历史、三国春秋、回到古代
- 游戏：网游竞技、游戏系统、游戏异界、电子竞技
- 体育：篮球、足球、网球、搏击、赛车
- 科幻：星际文明、时空穿梭、末世危机、进化变异、超级科技
- 悬疑：悬疑推理、探险生存、奇妙世界、惊悚诡异
- 轻小说：综漫同人、原生幻想、衍生同人、搞笑吐槽

二、女生频道
- 古代言情、仙侠奇缘、现代言情、浪漫青春、玄幻言情
- 科幻空间、悬疑推理、轻小说、短篇、影视剧本

三、起点的作品标签（tags）
- 每个作品在签约时选择 1-3 个频道标签 + 若干自定义标签
- 例如：【玄幻】【高武世界】【系统】【无敌】

【分析要求】
1. 综合番茄和起点两套体系
2. 根据大纲内容给出最匹配的 3-5 个分类建议（按推荐度排序）
3. 给出 5-10 个热门标签词
4. 给出对标作品推荐（风格相似的热门小说）`;

            const userPrompt = `请根据以下全书大纲数据，分析这部小说的标签分类。

【全书总览】
- 总字数目标：${bookSummary.totalWords || '未设定'}
- 总章节数：${bookSummary.totalChapters || '未设定'}
- 分卷数：${bookSummary.totalVolumes || volumes.length}

【全卷摘要】
${fullSummary}

输出格式：

# 作品标签分析报告

## 一、核心定位（一句话概括）

## 二、平台分类建议

### 番茄小说
- 一级频道：
- 二级频道：
- 推荐标签词：

### 起点中文网
- 一级频道：
- 二级频道：
- 推荐标签词：

## 三、标签词推荐（按优先级排序）
（列出 8-10 个最匹配的热门标签）

## 四、对标作品推荐
（列出 2-3 本风格相似的热门小说，简要说明相似点）

## 五、封面文案参考（选做）
（30-50 字的副标题/广告语，突出标签卖点）`;

            const result = await this.aiEngine.callAI(sysPrompt, userPrompt, undefined, 0.7, this.plugin.settings.maxOutput);

            if (result.error) {
                new Notice(`❌ API 调用失败: ${result.error}`, 8000);
                return;
            }

            const content = `---
tags: [标签分析]
生成时间: ${new Date().toLocaleString()}
---

# 作品标签分析报告

${result.content}
`;

            try {
                if (existingFile instanceof TFile) {
                    await this.app.vault.modify(existingFile, content);
                } else {
                    await this.app.vault.create(resultPath, content);
                }
            } catch (e) {
                new Notice(`❌ 保存失败: ${(e as Error).message}`, 5000);
                return;
            }

            const savedFile = this.app.vault.getAbstractFileByPath(resultPath);
            if (savedFile instanceof TFile) {
                await this.plugin.safeOpenFile(savedFile);
            }

            new Notice('✅ 作品标签分析已生成', 6000);
            this.close();
        } finally {
            genNotice.hide();
            if (this.analyzeButton) {
                this.analyzeButton.disabled = false;
                this.analyzeButton.textContent = this.originalButtonText;
            }
        }
    }

    private parseOutline(content: string): { bookSummary: BookSummary; volumes: VolumeData[] } {
        const lines = content.split('\n');

        const bookSummary: BookSummary = { totalChapters: '', totalWords: '', totalVolumes: '' };
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

        return { bookSummary, volumes };
    }

    private buildFullSummary(volumes: VolumeData[]): string {
        const parts: string[] = [];

        for (const vol of volumes) {
            parts.push(`\n=== ${vol.name}：${vol.sections['卷名'] || '未命名'} ===`);

            if (vol.sections['章节范围']) parts.push(`章节：${vol.sections['章节范围']}`);
            if (vol.sections['核心剧情']) parts.push(`剧情：${vol.sections['核心剧情']}`);
            if (vol.sections['主线推进']) parts.push(`主线：${vol.sections['主线推进']}`);
            if (vol.sections['本卷高潮']) parts.push(`高潮：${vol.sections['本卷高潮']}`);
            if (vol.sections['结尾过渡']) parts.push(`结尾：${vol.sections['结尾过渡']}`);

            if (vol.chapters.length > 0) {
                const first3 = vol.chapters.slice(0, 3);
                const last3 = vol.chapters.slice(-3);
                const hints: string[] = [];
                for (const c of first3) hints.push(c.conflict);
                for (const c of last3) hints.push(c.conflict);
                parts.push(`冲突示例：${hints.join(' / ')}`);
            }
        }

        return parts.join('\n');
    }

    /**
     * onClose 方法。
     */
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
