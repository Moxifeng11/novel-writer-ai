import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { AIEngine } from '@/engine/ai-engine';
import { createLogger } from '@/shared/logger';
import { CreateProjectModal } from './create-project-modal';
import { pjControlDir } from '@/shared/paths';
import { STORAGE_KEYS } from '@/shared/storage-keys';
import { vaultLoad, vaultSave } from '@/shared/local-storage';
import { showErrorNotice, showSuccessNotice } from '@/ui/components/notice-helpers';
import { t } from '@/i18n';
import { progressHandle } from '@/utils/helpers';
import { ModalDirtyGuard } from './components/modal-dirty-guard';


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

/** AI 返回的原始创意项（字段可能缺失或类型不规范，解析时再归一化） */
interface RawIdeationIdea {
    coreConcept?: string;
    conflictPoint?: string;
    sellingPoint?: string;
    suitableGenres?: unknown;
    scores?: Partial<IdeationIdea['scores']>;
    elevatorPitch?: string;
    titleCandidates?: unknown;
    genreMatch?: unknown;
    differentiation?: string;
    coreCompetitive?: string;
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

/**
 * 题材标签的显示名。
 * 存储值仍是 GENRE_OPTIONS 里的中文：提示词「类型标签：…」、CreateProjectModal 的 genre
 * 与收藏里的 selectedGenres 都以中文为准，所以只在渲染时翻译。
 */
function genreLabel(genre: string): string {
    switch (genre) {
        case '玄幻': return t('ideation.genre.xuanhuan');
        case '仙侠': return t('ideation.genre.xianxia');
        case '都市': return t('ideation.genre.urban');
        case '科幻': return t('ideation.genre.scifi');
        case '悬疑': return t('ideation.genre.mystery');
        case '历史': return t('ideation.genre.history');
        case '言情': return t('ideation.genre.romance');
        case '奇幻': return t('ideation.genre.fantasy');
        case '武侠': return t('ideation.genre.wuxia');
        case '末世': return t('ideation.genre.apocalypse');
        case '灵异': return t('ideation.genre.supernatural');
        case '游戏': return t('ideation.genre.game');
        case '竞技': return t('ideation.genre.competitive');
        case '同人': return t('ideation.genre.fanfic');
        default: return genre;
    }
}

/**
 * IdeationModal 类。
 */
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
    /** 未保存修改的关闭确认（审计 A-5） */
    private dirtyGuard = new ModalDirtyGuard();

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
        this.loadSavedIdeas();
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
        }
        contentEl.empty();
        this.dirtyGuard.attach(this, this.app);
        contentEl.addEventListener('input', () => this.dirtyGuard.markDirty());
        contentEl.addEventListener('change', () => this.dirtyGuard.markDirty());

        this.render();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        const header = contentEl.createDiv({ cls: 'nw-ideation-header' });
        header.createEl('h2', { text: t('ideation.title') });

        const tabs = header.createDiv({ cls: 'nw-ideation-tabs' });
        const ideationTab = tabs.createEl('button', {
            text: t('ideation.tab.ideas'),
            cls: `nw-ideation-tab ${!this.showHistory ? 'active' : ''}`
        });
        const historyTab = tabs.createEl('button', {
            text: t('ideation.tab.favorites', { count: this.savedIdeas.length }),
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
            { label: t('ideation.step.input'), icon: '📝' },
            { label: t('ideation.step.ideas'), icon: '✨' },
            { label: t('ideation.step.detail'), icon: '🎯' }
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

        section.createEl('h3', { text: t('ideation.input.keywordsTitle'), cls: 'nw-ideation-section-title' });
        const keywordInput = section.createEl('input', {
            type: 'text',
            placeholder: t('ideation.input.keywordsPlaceholder'),
            cls: 'nw-input nw-ideation-input'
        });
        keywordInput.value = this.keywords;
        keywordInput.oninput = () => { this.keywords = keywordInput.value; };

        section.createEl('h3', { text: t('ideation.input.genresTitle'), cls: 'nw-ideation-section-title' });
        const tagContainer = section.createDiv({ cls: 'nw-ideation-tags' });
        GENRE_OPTIONS.forEach(genre => {
            const tag = tagContainer.createEl('button', {
                text: genreLabel(genre),
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

        section.createEl('h3', { text: t('ideation.input.extraTitle'), cls: 'nw-ideation-section-title' });
        const extraInput = section.createEl('textarea', {
            cls: 'nw-textarea nw-ideation-textarea',
            attr: { rows: '3', placeholder: t('ideation.input.extraPlaceholder') }
        });
        extraInput.value = this.extraRequirements;
        extraInput.oninput = () => { this.extraRequirements = extraInput.value; };

        const btnContainer = container.createDiv({ cls: 'nw-ideation-btn-row' });
        const generateBtn = btnContainer.createEl('button', {
            text: t('ideation.input.generate'),
            cls: 'nw-btn nw-btn-primary'
        });
        generateBtn.onclick = async () => {
            const keywords = keywordInput.value.trim();
            if (!keywords && this.selectedGenres.size === 0) {
                new Notice(t('ideation.input.needInput'), 3000);
                return;
            }
            await this.generateIdeas(keywords, Array.from(this.selectedGenres), extraInput.value.trim());
        };
    }

    private renderIdeasStep(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-ideation-section' });

        const actionRow = section.createDiv({ cls: 'nw-ideation-action-row' });
        actionRow.createSpan({
            text: t('ideation.list.count', { count: this.ideas.length }),
            cls: 'nw-ideation-count',
        });

        const actions = actionRow.createDiv({ cls: 'nw-ideation-actions' });
        const refreshBtn = actions.createEl('button', {
            text: t('ideation.list.refresh'),
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
            text: t('ideation.list.back'),
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
            cardHeader.createSpan({ text: `#${idx + 1}`, cls: 'nw-ideation-card-num' });

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
            card.createEl('p', { text: t('ideation.list.conflict', { text: idea.conflictPoint }), cls: 'nw-ideation-card-desc' });
            card.createEl('p', { text: t('ideation.list.sellingPoint', { text: idea.sellingPoint }), cls: 'nw-ideation-card-desc' });

            const genres = card.createDiv({ cls: 'nw-ideation-card-genres' });
            idea.suitableGenres.forEach(g => {
                genres.createSpan({ text: genreLabel(g), cls: 'nw-ideation-card-genre' });
            });

            const scoreBar = card.createDiv({ cls: 'nw-ideation-score-bar' });
            const avgScore = this.calcAvgScore(idea.scores);
            scoreBar.createSpan({
                text: t('ideation.list.avgScore', { score: avgScore }),
                cls: 'nw-ideation-score-text',
            });

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
            text: t('ideation.detail.back'),
            cls: 'nw-btn nw-btn-secondary'
        });
        backBtn.onclick = () => {
            this.currentStep = 1;
            this.render();
        };

        const favBtn = headerRow.createEl('button', {
            text: this.isIdeaSaved(idea.id) ? t('ideation.detail.saved') : t('ideation.detail.save'),
            cls: 'nw-btn nw-btn-secondary'
        });
        favBtn.onclick = () => {
            this.toggleFavorite(idea);
            favBtn.setText(this.isIdeaSaved(idea.id) ? t('ideation.detail.saved') : t('ideation.detail.save'));
        };

        section.createEl('h3', { text: t('ideation.detail.coreConcept'), cls: 'nw-ideation-section-title' });
        section.createEl('p', { text: idea.coreConcept, cls: 'nw-ideation-detail-text' });

        if ((idea.titleCandidates || []).length > 0) {
            section.createEl('h3', { text: t('ideation.detail.titleCandidates'), cls: 'nw-ideation-section-title' });
            section.createEl('p', { text: (idea.titleCandidates || []).join(' / '), cls: 'nw-ideation-detail-text' });
        }

        section.createEl('h3', { text: t('ideation.detail.elevatorPitch'), cls: 'nw-ideation-section-title' });
        section.createEl('p', { text: idea.elevatorPitch, cls: 'nw-ideation-elevator-pitch' });

        const analysisRow = section.createDiv({ cls: 'nw-ideation-analysis-row' });

        const radarSection = analysisRow.createDiv({ cls: 'nw-ideation-radar-section' });
        radarSection.createEl('h4', { text: t('ideation.detail.scores'), cls: 'nw-ideation-subtitle' });
        this.renderRadarChart(radarSection, idea.scores);

        const scoreList = radarSection.createDiv({ cls: 'nw-ideation-score-list' });
        const scoreItems = [
            { label: t('ideation.dim.marketHeat'), value: idea.scores.marketHeat, color: '#ff6b6b' },
            { label: t('ideation.dim.innovation'), value: idea.scores.innovation, color: '#4ecdc4' },
            { label: t('ideation.dim.writability'), value: idea.scores.writability, color: '#45b7d1' },
            { label: t('ideation.dim.satisfaction'), value: idea.scores.satisfactionDensity, color: '#f9ca24' }
        ];
        scoreItems.forEach(item => {
            const row = scoreList.createDiv({ cls: 'nw-ideation-score-item' });
            row.createSpan({ text: item.label, cls: 'nw-ideation-score-label' });
            const barWrap = row.createDiv({ cls: 'nw-ideation-score-bar-wrap' });
            const bar = barWrap.createDiv({ cls: 'nw-ideation-score-bar-fill' });
            bar.style.width = `${item.value}%`;
            bar.style.background = item.color;
            row.createSpan({ text: t('ideation.detail.scoreValue', { value: item.value }), cls: 'nw-ideation-score-value' });
        });

        const matchSection = analysisRow.createDiv({ cls: 'nw-ideation-match-section' });
        matchSection.createEl('h4', { text: t('ideation.detail.genreMatch'), cls: 'nw-ideation-subtitle' });
        idea.genreMatch.forEach(item => {
            const row = matchSection.createDiv({ cls: 'nw-ideation-match-item' });
            row.createSpan({ text: genreLabel(item.genre), cls: 'nw-ideation-match-genre' });
            const barWrap = row.createDiv({ cls: 'nw-ideation-match-bar' });
            const bar = barWrap.createDiv({ cls: 'nw-ideation-match-fill' });
            bar.style.width = `${item.match}%`;
            row.createSpan({ text: `${item.match}%`, cls: 'nw-ideation-match-value' });
        });
        const recommended = idea.genreMatch
            .slice(0, 3)
            .map(g => genreLabel(g.genre))
            .join(t('ideation.detail.recommendSeparator'));
        matchSection.createEl('p', {
            text: t('ideation.detail.recommend', { genres: recommended }),
            cls: 'nw-ideation-recommend'
        });

        section.createEl('h3', { text: t('ideation.detail.conflict'), cls: 'nw-ideation-section-title' });
        section.createEl('p', { text: idea.conflictPoint, cls: 'nw-ideation-detail-text' });

        section.createEl('h3', { text: t('ideation.detail.sellingPoint'), cls: 'nw-ideation-section-title' });
        section.createEl('p', { text: idea.sellingPoint, cls: 'nw-ideation-detail-text' });

        section.createEl('h3', { text: t('ideation.detail.differentiation'), cls: 'nw-ideation-section-title' });
        section.createEl('p', { text: idea.differentiation, cls: 'nw-ideation-detail-text' });

        section.createEl('h3', { text: t('ideation.detail.competitive'), cls: 'nw-ideation-section-title' });
        section.createEl('p', { text: idea.coreCompetitive, cls: 'nw-ideation-detail-text' });

        const exportBtn = section.createEl('button', {
            text: t('ideation.detail.export'),
            cls: 'nw-btn nw-btn-primary nw-ideation-export-btn'
        });
        exportBtn.onclick = () => this.exportAsProject(idea);
    }

    private renderRadarChart(container: HTMLElement, scores: IdeationIdea['scores']): void {
        // 画布放宽到 220×200：180 正方形时左右两个维度名（英文最长 "Writability"）
        // 会被 svg 视口裁掉；雷达只放短名，全名在下方评分列表里。
        const width = 220;
        const height = 200;
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = 62;
        const dimensions = [
            { label: t('ideation.dim.radar.marketHeat'), value: scores.marketHeat, angle: -Math.PI / 2 },
            { label: t('ideation.dim.radar.innovation'), value: scores.innovation, angle: 0 },
            { label: t('ideation.dim.radar.writability'), value: scores.writability, angle: Math.PI / 2 },
            { label: t('ideation.dim.radar.satisfaction'), value: scores.satisfactionDensity, angle: Math.PI }
        ];

        const svg = createSvg('svg');
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        svg.addClass('nw-ideation-radar-svg');

        for (let i = 1; i <= 5; i++) {
            const r = (radius * i) / 5;
            const points = dimensions.map((_, idx) => {
                const angle = -Math.PI / 2 + (idx * Math.PI * 2) / dimensions.length;
                const x = centerX + r * Math.cos(angle);
                const y = centerY + r * Math.sin(angle);
                return `${x},${y}`;
            }).join(' ');
            const polygon = createSvg('polygon');
            polygon.setAttribute('points', points);
            polygon.setAttribute('fill', 'none');
            polygon.setAttribute('stroke', 'var(--background-modifier-border)');
            polygon.setAttribute('stroke-width', '1');
            svg.appendChild(polygon);
        }

        dimensions.forEach((dim, idx) => {
            const angle = -Math.PI / 2 + (idx * Math.PI * 2) / dimensions.length;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            const line = createSvg('line');
            line.setAttribute('x1', String(centerX));
            line.setAttribute('y1', String(centerY));
            line.setAttribute('x2', String(x));
            line.setAttribute('y2', String(y));
            line.setAttribute('stroke', 'var(--background-modifier-border)');
            line.setAttribute('stroke-width', '1');
            svg.appendChild(line);
        });

        const dataPoints = dimensions.map((dim, idx) => {
            const angle = -Math.PI / 2 + (idx * Math.PI * 2) / dimensions.length;
            const r = (radius * dim.value) / 100;
            const x = centerX + r * Math.cos(angle);
            const y = centerY + r * Math.sin(angle);
            return `${x},${y}`;
        }).join(' ');

        const dataPolygon = createSvg('polygon');
        dataPolygon.setAttribute('points', dataPoints);
        dataPolygon.setAttribute('fill', 'var(--interactive-accent)');
        dataPolygon.setAttribute('fill-opacity', '0.3');
        dataPolygon.setAttribute('stroke', 'var(--interactive-accent)');
        dataPolygon.setAttribute('stroke-width', '2');
        svg.appendChild(dataPolygon);

        dimensions.forEach((dim, idx) => {
            const angle = -Math.PI / 2 + (idx * Math.PI * 2) / dimensions.length;
            const r = (radius * dim.value) / 100;
            const x = centerX + r * Math.cos(angle);
            const y = centerY + r * Math.sin(angle);
            const dot = createSvg('circle');
            dot.setAttribute('cx', String(x));
            dot.setAttribute('cy', String(y));
            dot.setAttribute('r', '4');
            dot.setAttribute('fill', 'var(--interactive-accent)');
            svg.appendChild(dot);
        });

        dimensions.forEach((dim, idx) => {
            const angle = -Math.PI / 2 + (idx * Math.PI * 2) / dimensions.length;
            const labelRadius = radius + 14;
            const x = centerX + labelRadius * Math.cos(angle);
            const y = centerY + labelRadius * Math.sin(angle);
            const text = createSvg('text');
            text.setAttribute('x', String(x));
            text.setAttribute('y', String(y));
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('font-size', '10');
            text.setAttribute('fill', 'var(--text-muted)');
            text.textContent = dim.label;
            svg.appendChild(text);
            // 兜底：真实浏览器里量一次宽度，万一某种语言仍顶到画布边缘就贴边并把锚点翻向内侧。
            // jsdom 没有 getComputedTextLength，量不到就保留默认居中（测试只断言结构）。
            try {
                const labelWidth = text.getComputedTextLength();
                if (labelWidth > 0 && x - labelWidth / 2 < 2) {
                    text.setAttribute('x', '2');
                    text.setAttribute('text-anchor', 'start');
                } else if (labelWidth > 0 && x + labelWidth / 2 > width - 2) {
                    text.setAttribute('x', String(width - 2));
                    text.setAttribute('text-anchor', 'end');
                }
            } catch { // silent-ok: jsdom 没有 getComputedTextLength，保留默认居中即可，不影响结构断言
            }
        });

        container.appendChild(svg);
    }

    private renderHistory(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-ideation-section' });

        if (this.savedIdeas.length === 0) {
            section.createEl('p', { text: t('ideation.history.empty'), cls: 'nw-ideation-empty' });
            return;
        }

        section.createEl('p', {
            text: t('ideation.history.count', { count: this.savedIdeas.length }),
            cls: 'nw-ideation-count',
        });

        const list = section.createDiv({ cls: 'nw-ideation-history-list' });
        this.savedIdeas.forEach((saved, idx) => {
            const item = list.createDiv({ cls: 'nw-ideation-history-item' });
            const itemHeader = item.createDiv({ cls: 'nw-ideation-history-header' });
            itemHeader.createSpan({ text: `#${idx + 1} ${saved.coreConcept}`, cls: 'nw-ideation-history-title' });
            const dateStr = new Date(saved.savedAt).toLocaleDateString();
            itemHeader.createSpan({ text: dateStr, cls: 'nw-ideation-history-date' });

            item.createEl('p', { text: saved.elevatorPitch, cls: 'nw-ideation-history-pitch' });

            const tags = item.createDiv({ cls: 'nw-ideation-history-tags' });
            saved.selectedGenres.forEach(g => {
                tags.createSpan({ text: genreLabel(g), cls: 'nw-ideation-history-tag' });
            });

            const actions = item.createDiv({ cls: 'nw-ideation-history-actions' });
            const viewBtn = actions.createEl('button', { text: t('ideation.history.view'), cls: 'nw-btn nw-btn-secondary' });
            viewBtn.onclick = () => {
                this.selectedIdea = saved;
                this.showHistory = false;
                this.currentStep = 2;
                this.render();
            };

            const deleteBtn = actions.createEl('button', { text: t('ideation.history.delete'), cls: 'nw-btn nw-btn-danger' });
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

        const notice = progressHandle('ideation-generate', t('ideation.notice.generating'));

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
                showErrorNotice(t('ideation.notice.generateFailed', { error: result.error }), { timeout: 5000 });
                this.isGenerating = false;
                return;
            }

            const parsed = this.parseIdeasResponse(result.content);
            if (parsed.length === 0) {
                showErrorNotice(t('ideation.notice.parseFailed'), { timeout: 5000 });
                this.isGenerating = false;
                return;
            }

            this.ideas = parsed;
            this.currentStep = 1;
            this.render();
            showSuccessNotice(t('ideation.notice.generated', { count: parsed.length }), { timeout: 3000 });
        } catch (e) {
            notice.hide();
            log.error('[IdeationModal] 生成创意失败:', e);
            showErrorNotice(t('ideation.notice.generateError'), { timeout: 5000 });
        }

        this.isGenerating = false;
    }

    private parseIdeasResponse(content: string): IdeationIdea[] {
        try {
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (!jsonMatch) return [];

            const arr = JSON.parse(jsonMatch[0]) as unknown;
            if (!Array.isArray(arr)) return [];

            return (arr as RawIdeationIdea[]).map((item, idx: number) => ({
                id: `idea_${Date.now()}_${idx}`,
                coreConcept: item.coreConcept || t('ideation.fallback.unnamed'),
                conflictPoint: item.conflictPoint || '',
                sellingPoint: item.sellingPoint || '',
                suitableGenres: Array.isArray(item.suitableGenres) ? item.suitableGenres as string[] : [],
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
                genreMatch: Array.isArray(item.genreMatch) ? item.genreMatch as IdeationIdea['genreMatch'] : [],
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
        showSuccessNotice(t('ideation.notice.favAdded'), { timeout: 2000 });
    }

    private removeFavorite(ideaId: string): void {
        this.savedIdeas = this.savedIdeas.filter(s => s.id !== ideaId);
        this.persistSavedIdeas();
        showSuccessNotice(t('ideation.notice.favRemoved'), { timeout: 2000 });
    }

    private loadSavedIdeas(): void {
        try {
            const data = vaultLoad(STORAGE_KEYS.ideationFavorites, this.app);
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
            vaultSave(STORAGE_KEYS.ideationFavorites, JSON.stringify(this.savedIdeas), this.app);
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
        modal.titleEl.setText(t('ideation.export.title'));
        const content = modal.contentEl.createDiv({ cls: 'nw-form-stack' });
        content.createEl('p', {
            text: t('ideation.export.intro', { project: activeProject }),
            cls: 'setting-item-description',
        });
        const saveCurrent = content.createEl('button', {
            text: t('ideation.export.saveCurrent', { project: activeProject }),
            cls: 'nw-btn nw-btn-primary',
        });
        saveCurrent.onclick = async () => {
            modal.close();
            await this.saveIdeaToProject(activeProject, idea);
        };
        const createNew = content.createEl('button', {
            text: t('ideation.export.createNew'),
            cls: 'nw-btn nw-btn-secondary',
        });
        createNew.onclick = () => {
            modal.close();
            this.openCreateProject(idea);
        };
        const cancel = content.createEl('button', { text: t('common.cancel'), cls: 'nw-btn' });
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
            showSuccessNotice(t('ideation.notice.savedTo', { path: `${project}/04-项目总控/脑洞构思.md` }), { timeout: 5000 });
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                const leaf = this.app.workspace.getLeaf('tab');
                await leaf.openFile(file);
            }
            this.dirtyGuard.markClean();
            this.close();
        } catch (e) {
            log.error('[IdeationModal] 保存脑洞失败:', e);
            showErrorNotice(t('ideation.notice.saveFailed'), { timeout: 5000 });
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


    /**
     * onClose 方法。
     */
    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
