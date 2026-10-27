import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from '../engine/ai-engine';
import { createLogger } from '../shared/logger';
import { CreateProjectModal } from './create-project-modal';
import { pjControlDir } from '../shared/paths';


const log = createLogger('IdeationModal');
interface IdeationIdea {
    id: string;
    coreConcept: string;
    conflictPoint: string;
    sellingPoint: string;
    suitableGenres: string[];
    scores: {
        marketHeat: number;
        innovation: number;
        writability: number;
        satisfactionDensity: number;
    };
    elevatorPitch: string;
    titleCandidates: string[];
    genreMatch: { genre: string; match: number }[];
    differentiation: string;
    coreCompetitive: string;
}

interface SavedIdea extends IdeationIdea {
    savedAt: number;
    keywords: string;
    selectedGenres: string[];
}

const GENRE_OPTIONS = [
    '玄幻', '仙侠', '都市', '科幻', '悬疑', '历史', '言情',
    '奇幻', '武侠', '末世', '灵异', '游戏', '竞技', '同人'
];

const STORAGE_KEY = 'novel-writer-ideation-favorites';

export class IdeationModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private currentStep: number = 0;
    private ideas: IdeationIdea[] = [];
    private selectedIdea: IdeationIdea | null = null;
    private selectedGenres: Set<string> = new Set();
    private savedIdeas: SavedIdea[] = [];
    private showHistory: boolean = false;
    private isGenerating: boolean = false;
    private keywords: string = '';
    private extraRequirements: string = '';

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
        this.loadSavedIdeas();
    }

    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();

        this.injectStyles();
        this.render();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        const header = contentEl.createDiv({ cls: 'nw-ideation-header' });
        header.createEl('h2', { text: '💡 脑洞构思工坊' });

        const tabs = header.createDiv({ cls: 'nw-ideation-tabs' });
        const ideationTab = tabs.createEl('button', {
            text: '创意发散',
            cls: `nw-ideation-tab ${!this.showHistory ? 'active' : ''}`
        });
        const historyTab = tabs.createEl('button', {
            text: `收藏夹 (${this.savedIdeas.length})`,
            cls: `nw-ideation-tab ${this.showHistory ? 'active' : ''}`
        });

        ideationTab.onclick = () => {
            this.showHistory = false;
            this.render();
        };
        historyTab.onclick = () => {
            this.showHistory = true;
            this.render();
        };

        if (this.showHistory) {
            this.renderHistory(contentEl);
        } else {
            this.renderStepNav(contentEl);
            if (this.currentStep === 0) {
                this.renderInputStep(contentEl);
            } else if (this.currentStep === 1) {
                this.renderIdeasStep(contentEl);
            } else if (this.currentStep === 2) {
                this.renderDetailStep(contentEl);
            }
        }
    }

    private renderStepNav(container: HTMLElement): void {
        const steps = [
            { label: '题材输入', icon: '📝' },
            { label: '创意发散', icon: '✨' },
            { label: '深度分析', icon: '🎯' }
        ];

        const nav = container.createDiv({ cls: 'nw-ideation-steps' });
        steps.forEach((step, idx) => {
            const stepEl = nav.createDiv({
                cls: `nw-ideation-step ${idx < this.currentStep ? 'done' : ''} ${idx === this.currentStep ? 'active' : ''}`
            });
            stepEl.createSpan({ text: step.icon, cls: 'nw-ideation-step-icon' });
            stepEl.createSpan({ text: step.label, cls: 'nw-ideation-step-label' });
            if (idx < steps.length - 1) {
                nav.createDiv({ cls: 'nw-ideation-step-line' });
            }
        });
    }

    private renderInputStep(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-ideation-section' });

        section.createEl('h3', { text: '📌 题材关键词', cls: 'nw-ideation-section-title' });
        const keywordInput = section.createEl('input', {
            type: 'text',
            placeholder: '输入核心题材关键词，如：重生、修仙、系统、末世...',
            cls: 'nw-input nw-ideation-input'
        });
        keywordInput.value = this.keywords;
        keywordInput.oninput = () => { this.keywords = keywordInput.value; };

        section.createEl('h3', { text: '🏷️ 类型标签（可多选）', cls: 'nw-ideation-section-title' });
        const tagContainer = section.createDiv({ cls: 'nw-ideation-tags' });
        GENRE_OPTIONS.forEach(genre => {
            const tag = tagContainer.createEl('button', {
                text: genre,
                cls: `nw-ideation-tag ${this.selectedGenres.has(genre) ? 'active' : ''}`
            });
            tag.onclick = () => {
                if (this.selectedGenres.has(genre)) {
                    this.selectedGenres.delete(genre);
                } else {
                    this.selectedGenres.add(genre);
                }
                tag.toggleClass('active', this.selectedGenres.has(genre));
            };
        });

        section.createEl('h3', { text: '💭 额外要求（可选）', cls: 'nw-ideation-section-title' });
        const extraInput = section.createEl('textarea', {
            cls: 'nw-textarea nw-ideation-textarea',
            attr: { rows: '3', placeholder: '补充创意方向、风格偏好、避免元素等...' }
        });
        extraInput.value = this.extraRequirements;
        extraInput.oninput = () => { this.extraRequirements = extraInput.value; };

        const btnContainer = container.createDiv({ cls: 'nw-ideation-btn-row' });
        const generateBtn = btnContainer.createEl('button', {
            text: '🚀 生成10个创意',
            cls: 'nw-btn nw-btn-primary'
        });
        generateBtn.onclick = async () => {
            const keywords = keywordInput.value.trim();
            if (!keywords && this.selectedGenres.size === 0) {
                new Notice('请输入关键词或选择至少一个类型标签', 3000);
                return;
            }
            await this.generateIdeas(keywords, Array.from(this.selectedGenres), extraInput.value.trim());
        };
    }

    private renderIdeasStep(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-ideation-section' });

        const actionRow = section.createDiv({ cls: 'nw-ideation-action-row' });
        actionRow.createEl('span', { text: `共 ${this.ideas.length} 个创意方向`, cls: 'nw-ideation-count' });

        const actions = actionRow.createDiv({ cls: 'nw-ideation-actions' });
        const refreshBtn = actions.createEl('button', {
            text: '🔄 换一批',
            cls: 'nw-btn nw-btn-secondary'
        });
        refreshBtn.onclick = async () => {
            await this.generateIdeas(
                this.keywords,
                Array.from(this.selectedGenres),
                this.extraRequirements,
            );
        };

        const backBtn = actions.createEl('button', {
            text: '← 返回',
            cls: 'nw-btn nw-btn-secondary'
        });
        backBtn.onclick = () => {
            this.currentStep = 0;
            this.render();
        };

        const grid = section.createDiv({ cls: 'nw-ideation-grid' });
        this.ideas.forEach((idea, idx) => {
            const card = grid.createDiv({ cls: 'nw-ideation-card' });
            const cardHeader = card.createDiv({ cls: 'nw-ideation-card-header' });
            cardHeader.createEl('span', { text: `#${idx + 1}`, cls: 'nw-ideation-card-num' });

            const favoriteBtn = cardHeader.createEl('button', {
                text: this.isIdeaSaved(idea.id) ? '❤️' : '🤍',
                cls: 'nw-ideation-fav-btn'
            });
            favoriteBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleFavorite(idea);
                favoriteBtn.setText(this.isIdeaSaved(idea.id) ? '❤️' : '🤍');
            };

            card.createEl('h4', { text: idea.coreConcept, cls: 'nw-ideation-card-title' });
            card.createEl('p', { text: `冲突：${idea.conflictPoint}`, cls: 'nw-ideation-card-desc' });
            card.createEl('p', { text: `卖点：${idea.sellingPoint}`, cls: 'nw-ideation-card-desc' });

            const genres = card.createDiv({ cls: 'nw-ideation-card-genres' });
            idea.suitableGenres.forEach(g => {
                genres.createEl('span', { text: g, cls: 'nw-ideation-card-genre' });
            });

            const scoreBar = card.createDiv({ cls: 'nw-ideation-score-bar' });
            const avgScore = this.calcAvgScore(idea.scores);
            scoreBar.createEl('span', { text: `综合评分: ${avgScore}`, cls: 'nw-ideation-score-text' });

            card.onclick = () => {
                this.selectedIdea = idea;
                this.currentStep = 2;
                this.render();
            };
        });
    }

    private renderDetailStep(container: HTMLElement): void {
        if (!this.selectedIdea) return;

        const idea = this.selectedIdea;
        const section = container.createDiv({ cls: 'nw-ideation-section' });

        const headerRow = section.createDiv({ cls: 'nw-ideation-detail-header' });
        const backBtn = headerRow.createEl('button', {
            text: '← 返回列表',
            cls: 'nw-btn nw-btn-secondary'
        });
        backBtn.onclick = () => {
            this.currentStep = 1;
            this.render();
        };

        const favBtn = headerRow.createEl('button', {
            text: this.isIdeaSaved(idea.id) ? '❤️ 已收藏' : '🤍 收藏',
            cls: 'nw-btn nw-btn-secondary'
        });
        favBtn.onclick = () => {
            this.toggleFavorite(idea);
            favBtn.setText(this.isIdeaSaved(idea.id) ? '❤️ 已收藏' : '🤍 收藏');
        };

        section.createEl('h3', { text: '🎯 核心概念', cls: 'nw-ideation-section-title' });
        section.createEl('p', { text: idea.coreConcept, cls: 'nw-ideation-detail-text' });

        if ((idea.titleCandidates || []).length > 0) {
            section.createEl('h3', { text: '📚 建议项目名', cls: 'nw-ideation-section-title' });
            section.createEl('p', { text: (idea.titleCandidates || []).join(' / '), cls: 'nw-ideation-detail-text' });
        }

        section.createEl('h3', { text: '⚡ 一句话梗概 (Elevator Pitch)', cls: 'nw-ideation-section-title' });
        section.createEl('p', { text: idea.elevatorPitch, cls: 'nw-ideation-elevator-pitch' });

        const analysisRow = section.createDiv({ cls: 'nw-ideation-analysis-row' });

        const radarSection = analysisRow.createDiv({ cls: 'nw-ideation-radar-section' });
        radarSection.createEl('h4', { text: '📊 多维度评分', cls: 'nw-ideation-subtitle' });
        this.renderRadarChart(radarSection, idea.scores);

        const scoreList = radarSection.createDiv({ cls: 'nw-ideation-score-list' });
        const scoreItems = [
            { label: '市场热度', value: idea.scores.marketHeat, color: '#ff6b6b' },
            { label: '创新性', value: idea.scores.innovation, color: '#4ecdc4' },
            { label: '可写性', value: idea.scores.writability, color: '#45b7d1' },
            { label: '爽点密度', value: idea.scores.satisfactionDensity, color: '#f9ca24' }
        ];
        scoreItems.forEach(item => {
            const row = scoreList.createDiv({ cls: 'nw-ideation-score-item' });
            row.createSpan({ text: item.label, cls: 'nw-ideation-score-label' });
            const barWrap = row.createDiv({ cls: 'nw-ideation-score-bar-wrap' });
            const bar = barWrap.createDiv({ cls: 'nw-ideation-score-bar-fill' });
            bar.style.width = `${item.value}%`;
            bar.style.background = item.color;
            row.createSpan({ text: `${item.value}分`, cls: 'nw-ideation-score-value' });
        });

        const matchSection = analysisRow.createDiv({ cls: 'nw-ideation-match-section' });
        matchSection.createEl('h4', { text: '🎭 题材类型匹配', cls: 'nw-ideation-subtitle' });
        idea.genreMatch.forEach(item => {
            const row = matchSection.createDiv({ cls: 'nw-ideation-match-item' });
            row.createSpan({ text: item.genre, cls: 'nw-ideation-match-genre' });
            const barWrap = row.createDiv({ cls: 'nw-ideation-match-bar' });
            const bar = barWrap.createDiv({ cls: 'nw-ideation-match-fill' });
            bar.style.width = `${item.match}%`;
            row.createSpan({ text: `${item.match}%`, cls: 'nw-ideation-match-value' });
        });
        const recommended = idea.genreMatch.slice(0, 3).map(g => g.genre).join('、');
        matchSection.createEl('p', {
            text: `💡 推荐方向：${recommended}`,
            cls: 'nw-ideation-recommend'
        });

        section.createEl('h3', { text: '🔥 冲突点', cls: 'nw-ideation-section-title' });
        section.createEl('p', { text: idea.conflictPoint, cls: 'nw-ideation-detail-text' });

        section.createEl('h3', { text: '💎 卖点分析', cls: 'nw-ideation-section-title' });
        section.createEl('p', { text: idea.sellingPoint, cls: 'nw-ideation-detail-text' });

        section.createEl('h3', { text: '🏆 竞品差异化分析', cls: 'nw-ideation-section-title' });
        section.createEl('p', { text: idea.differentiation, cls: 'nw-ideation-detail-text' });

        section.createEl('h3', { text: '⭐ 核心竞争力', cls: 'nw-ideation-section-title' });
        section.createEl('p', { text: idea.coreCompetitive, cls: 'nw-ideation-detail-text' });

        const exportBtn = section.createEl('button', {
            text: '📝 保存为项目资料',
            cls: 'nw-btn nw-btn-primary nw-ideation-export-btn'
        });
        exportBtn.onclick = () => this.exportAsProject(idea);
    }

    private renderRadarChart(container: HTMLElement, scores: IdeationIdea['scores']): void {
        const size = 180;
        const center = size / 2;
        const radius = size / 2 - 20;
        const dimensions = [
            { label: '市场热度', value: scores.marketHeat, angle: -Math.PI / 2 },
            { label: '创新性', value: scores.innovation, angle: 0 },
            { label: '可写性', value: scores.writability, angle: Math.PI / 2 },
            { label: '爽点密度', value: scores.satisfactionDensity, angle: Math.PI }
        ];

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
        svg.addClass('nw-ideation-radar-svg');

        for (let i = 1; i <= 5; i++) {
            const r = (radius * i) / 5;
            const points = dimensions.map((_, idx) => {
                const angle = -Math.PI / 2 + (idx * Math.PI * 2) / dimensions.length;
                const x = center + r * Math.cos(angle);
                const y = center + r * Math.sin(angle);
                return `${x},${y}`;
            }).join(' ');
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', points);
            polygon.setAttribute('fill', 'none');
            polygon.setAttribute('stroke', 'var(--background-modifier-border)');
            polygon.setAttribute('stroke-width', '1');
            svg.appendChild(polygon);
        }

        dimensions.forEach((dim, idx) => {
            const angle = -Math.PI / 2 + (idx * Math.PI * 2) / dimensions.length;
            const x = center + radius * Math.cos(angle);
            const y = center + radius * Math.sin(angle);
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(center));
            line.setAttribute('y1', String(center));
            line.setAttribute('x2', String(x));
            line.setAttribute('y2', String(y));
            line.setAttribute('stroke', 'var(--background-modifier-border)');
            line.setAttribute('stroke-width', '1');
            svg.appendChild(line);
        });

        const dataPoints = dimensions.map((dim, idx) => {
            const angle = -Math.PI / 2 + (idx * Math.PI * 2) / dimensions.length;
            const r = (radius * dim.value) / 100;
            const x = center + r * Math.cos(angle);
            const y = center + r * Math.sin(angle);
            return `${x},${y}`;
        }).join(' ');

        const dataPolygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        dataPolygon.setAttribute('points', dataPoints);
        dataPolygon.setAttribute('fill', 'var(--interactive-accent)');
        dataPolygon.setAttribute('fill-opacity', '0.3');
        dataPolygon.setAttribute('stroke', 'var(--interactive-accent)');
        dataPolygon.setAttribute('stroke-width', '2');
        svg.appendChild(dataPolygon);

        dimensions.forEach((dim, idx) => {
            const angle = -Math.PI / 2 + (idx * Math.PI * 2) / dimensions.length;
            const r = (radius * dim.value) / 100;
            const x = center + r * Math.cos(angle);
            const y = center + r * Math.sin(angle);
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', String(x));
            dot.setAttribute('cy', String(y));
            dot.setAttribute('r', '4');
            dot.setAttribute('fill', 'var(--interactive-accent)');
            svg.appendChild(dot);
        });

        dimensions.forEach((dim, idx) => {
            const angle = -Math.PI / 2 + (idx * Math.PI * 2) / dimensions.length;
            const labelRadius = radius + 15;
            const x = center + labelRadius * Math.cos(angle);
            const y = center + labelRadius * Math.sin(angle);
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', String(x));
            text.setAttribute('y', String(y));
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('font-size', '11');
            text.setAttribute('fill', 'var(--text-muted)');
            text.textContent = dim.label;
            svg.appendChild(text);
        });

        container.appendChild(svg);
    }

    private renderHistory(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-ideation-section' });

        if (this.savedIdeas.length === 0) {
            section.createEl('p', { text: '暂无收藏的创意', cls: 'nw-ideation-empty' });
            return;
        }

        section.createEl('p', { text: `共收藏 ${this.savedIdeas.length} 个创意`, cls: 'nw-ideation-count' });

        const list = section.createDiv({ cls: 'nw-ideation-history-list' });
        this.savedIdeas.forEach((saved, idx) => {
            const item = list.createDiv({ cls: 'nw-ideation-history-item' });
            const itemHeader = item.createDiv({ cls: 'nw-ideation-history-header' });
            itemHeader.createEl('span', { text: `#${idx + 1} ${saved.coreConcept}`, cls: 'nw-ideation-history-title' });
            const dateStr = new Date(saved.savedAt).toLocaleDateString();
            itemHeader.createEl('span', { text: dateStr, cls: 'nw-ideation-history-date' });

            item.createEl('p', { text: saved.elevatorPitch, cls: 'nw-ideation-history-pitch' });

            const tags = item.createDiv({ cls: 'nw-ideation-history-tags' });
            saved.selectedGenres.forEach(g => {
                tags.createEl('span', { text: g, cls: 'nw-ideation-history-tag' });
            });

            const actions = item.createDiv({ cls: 'nw-ideation-history-actions' });
            const viewBtn = actions.createEl('button', { text: '查看详情', cls: 'nw-btn nw-btn-secondary' });
            viewBtn.onclick = () => {
                this.selectedIdea = saved;
                this.showHistory = false;
                this.currentStep = 2;
                this.render();
            };

            const deleteBtn = actions.createEl('button', { text: '删除', cls: 'nw-btn nw-btn-danger' });
            deleteBtn.onclick = () => {
                this.removeFavorite(saved.id);
                this.render();
            };
        });
    }

    private async generateIdeas(keywords: string, genres: string[], extra?: string): Promise<void> {
        if (this.isGenerating) return;
        this.isGenerating = true;
        this.keywords = keywords;
        this.extraRequirements = extra || '';

        const notice = new Notice('⏳ 正在生成创意...', 0);

        try {
            const systemPrompt = `你是专业的网文创意策划师，擅长生成具有市场潜力的小说创意。
请根据用户提供的题材关键词和类型标签，生成10个不同方向的小说创意。

每个创意必须包含以下内容，严格使用JSON数组格式输出：
- coreConcept: 核心概念（一句话）
- conflictPoint: 核心冲突点
- sellingPoint: 核心卖点
- suitableGenres: 适合类型（数组，2-4个）
- scores: 评分对象
  - marketHeat: 市场热度（0-100）
  - innovation: 创新性（0-100）
  - writability: 可写性（0-100）
  - satisfactionDensity: 爽点密度（0-100）
- elevatorPitch: 一句话梗概（elevator pitch，30字以内）
- titleCandidates: 2-3 个可作项目名的书名候选（每个 2-10 个汉字，不含标点）
- genreMatch: 题材匹配度数组，每项包含 genre 和 match(0-100)
- differentiation: 与同类热门作品的差异化分析
- coreCompetitive: 核心竞争力

要求：
1. 10个创意方向要有明显差异，覆盖不同切入点
2. 结合当前网文市场热点，确保创意有商业价值
3. 冲突点要明确，有足够的戏剧张力
4. 评分要客观合理，不能全部高分
5. 只输出JSON数组，不要任何解释文字`;

            const userPrompt = `题材关键词：${keywords || '无'}
类型标签：${genres.length > 0 ? genres.join('、') : '不限'}
额外要求：${extra || '无'}

请生成10个不同方向的创意。`;

            const result = await this.aiEngine.callAI(systemPrompt, userPrompt, undefined, 0.8, 8192);
            notice.hide();

            if (result.error) {
                new Notice(`❌ 生成失败: ${result.error}`, 5000);
                this.isGenerating = false;
                return;
            }

            const parsed = this.parseIdeasResponse(result.content);
            if (parsed.length === 0) {
                new Notice('❌ 解析创意失败，请重试', 5000);
                this.isGenerating = false;
                return;
            }

            this.ideas = parsed;
            this.currentStep = 1;
            this.render();
            new Notice(`✅ 已生成 ${parsed.length} 个创意`, 3000);
        } catch (e) {
            notice.hide();
            log.error('[IdeationModal] 生成创意失败:', e);
            new Notice('❌ 生成创意出错，请稍后重试', 5000);
        }

        this.isGenerating = false;
    }

    private parseIdeasResponse(content: string): IdeationIdea[] {
        try {
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (!jsonMatch) return [];

            const arr = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(arr)) return [];

            return arr.map((item: any, idx: number) => ({
                id: `idea_${Date.now()}_${idx}`,
                coreConcept: item.coreConcept || '未命名创意',
                conflictPoint: item.conflictPoint || '',
                sellingPoint: item.sellingPoint || '',
                suitableGenres: Array.isArray(item.suitableGenres) ? item.suitableGenres : [],
                scores: {
                    marketHeat: item.scores?.marketHeat || 70,
                    innovation: item.scores?.innovation || 70,
                    writability: item.scores?.writability || 70,
                    satisfactionDensity: item.scores?.satisfactionDensity || 70
                },
                elevatorPitch: item.elevatorPitch || '',
                titleCandidates: Array.isArray(item.titleCandidates)
                    ? item.titleCandidates.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 3)
                    : [],
                genreMatch: Array.isArray(item.genreMatch) ? item.genreMatch : [],
                differentiation: item.differentiation || '',
                coreCompetitive: item.coreCompetitive || ''
            }));
        } catch (e) {
            log.warn('[IdeationModal] 解析创意响应失败:', e);
            return [];
        }
    }

    private calcAvgScore(scores: IdeationIdea['scores']): number {
        const sum = scores.marketHeat + scores.innovation + scores.writability + scores.satisfactionDensity;
        return Math.round(sum / 4);
    }

    private isIdeaSaved(ideaId: string): boolean {
        return this.savedIdeas.some(s => s.id === ideaId);
    }

    private toggleFavorite(idea: IdeationIdea): void {
        if (this.isIdeaSaved(idea.id)) {
            this.removeFavorite(idea.id);
        } else {
            this.saveFavorite(idea);
        }
    }

    private saveFavorite(idea: IdeationIdea): void {
        const saved: SavedIdea = {
            ...idea,
            savedAt: Date.now(),
            keywords: this.keywords,
            selectedGenres: Array.from(this.selectedGenres)
        };
        this.savedIdeas.unshift(saved);
        this.persistSavedIdeas();
        new Notice('✅ 已收藏', 2000);
    }

    private removeFavorite(ideaId: string): void {
        this.savedIdeas = this.savedIdeas.filter(s => s.id !== ideaId);
        this.persistSavedIdeas();
        new Notice('已取消收藏', 2000);
    }

    private loadSavedIdeas(): void {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (data) {
                this.savedIdeas = JSON.parse(data);
            }
        } catch (e) {
            log.warn('[IdeationModal] 加载收藏失败:', e);
            this.savedIdeas = [];
        }
    }

    private persistSavedIdeas(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.savedIdeas));
        } catch (e) {
            log.warn('[IdeationModal] 保存收藏失败:', e);
        }
    }

    private async exportAsProject(idea: IdeationIdea): Promise<void> {
        const active = this.plugin.getActiveProject();
        if (active) {
            this.showExportChoice(idea, active);
            return;
        }
        this.openCreateProject(idea);
    }

    private showExportChoice(idea: IdeationIdea, activeProject: string): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('📁 保存脑洞');
        const content = modal.contentEl.createDiv({ cls: 'nw-form-stack' });
        content.createEl('p', {
            text: `当前项目：${activeProject}。可以保存到当前项目，或基于这个脑洞创建新项目。`,
            cls: 'setting-item-description',
        });
        const saveCurrent = content.createEl('button', {
            text: `保存到当前项目「${activeProject}」`,
            cls: 'nw-btn nw-btn-primary',
        });
        saveCurrent.onclick = async () => {
            modal.close();
            await this.saveIdeaToProject(activeProject, idea);
        };
        const createNew = content.createEl('button', {
            text: '基于脑洞创建新项目',
            cls: 'nw-btn nw-btn-secondary',
        });
        createNew.onclick = () => {
            modal.close();
            this.openCreateProject(idea);
        };
        const cancel = content.createEl('button', { text: '取消', cls: 'nw-btn' });
        cancel.onclick = () => modal.close();
        modal.open();
    }

    private openCreateProject(idea: IdeationIdea): void {
        const name = (idea.titleCandidates || [])[0] || idea.coreConcept;
        const genre = idea.suitableGenres[0] || Array.from(this.selectedGenres)[0] || '玄幻';
        new CreateProjectModal(this.app, this.plugin, {
            name,
            genre,
            description: idea.elevatorPitch || idea.conflictPoint,
            projectType: 'original',
                        onCreated: async (projectName) => {
                await this.saveIdeaToProject(projectName, idea);
            },
        }).open();
    }

    private async saveIdeaToProject(project: string, idea: IdeationIdea): Promise<void> {
        try {
            const dir = pjControlDir(project);
            await this.ensureFolder(dir);
            const filePath = `${dir}/脑洞构思.md`;
            const content = this.buildIdeaContent(idea);
            const existing = this.app.vault.getAbstractFileByPath(filePath);
            if (existing instanceof TFile) {
                const old = await this.app.vault.read(existing);
                await this.app.vault.modify(existing, `${old.trimEnd()}\n\n---\n\n${content}`);
            } else {
                await this.app.vault.create(filePath, content);
            }
            new Notice(`✅ 已保存到「${project}/04-项目总控/脑洞构思.md」`, 5000);
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                const leaf = this.app.workspace.getLeaf('tab');
                await leaf.openFile(file);
            }
            this.close();
        } catch (e) {
            log.error('[IdeationModal] 保存脑洞失败:', e);
            new Notice('❌ 保存失败，请检查权限', 5000);
        }
    }

    private buildIdeaContent(idea: IdeationIdea): string {
        return `---
tags: [脑洞创意, 项目设定]
创意来源: 脑洞构思工坊
生成时间: ${new Date().toISOString()}
---

# ${idea.coreConcept}

## 🎯 一句话梗概

${idea.elevatorPitch}

## 📚 建议项目名

${(idea.titleCandidates || []).length > 0 ? (idea.titleCandidates || []).join(' / ') : '（无）'}

## ⚔️ 核心冲突

${idea.conflictPoint}

## 💎 核心卖点

${idea.sellingPoint}

## 📊 创意评估

| 维度 | 评分 |
| --- | --- |
| 市场热度 | ${idea.scores.marketHeat} |
| 创新性 | ${idea.scores.innovation} |
| 可写性 | ${idea.scores.writability} |
| 爽点密度 | ${idea.scores.satisfactionDensity} |
| **综合** | **${this.calcAvgScore(idea.scores)}** |

## 🎭 推荐题材

${idea.genreMatch.slice(0, 3).map(g => `- ${g.genre} (${g.match}%)`).join('\n')}

## 🏆 差异化分析

${idea.differentiation}

## ⭐ 核心竞争力

${idea.coreCompetitive}

## 📌 适合类型

${idea.suitableGenres.join('、')}
`;
    }

    private async ensureFolder(path: string): Promise<void> {
        const parts = path.split('/').filter(Boolean);
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            const existing = this.app.vault.getAbstractFileByPath(current);
            if (!existing) {
                await this.app.vault.createFolder(current);
            } else if (!(existing instanceof TFolder)) {
                throw new Error(`路径已被文件占用：${current}`);
            }
        }
    }

    private injectStyles(): void {
        const styleId = 'novel-writer-ideation-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
.nw-ideation-header {
    margin-bottom: 16px;
}
.nw-ideation-tabs {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    border-bottom: 1px solid var(--background-modifier-border);
}
.nw-ideation-tab {
    padding: 8px 16px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
}
.nw-ideation-tab:hover {
    color: var(--text-normal);
}
.nw-ideation-tab.active {
    color: var(--interactive-accent);
    border-bottom-color: var(--interactive-accent);
}
.nw-ideation-steps {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px 0;
    margin-bottom: 16px;
    background: var(--background-secondary);
    border-radius: 8px;
}
.nw-ideation-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 80px;
}
.nw-ideation-step-icon {
    font-size: 20px;
}
.nw-ideation-step-label {
    font-size: 12px;
    color: var(--text-muted);
}
.nw-ideation-step.active .nw-ideation-step-label {
    color: var(--interactive-accent);
    font-weight: 600;
}
.nw-ideation-step.done .nw-ideation-step-label {
    color: var(--text-success);
}
.nw-ideation-step-line {
    width: 40px;
    height: 2px;
    background: var(--background-modifier-border);
    margin: 0 8px;
    margin-bottom: 16px;
}
.nw-ideation-section {
    margin-bottom: 20px;
}
.nw-ideation-section-title {
    margin: 16px 0 8px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
}
.nw-ideation-input {
    width: 100%;
    padding: 10px 12px;
    font-size: 14px;
    box-sizing: border-box;
}
.nw-ideation-textarea {
    width: 100%;
    font-size: 13px;
    box-sizing: border-box;
}
.nw-ideation-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.nw-ideation-tag {
    padding: 6px 14px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 16px;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
}
.nw-ideation-tag:hover {
    border-color: var(--interactive-accent);
    color: var(--interactive-accent);
}
.nw-ideation-tag.active {
    background: var(--interactive-accent);
    border-color: var(--interactive-accent);
    color: white;
}
.nw-ideation-btn-row {
    display: flex;
    justify-content: center;
    margin-top: 24px;
}
.nw-ideation-action-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
}
.nw-ideation-count {
    font-size: 13px;
    color: var(--text-muted);
}
.nw-ideation-actions {
    display: flex;
    gap: 8px;
}
.nw-ideation-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
}
.nw-ideation-card {
    padding: 12px;
    background: var(--background-secondary);
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
    cursor: pointer;
    transition: all 0.2s;
}
.nw-ideation-card:hover {
    border-color: var(--interactive-accent);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.nw-ideation-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
}
.nw-ideation-card-num {
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 600;
}
.nw-ideation-fav-btn {
    background: none;
    border: none;
    font-size: 16px;
    cursor: pointer;
    padding: 2px 4px;
}
.nw-ideation-card-title {
    margin: 0 0 8px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.4;
}
.nw-ideation-card-desc {
    margin: 4px 0;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
}
.nw-ideation-card-genres {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
}
.nw-ideation-card-genre {
    padding: 2px 8px;
    background: var(--background-primary);
    border-radius: 10px;
    font-size: 11px;
    color: var(--text-muted);
}
.nw-ideation-score-bar {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--background-modifier-border);
}
.nw-ideation-score-text {
    font-size: 12px;
    font-weight: 600;
    color: var(--interactive-accent);
}
.nw-ideation-detail-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 16px;
}
.nw-ideation-detail-text {
    padding: 12px;
    background: var(--background-secondary);
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-primary);
}
.nw-ideation-elevator-pitch {
    padding: 16px;
    background: linear-gradient(135deg, var(--interactive-accent), var(--interactive-accent-hover));
    border-radius: 8px;
    font-size: 15px;
    font-weight: 600;
    color: white;
    line-height: 1.6;
}
.nw-ideation-analysis-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin: 16px 0;
}
@media (max-width: 600px) {
    .nw-ideation-analysis-row {
        grid-template-columns: 1fr;
    }
}
.nw-ideation-radar-section,
.nw-ideation-match-section {
    padding: 12px;
    background: var(--background-secondary);
    border-radius: 8px;
}
.nw-ideation-subtitle {
    margin: 0 0 12px 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
}
.nw-ideation-radar-svg {
    display: block;
    margin: 0 auto 12px auto;
}
.nw-ideation-score-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.nw-ideation-score-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
}
.nw-ideation-score-label {
    min-width: 60px;
    color: var(--text-muted);
}
.nw-ideation-score-bar-wrap {
    flex: 1;
    height: 8px;
    background: var(--background-primary);
    border-radius: 4px;
    overflow: hidden;
}
.nw-ideation-score-bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s;
}
.nw-ideation-score-value {
    min-width: 35px;
    text-align: right;
    font-weight: 600;
    color: var(--text-primary);
}
.nw-ideation-match-item {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 12px;
}
.nw-ideation-match-genre {
    min-width: 50px;
    color: var(--text-muted);
}
.nw-ideation-match-bar {
    flex: 1;
    height: 8px;
    background: var(--background-primary);
    border-radius: 4px;
    overflow: hidden;
}
.nw-ideation-match-fill {
    height: 100%;
    background: var(--interactive-accent);
    border-radius: 4px;
    transition: width 0.3s;
}
.nw-ideation-match-value {
    min-width: 35px;
    text-align: right;
    font-weight: 600;
    color: var(--text-primary);
}
.nw-ideation-recommend {
    margin: 12px 0 0 0;
    padding: 8px;
    background: var(--background-primary);
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-muted);
}
.nw-ideation-export-btn {
    width: 100%;
    margin-top: 20px;
    padding: 12px;
    font-size: 14px;
}
.nw-ideation-empty {
    text-align: center;
    padding: 40px;
    color: var(--text-muted);
}
.nw-ideation-history-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.nw-ideation-history-item {
    padding: 12px;
    background: var(--background-secondary);
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
}
.nw-ideation-history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
}
.nw-ideation-history-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
}
.nw-ideation-history-date {
    font-size: 12px;
    color: var(--text-muted);
}
.nw-ideation-history-pitch {
    margin: 8px 0;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
}
.nw-ideation-history-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
}
.nw-ideation-history-tag {
    padding: 2px 8px;
    background: var(--background-primary);
    border-radius: 10px;
    font-size: 11px;
    color: var(--text-muted);
}
.nw-ideation-history-actions {
    display: flex;
    gap: 8px;
}
.nw-btn-secondary {
    padding: 6px 12px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    color: var(--text-normal);
    cursor: pointer;
    font-size: 12px;
}
.nw-btn-secondary:hover {
    border-color: var(--interactive-accent);
    color: var(--interactive-accent);
}
.nw-btn-danger {
    padding: 6px 12px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-error);
    border-radius: 6px;
    color: var(--text-error);
    cursor: pointer;
    font-size: 12px;
}
.nw-btn-danger:hover {
    background: var(--background-modifier-error);
    color: white;
}
`;
        document.head.appendChild(style);
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
