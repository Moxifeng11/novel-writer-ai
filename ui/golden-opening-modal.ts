import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from '../engine/ai-engine';
import { createLogger } from '../shared/logger';
import { CreateProjectModal } from './create-project-modal';
import { pjControlDir } from '../shared/paths';


const log = createLogger('GoldenOpeningModal');
interface ChapterOutline {
    chapterNum: number;
    title: string;
    structure: string[];
    outline: string;
}

interface HookResult {
    hooks: Array<{ type: string; content: string; strength: number }>;
    analysis: string;
    overallScore: number;
}

interface RhythmAnalysis {
    overallPace: string;
    paceScore: number;
    infoDensity: string;
    densityScore: number;
    paragraphAnalysis: Array<{ para: number; pace: string; suggestion: string }>;
    suggestions: string[];
}

interface CharacterIntro {
    protagonistIntro: string;
    sideCharacters: Array<{ name: string; timing: string; role: string; relation: string }>;
    relationshipSetup: string;
}

interface WorldbuildingAnalysis {
    hasInfoDump: boolean;
    dumpSeverity: number;
    dumpLocations: string[];
    fragmentSuggestions: string[];
    balanceAdvice: string;
}

interface OpeningScore {
    hookStrength: number;
    rhythm: number;
    charCharm: number;
    suspense: number;
    overall: number;
    improvements: Array<{ priority: string; content: string }>;
}

const GENRE_OPTIONS = [
    '玄幻', '仙侠', '都市', '科幻', '悬疑', '历史', '言情',
    '奇幻', '武侠', '末世', '灵异', '游戏', '竞技', '同人'
];

export class GoldenOpeningModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private activeTab: string = 'three-chapters';

    private threeChapters: ChapterOutline[] = [];
    private isGeneratingChapters: boolean = false;

    private generatedHooks: string[] = [];
    private hookCheckResult: HookResult | null = null;
    private isGeneratingHooks: boolean = false;
    private isCheckingHooks: boolean = false;

    private rhythmResult: RhythmAnalysis | null = null;
    private isAnalyzingRhythm: boolean = false;

    private characterIntroResult: CharacterIntro | null = null;
    private isGeneratingCharIntro: boolean = false;

    private worldbuildingResult: WorldbuildingAnalysis | null = null;
    private isAnalyzingWorldbuilding: boolean = false;

    private openingScoreResult: OpeningScore | null = null;
    private isScoring: boolean = false;

    private selectedGenres: Set<string> = new Set();
    private premiseInput: string = '';
    private protagonistInput: string = '';
    private textInput: string = '';

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
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

        const header = contentEl.createDiv({ cls: 'nw-go-header' });
        header.createEl('h2', { text: '🌟 黄金开篇工坊' });

        const tabs = header.createDiv({ cls: 'nw-go-tabs' });
        const tabDefs = [
            { id: 'three-chapters', label: '黄金三章', icon: '📖' },
            { id: 'hooks', label: '开篇钩子', icon: '🪝' },
            { id: 'rhythm', label: '节奏分析', icon: '⚡' },
            { id: 'characters', label: '人物登场', icon: '👤' },
            { id: 'worldbuilding', label: '世界观融入', icon: '🌍' },
            { id: 'scoring', label: '吸引力评分', icon: '⭐' },
        ];

        tabDefs.forEach(tab => {
            const btn = tabs.createEl('button', {
                text: `${tab.icon} ${tab.label}`,
                cls: `nw-go-tab ${this.activeTab === tab.id ? 'active' : ''}`
            });
            btn.onclick = () => {
                this.activeTab = tab.id;
                this.render();
            };
        });

        const content = contentEl.createDiv({ cls: 'nw-go-content' });

        switch (this.activeTab) {
            case 'three-chapters':
                this.renderThreeChaptersTab(content);
                break;
            case 'hooks':
                this.renderHooksTab(content);
                break;
            case 'rhythm':
                this.renderRhythmTab(content);
                break;
            case 'characters':
                this.renderCharactersTab(content);
                break;
            case 'worldbuilding':
                this.renderWorldbuildingTab(content);
                break;
            case 'scoring':
                this.renderScoringTab(content);
                break;
        }
    }

    private renderThreeChaptersTab(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-go-section' });

        section.createEl('h3', { text: '📌 故事基本设定', cls: 'nw-go-section-title' });

        section.createEl('label', { text: '核心题材标签（可多选）', cls: 'nw-go-label' });
        const tagContainer = section.createDiv({ cls: 'nw-go-tags' });
        GENRE_OPTIONS.forEach(genre => {
            const tag = tagContainer.createEl('button', {
                text: genre,
                cls: `nw-go-tag ${this.selectedGenres.has(genre) ? 'active' : ''}`
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

        section.createEl('label', { text: '故事核心设定/梗概', cls: 'nw-go-label' });
        const premiseInput = section.createEl('textarea', {
            cls: 'nw-textarea nw-go-textarea',
            attr: { rows: '3', placeholder: '简要描述故事的核心设定、世界观背景、主角身份等...' }
        });
        premiseInput.value = this.premiseInput;
        premiseInput.oninput = () => { this.premiseInput = premiseInput.value; };

        section.createEl('label', { text: '主角设定', cls: 'nw-go-label' });
        const protagInput = section.createEl('textarea', {
            cls: 'nw-textarea nw-go-textarea',
            attr: { rows: '2', placeholder: '主角姓名、性格、身份背景、金手指/能力...' }
        });
        protagInput.value = this.protagonistInput;
        protagInput.oninput = () => { this.protagonistInput = protagInput.value; };

        const btnRow = container.createDiv({ cls: 'nw-go-btn-row' });
        const generateBtn = btnRow.createEl('button', {
            text: this.isGeneratingChapters ? '⏳ 生成中...' : '🚀 生成黄金三章大纲',
            cls: 'nw-btn nw-btn-primary'
        });
        generateBtn.disabled = this.isGeneratingChapters;
        generateBtn.onclick = async () => {
            if (!this.premiseInput.trim() && this.selectedGenres.size === 0) {
                new Notice('请输入故事设定或选择至少一个题材标签', 3000);
                return;
            }
            await this.generateThreeChapters();
        };

        if (this.threeChapters.length > 0) {
            const resultSection = container.createDiv({ cls: 'nw-go-section' });
            resultSection.createEl('h3', { text: '📖 黄金三章大纲', cls: 'nw-go-section-title' });

            this.threeChapters.forEach((chapter, idx) => {
                const chapterCard = resultSection.createDiv({ cls: 'nw-go-chapter-card' });
                const chHeader = chapterCard.createDiv({ cls: 'nw-go-chapter-header' });
                chHeader.createEl('span', { text: `第${chapter.chapterNum}章：${chapter.title}`, cls: 'nw-go-chapter-title' });

                const structureList = chapterCard.createDiv({ cls: 'nw-go-structure-list' });
                chapter.structure.forEach((item, i) => {
                    const itemEl = structureList.createDiv({ cls: 'nw-go-structure-item' });
                    itemEl.createSpan({ text: `${i + 1}. ${item}`, cls: 'nw-go-structure-text' });
                });

                chapterCard.createEl('h4', { text: '本章大纲', cls: 'nw-go-subtitle' });
                chapterCard.createEl('p', { text: chapter.outline, cls: 'nw-go-chapter-outline' });
            });

            const exportBtn = resultSection.createEl('button', {
                text: '📝 导出到项目',
                cls: 'nw-btn nw-btn-primary nw-go-export-btn'
            });
            exportBtn.onclick = () => this.exportThreeChapters();
        }
    }

    private renderHooksTab(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-go-section' });
        section.createEl('h3', { text: '🪝 开篇钩子生成器', cls: 'nw-go-section-title' });
        section.createEl('p', { text: '根据故事设定自动生成多种类型的开篇钩子', cls: 'nw-go-desc' });

        const premiseInput = section.createEl('textarea', {
            cls: 'nw-textarea nw-go-textarea',
            attr: { rows: '3', placeholder: '输入故事核心设定、主角身份、世界观背景...' }
        });
        premiseInput.value = this.premiseInput;
        premiseInput.oninput = () => { this.premiseInput = premiseInput.value; };

        const btnRow = section.createDiv({ cls: 'nw-go-btn-row' });
        const genHookBtn = btnRow.createEl('button', {
            text: this.isGeneratingHooks ? '⏳ 生成中...' : '✨ 生成开篇钩子',
            cls: 'nw-btn nw-btn-primary'
        });
        genHookBtn.disabled = this.isGeneratingHooks;
        genHookBtn.onclick = async () => {
            if (!this.premiseInput.trim()) {
                new Notice('请输入故事设定', 3000);
                return;
            }
            await this.generateHooks();
        };

        if (this.generatedHooks.length > 0) {
            const hooksSection = container.createDiv({ cls: 'nw-go-section' });
            hooksSection.createEl('h3', { text: '💡 生成的钩子方案', cls: 'nw-go-section-title' });

            const hookTypes = ['悬念式', '疑问式', '反转式', '震撼场景式', '对话式', '动作式'];
            this.generatedHooks.forEach((hook, idx) => {
                const hookCard = hooksSection.createDiv({ cls: 'nw-go-hook-card' });
                const hookHeader = hookCard.createDiv({ cls: 'nw-go-hook-header' });
                hookHeader.createSpan({ text: hookTypes[idx] || `类型${idx + 1}`, cls: 'nw-go-hook-type' });

                const copyBtn = hookHeader.createEl('button', {
                    text: '复制',
                    cls: 'nw-btn nw-btn-secondary nw-go-copy-btn'
                });
                copyBtn.onclick = () => {
                    navigator.clipboard.writeText(hook);
                    new Notice('✅ 已复制到剪贴板', 2000);
                };

                hookCard.createEl('p', { text: hook, cls: 'nw-go-hook-content' });
            });
        }

        const checkSection = container.createDiv({ cls: 'nw-go-section' });
        checkSection.createEl('h3', { text: '🔍 钩子检测', cls: 'nw-go-section-title' });
        checkSection.createEl('p', { text: '粘贴开篇正文（前300字左右），检测是否有有效钩子', cls: 'nw-go-desc' });

        const textInput = checkSection.createEl('textarea', {
            cls: 'nw-textarea nw-go-textarea',
            attr: { rows: '6', placeholder: '粘贴你的开篇正文...' }
        });
        textInput.value = this.textInput;
        textInput.oninput = () => { this.textInput = textInput.value; };

        const checkBtnRow = checkSection.createDiv({ cls: 'nw-go-btn-row' });
        const checkBtn = checkBtnRow.createEl('button', {
            text: this.isCheckingHooks ? '⏳ 检测中...' : '🔍 检测钩子强度',
            cls: 'nw-btn nw-btn-primary'
        });
        checkBtn.disabled = this.isCheckingHooks;
        checkBtn.onclick = async () => {
            if (!this.textInput.trim()) {
                new Notice('请粘贴开篇正文', 3000);
                return;
            }
            await this.checkHooks();
        };

        if (this.hookCheckResult) {
            const resultSection = container.createDiv({ cls: 'nw-go-section' });
            resultSection.createEl('h3', { text: '📊 检测结果', cls: 'nw-go-section-title' });

            const scoreCard = resultSection.createDiv({ cls: 'nw-go-score-card' });
            scoreCard.createEl('div', { text: `${this.hookCheckResult.overallScore}`, cls: 'nw-go-score-number' });
            scoreCard.createEl('div', { text: '钩子强度评分', cls: 'nw-go-score-label' });
            scoreCard.createEl('div', {
                text: this.hookCheckResult.overallScore >= 8 ? '优秀' :
                      this.hookCheckResult.overallScore >= 6 ? '良好' :
                      this.hookCheckResult.overallScore >= 4 ? '一般' : '需加强',
                cls: 'nw-go-score-grade'
            });

            resultSection.createEl('h4', { text: '检测到的钩子', cls: 'nw-go-subtitle' });
            this.hookCheckResult.hooks.forEach(hook => {
                const hookItem = resultSection.createDiv({ cls: 'nw-go-hook-detect-item' });
                const hookItemHeader = hookItem.createDiv({ cls: 'nw-go-hook-detect-header' });
                hookItemHeader.createSpan({ text: hook.type, cls: 'nw-go-hook-detect-type' });
                const strengthBar = hookItemHeader.createDiv({ cls: 'nw-go-strength-bar' });
                const strengthFill = strengthBar.createDiv({ cls: 'nw-go-strength-fill' });
                strengthFill.style.width = `${hook.strength * 10}%`;
                hookItemHeader.createSpan({ text: `${hook.strength}分`, cls: 'nw-go-strength-value' });
                hookItem.createEl('p', { text: hook.content, cls: 'nw-go-hook-detect-content' });
            });

            resultSection.createEl('h4', { text: '📝 分析与建议', cls: 'nw-go-subtitle' });
            resultSection.createEl('p', { text: this.hookCheckResult.analysis, cls: 'nw-go-analysis-text' });
        }
    }

    private renderRhythmTab(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-go-section' });
        section.createEl('h3', { text: '⚡ 开篇节奏分析', cls: 'nw-go-section-title' });
        section.createEl('p', { text: '分析开篇的节奏快慢、信息密度，提供段落级调整建议', cls: 'nw-go-desc' });

        const textInput = section.createEl('textarea', {
            cls: 'nw-textarea nw-go-textarea',
            attr: { rows: '8', placeholder: '粘贴开篇正文（建议1000-3000字）...' }
        });
        textInput.value = this.textInput;
        textInput.oninput = () => { this.textInput = textInput.value; };

        const btnRow = section.createDiv({ cls: 'nw-go-btn-row' });
        const analyzeBtn = btnRow.createEl('button', {
            text: this.isAnalyzingRhythm ? '⏳ 分析中...' : '🔍 分析开篇节奏',
            cls: 'nw-btn nw-btn-primary'
        });
        analyzeBtn.disabled = this.isAnalyzingRhythm;
        analyzeBtn.onclick = async () => {
            if (!this.textInput.trim()) {
                new Notice('请粘贴开篇正文', 3000);
                return;
            }
            await this.analyzeRhythm();
        };

        if (this.rhythmResult) {
            const resultSection = container.createDiv({ cls: 'nw-go-section' });
            resultSection.createEl('h3', { text: '📊 分析结果', cls: 'nw-go-section-title' });

            const overviewGrid = resultSection.createDiv({ cls: 'nw-go-rhythm-grid' });
            const paceCard = overviewGrid.createDiv({ cls: 'nw-go-rhythm-card' });
            paceCard.createEl('div', { text: '整体节奏', cls: 'nw-go-rhythm-label' });
            paceCard.createEl('div', { text: this.rhythmResult.overallPace, cls: 'nw-go-rhythm-value' });
            const paceBar = paceCard.createDiv({ cls: 'nw-go-rhythm-bar' });
            const paceFill = paceBar.createDiv({ cls: 'nw-go-rhythm-fill' });
            paceFill.style.width = `${this.rhythmResult.paceScore * 10}%`;
            paceCard.createEl('div', { text: `${this.rhythmResult.paceScore}/10`, cls: 'nw-go-rhythm-score' });

            const densityCard = overviewGrid.createDiv({ cls: 'nw-go-rhythm-card' });
            densityCard.createEl('div', { text: '信息密度', cls: 'nw-go-rhythm-label' });
            densityCard.createEl('div', { text: this.rhythmResult.infoDensity, cls: 'nw-go-rhythm-value' });
            const densityBar = densityCard.createDiv({ cls: 'nw-go-rhythm-bar' });
            const densityFill = densityBar.createDiv({ cls: 'nw-go-rhythm-fill' });
            densityFill.style.width = `${this.rhythmResult.densityScore * 10}%`;
            densityCard.createEl('div', { text: `${this.rhythmResult.densityScore}/10`, cls: 'nw-go-rhythm-score' });

            resultSection.createEl('h4', { text: '📝 段落级分析', cls: 'nw-go-subtitle' });
            this.rhythmResult.paragraphAnalysis.forEach(item => {
                const paraItem = resultSection.createDiv({ cls: 'nw-go-para-item' });
                const paraHeader = paraItem.createDiv({ cls: 'nw-go-para-header' });
                paraHeader.createSpan({ text: `第${item.para}段`, cls: 'nw-go-para-num' });
                paraHeader.createSpan({ text: item.pace, cls: 'nw-go-para-pace' });
                paraItem.createEl('p', { text: item.suggestion, cls: 'nw-go-para-suggestion' });
            });

            resultSection.createEl('h4', { text: '💡 调整建议', cls: 'nw-go-subtitle' });
            const suggestionsList = resultSection.createDiv({ cls: 'nw-go-suggestions-list' });
            this.rhythmResult.suggestions.forEach((sugg, idx) => {
                const suggItem = suggestionsList.createDiv({ cls: 'nw-go-suggestion-item' });
                suggItem.createSpan({ text: `${idx + 1}. `, cls: 'nw-go-suggestion-num' });
                suggItem.createSpan({ text: sugg, cls: 'nw-go-suggestion-text' });
            });
        }
    }

    private renderCharactersTab(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-go-section' });
        section.createEl('h3', { text: '👤 人物快速登场机制', cls: 'nw-go-section-title' });
        section.createEl('p', { text: '设计主角快速登场方式、配角登场时机、人物关系快速建立', cls: 'nw-go-desc' });

        const premiseInput = section.createEl('textarea', {
            cls: 'nw-textarea nw-go-textarea',
            attr: { rows: '3', placeholder: '故事核心设定、世界观背景...' }
        });
        premiseInput.value = this.premiseInput;
        premiseInput.oninput = () => { this.premiseInput = premiseInput.value; };

        const protagInput = section.createEl('textarea', {
            cls: 'nw-textarea nw-go-textarea',
            attr: { rows: '2', placeholder: '主角设定（姓名、性格、身份、能力...）' }
        });
        protagInput.value = this.protagonistInput;
        protagInput.oninput = () => { this.protagonistInput = protagInput.value; };

        const btnRow = section.createDiv({ cls: 'nw-go-btn-row' });
        const generateBtn = btnRow.createEl('button', {
            text: this.isGeneratingCharIntro ? '⏳ 生成中...' : '✨ 生成人物登场方案',
            cls: 'nw-btn nw-btn-primary'
        });
        generateBtn.disabled = this.isGeneratingCharIntro;
        generateBtn.onclick = async () => {
            if (!this.premiseInput.trim() || !this.protagonistInput.trim()) {
                new Notice('请输入故事设定和主角设定', 3000);
                return;
            }
            await this.generateCharacterIntro();
        };

        if (this.characterIntroResult) {
            const resultSection = container.createDiv({ cls: 'nw-go-section' });
            resultSection.createEl('h3', { text: '🎭 人物登场方案', cls: 'nw-go-section-title' });

            resultSection.createEl('h4', { text: '主角登场模板', cls: 'nw-go-subtitle' });
            resultSection.createEl('p', { text: this.characterIntroResult.protagonistIntro, cls: 'nw-go-analysis-text' });

            resultSection.createEl('h4', { text: '配角登场安排', cls: 'nw-go-subtitle' });
            this.characterIntroResult.sideCharacters.forEach(char => {
                const charCard = resultSection.createDiv({ cls: 'nw-go-char-card' });
                const charHeader = charCard.createDiv({ cls: 'nw-go-char-header' });
                charHeader.createSpan({ text: char.name, cls: 'nw-go-char-name' });
                charHeader.createSpan({ text: char.timing, cls: 'nw-go-char-timing' });
                charCard.createEl('p', { text: `角色：${char.role}`, cls: 'nw-go-char-role' });
                charCard.createEl('p', { text: `与主角关系：${char.relation}`, cls: 'nw-go-char-relation' });
            });

            resultSection.createEl('h4', { text: '人物关系快速建立', cls: 'nw-go-subtitle' });
            resultSection.createEl('p', { text: this.characterIntroResult.relationshipSetup, cls: 'nw-go-analysis-text' });
        }
    }

    private renderWorldbuildingTab(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-go-section' });
        section.createEl('h3', { text: '🌍 世界观自然融入设计', cls: 'nw-go-section-title' });
        section.createEl('p', { text: '检测信息倾倒（信息过载）、提供碎片化融入建议', cls: 'nw-go-desc' });

        const textInput = section.createEl('textarea', {
            cls: 'nw-textarea nw-go-textarea',
            attr: { rows: '8', placeholder: '粘贴开篇正文（建议1000-3000字）...' }
        });
        textInput.value = this.textInput;
        textInput.oninput = () => { this.textInput = textInput.value; };

        const btnRow = section.createDiv({ cls: 'nw-go-btn-row' });
        const analyzeBtn = btnRow.createEl('button', {
            text: this.isAnalyzingWorldbuilding ? '⏳ 分析中...' : '🔍 检测世界观融入',
            cls: 'nw-btn nw-btn-primary'
        });
        analyzeBtn.disabled = this.isAnalyzingWorldbuilding;
        analyzeBtn.onclick = async () => {
            if (!this.textInput.trim()) {
                new Notice('请粘贴开篇正文', 3000);
                return;
            }
            await this.analyzeWorldbuilding();
        };

        if (this.worldbuildingResult) {
            const resultSection = container.createDiv({ cls: 'nw-go-section' });
            resultSection.createEl('h3', { text: '📊 分析结果', cls: 'nw-go-section-title' });

            const dumpCard = resultSection.createDiv({ cls: 'nw-go-dump-card' });
            const dumpStatus = dumpCard.createDiv({ cls: 'nw-go-dump-status' });
            dumpStatus.createSpan({
                text: this.worldbuildingResult.hasInfoDump ? '⚠️ 检测到信息倾倒' : '✅ 信息融入良好',
                cls: `nw-go-dump-status-text ${this.worldbuildingResult.hasInfoDump ? 'warning' : 'ok'}`
            });
            const severityBar = dumpCard.createDiv({ cls: 'nw-go-severity-bar' });
            const severityFill = severityBar.createDiv({ cls: 'nw-go-severity-fill' });
            severityFill.style.width = `${this.worldbuildingResult.dumpSeverity * 10}%`;
            severityFill.style.background = this.worldbuildingResult.dumpSeverity >= 7 ? '#ff6b6b' :
                                             this.worldbuildingResult.dumpSeverity >= 4 ? '#f9ca24' : '#4ecdc4';
            dumpCard.createEl('div', { text: `严重程度：${this.worldbuildingResult.dumpSeverity}/10`, cls: 'nw-go-severity-text' });

            if (this.worldbuildingResult.dumpLocations.length > 0) {
                resultSection.createEl('h4', { text: '📍 问题位置', cls: 'nw-go-subtitle' });
                this.worldbuildingResult.dumpLocations.forEach((loc, idx) => {
                    const locItem = resultSection.createDiv({ cls: 'nw-go-dump-loc' });
                    locItem.createSpan({ text: `${idx + 1}. `, cls: 'nw-go-dump-loc-num' });
                    locItem.createSpan({ text: loc, cls: 'nw-go-dump-loc-text' });
                });
            }

            resultSection.createEl('h4', { text: '💡 碎片化融入建议', cls: 'nw-go-subtitle' });
            this.worldbuildingResult.fragmentSuggestions.forEach((sugg, idx) => {
                const suggItem = resultSection.createDiv({ cls: 'nw-go-suggestion-item' });
                suggItem.createSpan({ text: `${idx + 1}. `, cls: 'nw-go-suggestion-num' });
                suggItem.createSpan({ text: sugg, cls: 'nw-go-suggestion-text' });
            });

            resultSection.createEl('h4', { text: '⚖️ 信息披露与悬念平衡', cls: 'nw-go-subtitle' });
            resultSection.createEl('p', { text: this.worldbuildingResult.balanceAdvice, cls: 'nw-go-analysis-text' });
        }
    }

    private renderScoringTab(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-go-section' });
        section.createEl('h3', { text: '⭐ 开篇吸引力综合评分', cls: 'nw-go-section-title' });
        section.createEl('p', { text: '多维度评估开篇吸引力，提供优先级排序的改进建议', cls: 'nw-go-desc' });

        const textInput = section.createEl('textarea', {
            cls: 'nw-textarea nw-go-textarea',
            attr: { rows: '8', placeholder: '粘贴开篇正文（建议前三章或前3000字）...' }
        });
        textInput.value = this.textInput;
        textInput.oninput = () => { this.textInput = textInput.value; };

        const btnRow = section.createDiv({ cls: 'nw-go-btn-row' });
        const scoreBtn = btnRow.createEl('button', {
            text: this.isScoring ? '⏳ 评分中...' : '🌟 综合评分',
            cls: 'nw-btn nw-btn-primary'
        });
        scoreBtn.disabled = this.isScoring;
        scoreBtn.onclick = async () => {
            if (!this.textInput.trim()) {
                new Notice('请粘贴开篇正文', 3000);
                return;
            }
            await this.scoreOpening();
        };

        if (this.openingScoreResult) {
            const resultSection = container.createDiv({ cls: 'nw-go-section' });
            resultSection.createEl('h3', { text: '🏆 综合评分结果', cls: 'nw-go-section-title' });

            const overallCard = resultSection.createDiv({ cls: 'nw-go-overall-score' });
            overallCard.createEl('div', { text: `${this.openingScoreResult.overall}`, cls: 'nw-go-overall-number' });
            overallCard.createEl('div', { text: '综合吸引力指数', cls: 'nw-go-overall-label' });
            overallCard.createEl('div', {
                text: this.openingScoreResult.overall >= 9 ? '惊艳开篇' :
                      this.openingScoreResult.overall >= 7 ? '优秀开篇' :
                      this.openingScoreResult.overall >= 5 ? '合格开篇' : '需要打磨',
                cls: 'nw-go-overall-grade'
            });

            const dimensions = [
                { label: '钩子强度', value: this.openingScoreResult.hookStrength, color: '#ff6b6b', icon: '🪝' },
                { label: '节奏把控', value: this.openingScoreResult.rhythm, color: '#4ecdc4', icon: '⚡' },
                { label: '人物魅力', value: this.openingScoreResult.charCharm, color: '#45b7d1', icon: '👤' },
                { label: '悬念设置', value: this.openingScoreResult.suspense, color: '#f9ca24', icon: '❓' },
            ];

            const scoreList = resultSection.createDiv({ cls: 'nw-go-score-list' });
            dimensions.forEach(dim => {
                const item = scoreList.createDiv({ cls: 'nw-go-score-item' });
                const itemHeader = item.createDiv({ cls: 'nw-go-score-item-header' });
                itemHeader.createSpan({ text: `${dim.icon} ${dim.label}`, cls: 'nw-go-score-item-label' });
                itemHeader.createSpan({ text: `${dim.value}/10`, cls: 'nw-go-score-item-value' });
                const barWrap = item.createDiv({ cls: 'nw-go-score-bar-wrap' });
                const bar = barWrap.createDiv({ cls: 'nw-go-score-bar-fill' });
                bar.style.width = `${dim.value * 10}%`;
                bar.style.background = dim.color;
            });

            resultSection.createEl('h4', { text: '📋 改进建议（按优先级排序）', cls: 'nw-go-subtitle' });
            this.openingScoreResult.improvements.forEach(imp => {
                const impItem = resultSection.createDiv({ cls: `nw-go-improvement-item priority-${imp.priority}` });
                const impHeader = impItem.createDiv({ cls: 'nw-go-improvement-header' });
                const priorityBadge = impHeader.createSpan({
                    text: imp.priority === 'high' ? '🔴 高优先级' : imp.priority === 'medium' ? '🟡 中优先级' : '🟢 低优先级',
                    cls: 'nw-go-priority-badge'
                });
                impItem.createEl('p', { text: imp.content, cls: 'nw-go-improvement-content' });
            });
        }
    }

    private async generateThreeChapters(): Promise<void> {
        if (this.isGeneratingChapters) return;
        this.isGeneratingChapters = true;
        this.render();

        const notice = new Notice('⏳ 正在生成黄金三章大纲...', 0);

        try {
            const systemPrompt = `你是专业的网文开篇设计师，精通黄金三章设计法则。
请根据用户提供的故事设定，生成黄金三章的详细大纲。

严格按照以下JSON格式输出：
{
  "chapters": [
    {
      "chapterNum": 1,
      "title": "章节标题",
      "structure": ["结构要点1", "结构要点2", "结构要点3"],
      "outline": "本章详细大纲（300-500字）"
    },
    {
      "chapterNum": 2,
      "title": "章节标题",
      "structure": ["结构要点1", "结构要点2", "结构要点3"],
      "outline": "本章详细大纲（300-500字）"
    },
    {
      "chapterNum": 3,
      "title": "章节标题",
      "structure": ["结构要点1", "结构要点2", "结构要点3"],
      "outline": "本章详细大纲（300-500字）"
    }
  ]
}

设计要求：
第一章：悬念引入 + 主角登场 + 世界观碎片
- 开头100字内必须有钩子
- 主角要在第一章前半段登场
- 通过场景和对话自然透露世界观碎片，禁止信息倾倒
- 章末设置第一个小悬念

第二章：冲突升级 + 金手指/能力展现
- 冲突要比第一章升级
- 主角的金手指或特殊能力要在本章展现
- 通过行动而非解说展现能力
- 章末设置更大的悬念或危机

第三章：第一个小高潮 + 更大悬念钩子
- 本章要有一个小高潮事件
- 主角初步展现成长或能力运用
- 引入更大的世界观谜团或危机
- 章末必须有强力钩子，让读者想继续读下去

只输出JSON，不要任何解释文字。`;

            const userPrompt = `题材标签：${Array.from(this.selectedGenres).join('、') || '不限'}
故事设定：${this.premiseInput}
主角设定：${this.protagonistInput}

请生成黄金三章大纲。`;

            const result = await this.aiEngine.callAI(systemPrompt, userPrompt, undefined, 0.8, 8192);
            notice.hide();

            if (result.error) {
                new Notice(`❌ 生成失败: ${result.error}`, 5000);
                this.isGeneratingChapters = false;
                this.render();
                return;
            }

            const parsed = this.parseThreeChaptersResponse(result.content);
            if (parsed.length === 0) {
                new Notice('❌ 解析失败，请重试', 5000);
                this.isGeneratingChapters = false;
                this.render();
                return;
            }

            this.threeChapters = parsed;
            new Notice('✅ 黄金三章大纲已生成', 3000);
        } catch (e) {
            notice.hide();
            log.error('[GoldenOpeningModal] 生成三章失败:', e);
            new Notice('❌ 生成出错，请稍后重试', 5000);
        }

        this.isGeneratingChapters = false;
        this.render();
    }

    private parseThreeChaptersResponse(content: string): ChapterOutline[] {
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return [];

            const obj = JSON.parse(jsonMatch[0]);
            if (!obj.chapters || !Array.isArray(obj.chapters)) return [];

            return obj.chapters.map((c: any) => ({
                chapterNum: c.chapterNum || 1,
                title: c.title || '未命名章节',
                structure: Array.isArray(c.structure) ? c.structure : [],
                outline: c.outline || ''
            }));
        } catch (e) {
            log.warn('[GoldenOpeningModal] 解析三章响应失败:', e);
            return [];
        }
    }

    private async generateHooks(): Promise<void> {
        if (this.isGeneratingHooks) return;
        this.isGeneratingHooks = true;
        this.render();

        const notice = new Notice('⏳ 正在生成开篇钩子...', 0);

        try {
            const systemPrompt = `你是专业的网文开篇钩子设计师。
请根据用户提供的故事设定，生成6种不同类型的开篇钩子。

严格按照以下JSON格式输出：
{
  "hooks": [
    "钩子内容1（悬念式）",
    "钩子内容2（疑问式）",
    "钩子内容3（反转式）",
    "钩子内容4（震撼场景式）",
    "钩子内容5（对话式）",
    "钩子内容6（动作式）"
  ]
}

要求：
1. 每个钩子控制在50-100字左右
2. 悬念式：抛出一个令人好奇的未解之谜
3. 疑问式：用一个直击人心的问题开头
4. 反转式：给出一个颠覆常识的场景
5. 震撼场景式：描绘一个极具视觉冲击力的画面
6. 对话式：用一段引人深思的对话开头
7. 动作式：从一个紧张激烈的动作场景开始
8. 所有钩子都要与故事设定相关联

只输出JSON，不要任何解释文字。`;

            const userPrompt = `故事设定：${this.premiseInput}
主角设定：${this.protagonistInput}

请生成6种不同类型的开篇钩子。`;

            const result = await this.aiEngine.callAI(systemPrompt, userPrompt, undefined, 0.9, this.plugin.settings.maxOutput);
            notice.hide();

            if (result.error) {
                new Notice(`❌ 生成失败: ${result.error}`, 5000);
                this.isGeneratingHooks = false;
                this.render();
                return;
            }

            const parsed = this.parseHooksResponse(result.content);
            if (parsed.length === 0) {
                new Notice('❌ 解析失败，请重试', 5000);
                this.isGeneratingHooks = false;
                this.render();
                return;
            }

            this.generatedHooks = parsed;
            new Notice('✅ 开篇钩子已生成', 3000);
        } catch (e) {
            notice.hide();
            log.error('[GoldenOpeningModal] 生成钩子失败:', e);
            new Notice('❌ 生成出错，请稍后重试', 5000);
        }

        this.isGeneratingHooks = false;
        this.render();
    }

    private parseHooksResponse(content: string): string[] {
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return [];

            const obj = JSON.parse(jsonMatch[0]);
            if (!obj.hooks || !Array.isArray(obj.hooks)) return [];

            return obj.hooks.filter((h: any) => typeof h === 'string');
        } catch (e) {
            log.warn('[GoldenOpeningModal] 解析钩子响应失败:', e);
            return [];
        }
    }

    private async checkHooks(): Promise<void> {
        if (this.isCheckingHooks) return;
        this.isCheckingHooks = true;
        this.render();

        const notice = new Notice('⏳ 正在检测钩子强度...', 0);

        try {
            const systemPrompt = `你是专业的网文编辑，擅长评估开篇钩子的质量。
请分析用户提供的开篇正文，检测其中的钩子并评分。

严格按照以下JSON格式输出：
{
  "hooks": [
    {
      "type": "钩子类型（悬念/疑问/反转/震撼场景/对话/动作）",
      "content": "钩子的具体内容或描述",
      "strength": 7
    }
  ],
  "analysis": "整体分析与建议（200-300字）",
  "overallScore": 7
}

评分标准：
- 1-3分：几乎没有钩子，开篇平淡
- 4-5分：有钩子但不够强，吸引力一般
- 6-7分：钩子明确，有一定吸引力
- 8-9分：钩子很强，能有效抓住读者
- 10分：顶级钩子，让人欲罢不能

要求：
1. 找出所有存在的钩子，标注类型
2. 每个钩子单独评分（1-10分）
3. 给出总体评分和详细分析
4. 分析要具体指出优点和改进方向

只输出JSON，不要任何解释文字。`;

            const userPrompt = `开篇正文：
${this.textInput.slice(0, 1000)}

请检测开篇中的钩子并评分。`;

            const result = await this.aiEngine.callAI(systemPrompt, userPrompt, undefined, 0.7, this.plugin.settings.maxOutput);
            notice.hide();

            if (result.error) {
                new Notice(`❌ 检测失败: ${result.error}`, 5000);
                this.isCheckingHooks = false;
                this.render();
                return;
            }

            const parsed = this.parseHookCheckResponse(result.content);
            if (!parsed) {
                new Notice('❌ 解析失败，请重试', 5000);
                this.isCheckingHooks = false;
                this.render();
                return;
            }

            this.hookCheckResult = parsed;
            new Notice(`✅ 检测完成，综合评分: ${parsed.overallScore}分`, 3000);
        } catch (e) {
            notice.hide();
            log.error('[GoldenOpeningModal] 检测钩子失败:', e);
            new Notice('❌ 检测出错，请稍后重试', 5000);
        }

        this.isCheckingHooks = false;
        this.render();
    }

    private parseHookCheckResponse(content: string): HookResult | null {
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;

            const obj = JSON.parse(jsonMatch[0]);
            return {
                hooks: Array.isArray(obj.hooks) ? obj.hooks.map((h: any) => ({
                    type: h.type || '未知',
                    content: h.content || '',
                    strength: Math.max(1, Math.min(10, h.strength || 5))
                })) : [],
                analysis: obj.analysis || '',
                overallScore: Math.max(1, Math.min(10, obj.overallScore || 5))
            };
        } catch (e) {
            log.warn('[GoldenOpeningModal] 解析钩子检测响应失败:', e);
            return null;
        }
    }

    private async analyzeRhythm(): Promise<void> {
        if (this.isAnalyzingRhythm) return;
        this.isAnalyzingRhythm = true;
        this.render();

        const notice = new Notice('⏳ 正在分析开篇节奏...', 0);

        try {
            const systemPrompt = `你是专业的网文节奏分析师。
请分析用户提供的开篇正文，评估节奏快慢、信息密度，并提供段落级调整建议。

严格按照以下JSON格式输出：
{
  "overallPace": "偏快/适中/偏慢",
  "paceScore": 7,
  "infoDensity": "过高/适中/偏低",
  "densityScore": 7,
  "paragraphAnalysis": [
    {
      "para": 1,
      "pace": "快节奏/中节奏/慢节奏",
      "suggestion": "该段落的节奏分析与建议"
    }
  ],
  "suggestions": [
    "建议1",
    "建议2",
    "建议3"
  ]
}

分析维度：
1. 整体节奏：开篇前几段的推进速度
2. 信息密度：单位字数内包含的信息量
3. 段落节奏：每段的节奏类型和问题
4. 调整建议：具体可操作的改进建议

只输出JSON，不要任何解释文字。`;

            const userPrompt = `开篇正文：
${this.textInput}

请分析这篇开篇的节奏。`;

            const result = await this.aiEngine.callAI(systemPrompt, userPrompt, undefined, 0.7, 6144);
            notice.hide();

            if (result.error) {
                new Notice(`❌ 分析失败: ${result.error}`, 5000);
                this.isAnalyzingRhythm = false;
                this.render();
                return;
            }

            const parsed = this.parseRhythmResponse(result.content);
            if (!parsed) {
                new Notice('❌ 解析失败，请重试', 5000);
                this.isAnalyzingRhythm = false;
                this.render();
                return;
            }

            this.rhythmResult = parsed;
            new Notice('✅ 节奏分析完成', 3000);
        } catch (e) {
            notice.hide();
            log.error('[GoldenOpeningModal] 节奏分析失败:', e);
            new Notice('❌ 分析出错，请稍后重试', 5000);
        }

        this.isAnalyzingRhythm = false;
        this.render();
    }

    private parseRhythmResponse(content: string): RhythmAnalysis | null {
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;

            const obj = JSON.parse(jsonMatch[0]);
            return {
                overallPace: obj.overallPace || '适中',
                paceScore: Math.max(1, Math.min(10, obj.paceScore || 5)),
                infoDensity: obj.infoDensity || '适中',
                densityScore: Math.max(1, Math.min(10, obj.densityScore || 5)),
                paragraphAnalysis: Array.isArray(obj.paragraphAnalysis) ? obj.paragraphAnalysis.map((p: any) => ({
                    para: p.para || 1,
                    pace: p.pace || '中节奏',
                    suggestion: p.suggestion || ''
                })) : [],
                suggestions: Array.isArray(obj.suggestions) ? obj.suggestions : []
            };
        } catch (e) {
            log.warn('[GoldenOpeningModal] 解析节奏分析响应失败:', e);
            return null;
        }
    }

    private async generateCharacterIntro(): Promise<void> {
        if (this.isGeneratingCharIntro) return;
        this.isGeneratingCharIntro = true;
        this.render();

        const notice = new Notice('⏳ 正在生成人物登场方案...', 0);

        try {
            const systemPrompt = `你是专业的网文人物设计师。
请根据故事设定和主角设定，设计人物快速登场机制。

严格按照以下JSON格式输出：
{
  "protagonistIntro": "主角登场模板详细描述（300-500字），包括登场方式、第一印象塑造、性格展现技巧等",
  "sideCharacters": [
    {
      "name": "角色名",
      "timing": "登场时机（第X章/第X段）",
      "role": "角色定位",
      "relation": "与主角的关系"
    }
  ],
  "relationshipSetup": "人物关系快速建立方案（200-300字）"
}

设计要点：
1. 主角登场要在前3000字内完成
2. 主角登场要有记忆点，不能平淡
3. 通过行动和对话展现性格，避免直接解说
4. 配角登场时机要合理，服务于主线
5. 人物关系要快速建立，让读者快速理解人物格局

只输出JSON，不要任何解释文字。`;

            const userPrompt = `故事设定：${this.premiseInput}
主角设定：${this.protagonistInput}

请设计人物快速登场机制。`;

            const result = await this.aiEngine.callAI(systemPrompt, userPrompt, undefined, 0.8, 6144);
            notice.hide();

            if (result.error) {
                new Notice(`❌ 生成失败: ${result.error}`, 5000);
                this.isGeneratingCharIntro = false;
                this.render();
                return;
            }

            const parsed = this.parseCharacterIntroResponse(result.content);
            if (!parsed) {
                new Notice('❌ 解析失败，请重试', 5000);
                this.isGeneratingCharIntro = false;
                this.render();
                return;
            }

            this.characterIntroResult = parsed;
            new Notice('✅ 人物登场方案已生成', 3000);
        } catch (e) {
            notice.hide();
            log.error('[GoldenOpeningModal] 生成人物登场失败:', e);
            new Notice('❌ 生成出错，请稍后重试', 5000);
        }

        this.isGeneratingCharIntro = false;
        this.render();
    }

    private parseCharacterIntroResponse(content: string): CharacterIntro | null {
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;

            const obj = JSON.parse(jsonMatch[0]);
            return {
                protagonistIntro: obj.protagonistIntro || '',
                sideCharacters: Array.isArray(obj.sideCharacters) ? obj.sideCharacters.map((c: any) => ({
                    name: c.name || '未命名',
                    timing: c.timing || '',
                    role: c.role || '',
                    relation: c.relation || ''
                })) : [],
                relationshipSetup: obj.relationshipSetup || ''
            };
        } catch (e) {
            log.warn('[GoldenOpeningModal] 解析人物登场响应失败:', e);
            return null;
        }
    }

    private async analyzeWorldbuilding(): Promise<void> {
        if (this.isAnalyzingWorldbuilding) return;
        this.isAnalyzingWorldbuilding = true;
        this.render();

        const notice = new Notice('⏳ 正在检测世界观融入...', 0);

        try {
            const systemPrompt = `你是专业的网文世界观融入设计师。
请分析用户提供的开篇正文，检测是否存在信息倾倒（信息过载），并提供碎片化融入建议。

严格按照以下JSON格式输出：
{
  "hasInfoDump": true/false,
  "dumpSeverity": 6,
  "dumpLocations": [
    "问题位置描述1",
    "问题位置描述2"
  ],
  "fragmentSuggestions": [
    "碎片化融入建议1",
    "碎片化融入建议2",
    "碎片化融入建议3"
  ],
  "balanceAdvice": "信息披露与悬念平衡的总体建议（200-300字）"
}

检测标准：
1. 信息倾倒：大段的设定解说、背景介绍
2. 严重程度：1-10分，越高越严重
3. 碎片化：将世界观信息打散，通过场景、对话、行动自然透露
4. 悬念平衡：保留足够的未知感，不要一次性把所有设定都讲清楚

只输出JSON，不要任何解释文字。`;

            const userPrompt = `开篇正文：
${this.textInput}

请检测世界观融入情况。`;

            const result = await this.aiEngine.callAI(systemPrompt, userPrompt, undefined, 0.7, 6144);
            notice.hide();

            if (result.error) {
                new Notice(`❌ 分析失败: ${result.error}`, 5000);
                this.isAnalyzingWorldbuilding = false;
                this.render();
                return;
            }

            const parsed = this.parseWorldbuildingResponse(result.content);
            if (!parsed) {
                new Notice('❌ 解析失败，请重试', 5000);
                this.isAnalyzingWorldbuilding = false;
                this.render();
                return;
            }

            this.worldbuildingResult = parsed;
            new Notice('✅ 世界观融入分析完成', 3000);
        } catch (e) {
            notice.hide();
            log.error('[GoldenOpeningModal] 世界观分析失败:', e);
            new Notice('❌ 分析出错，请稍后重试', 5000);
        }

        this.isAnalyzingWorldbuilding = false;
        this.render();
    }

    private parseWorldbuildingResponse(content: string): WorldbuildingAnalysis | null {
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;

            const obj = JSON.parse(jsonMatch[0]);
            return {
                hasInfoDump: !!obj.hasInfoDump,
                dumpSeverity: Math.max(1, Math.min(10, obj.dumpSeverity || 5)),
                dumpLocations: Array.isArray(obj.dumpLocations) ? obj.dumpLocations : [],
                fragmentSuggestions: Array.isArray(obj.fragmentSuggestions) ? obj.fragmentSuggestions : [],
                balanceAdvice: obj.balanceAdvice || ''
            };
        } catch (e) {
            log.warn('[GoldenOpeningModal] 解析世界观分析响应失败:', e);
            return null;
        }
    }

    private async scoreOpening(): Promise<void> {
        if (this.isScoring) return;
        this.isScoring = true;
        this.render();

        const notice = new Notice('⏳ 正在进行综合评分...', 0);

        try {
            const systemPrompt = `你是专业的网文开篇评估专家。
请从多个维度评估开篇的吸引力，并给出优先级排序的改进建议。

严格按照以下JSON格式输出：
{
  "hookStrength": 7,
  "rhythm": 7,
  "charCharm": 7,
  "suspense": 7,
  "overall": 7,
  "improvements": [
    {
      "priority": "high",
      "content": "高优先级改进建议内容"
    },
    {
      "priority": "medium",
      "content": "中优先级改进建议内容"
    },
    {
      "priority": "low",
      "content": "低优先级改进建议内容"
    }
  ]
}

评分维度：
1. 钩子强度（1-10）：开篇能否抓住读者
2. 节奏把控（1-10）：节奏是否合理，张弛有度
3. 人物魅力（1-10）：主角是否有吸引力，读者是否关心
4. 悬念设置（1-10）：悬念感是否充足，能否驱动阅读
5. 综合评分（1-10）：整体吸引力指数

改进建议要求：
- 按优先级排序（high/medium/low）
- 每条建议要具体可操作
- 高优先级至少3条，中优先级至少3条，低优先级2-3条

只输出JSON，不要任何解释文字。`;

            const userPrompt = `开篇正文：
${this.textInput}

请对这篇开篇进行综合吸引力评分。`;

            const result = await this.aiEngine.callAI(systemPrompt, userPrompt, undefined, 0.7, 6144);
            notice.hide();

            if (result.error) {
                new Notice(`❌ 评分失败: ${result.error}`, 5000);
                this.isScoring = false;
                this.render();
                return;
            }

            const parsed = this.parseScoringResponse(result.content);
            if (!parsed) {
                new Notice('❌ 解析失败，请重试', 5000);
                this.isScoring = false;
                this.render();
                return;
            }

            this.openingScoreResult = parsed;
            new Notice(`✅ 综合评分完成：${parsed.overall}分`, 3000);
        } catch (e) {
            notice.hide();
            log.error('[GoldenOpeningModal] 综合评分失败:', e);
            new Notice('❌ 评分出错，请稍后重试', 5000);
        }

        this.isScoring = false;
        this.render();
    }

    private parseScoringResponse(content: string): OpeningScore | null {
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;

            const obj = JSON.parse(jsonMatch[0]);
            return {
                hookStrength: Math.max(1, Math.min(10, obj.hookStrength || 5)),
                rhythm: Math.max(1, Math.min(10, obj.rhythm || 5)),
                charCharm: Math.max(1, Math.min(10, obj.charCharm || 5)),
                suspense: Math.max(1, Math.min(10, obj.suspense || 5)),
                overall: Math.max(1, Math.min(10, obj.overall || 5)),
                improvements: Array.isArray(obj.improvements) ? obj.improvements.map((i: any) => ({
                    priority: i.priority === 'high' || i.priority === 'medium' || i.priority === 'low' ? i.priority : 'medium',
                    content: i.content || ''
                })) : []
            };
        } catch (e) {
            log.warn('[GoldenOpeningModal] 解析评分响应失败:', e);
            return null;
        }
    }

    private async exportThreeChapters(): Promise<void> {
        const active = this.plugin.getActiveProject();
        if (active) {
            this.showExportChoice(active);
            return;
        }
        this.openCreateProject();
    }

    private showExportChoice(activeProject: string): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('📁 保存黄金开篇');
        const content = modal.contentEl.createDiv({ cls: 'nw-form-stack' });
        content.createEl('p', {
            text: `当前项目：${activeProject}。可以保存到当前项目，或基于这份黄金三章创建新项目。`,
            cls: 'setting-item-description',
        });
        const saveCurrent = content.createEl('button', {
            text: `保存到当前项目「${activeProject}」`,
            cls: 'nw-btn nw-btn-primary',
        });
        saveCurrent.onclick = async () => {
            modal.close();
            await this.saveGoldenToProject(activeProject);
        };
        const createNew = content.createEl('button', {
            text: '创建新项目',
            cls: 'nw-btn nw-btn-secondary',
        });
        createNew.onclick = () => {
            modal.close();
            this.openCreateProject();
        };
        const cancel = content.createEl('button', { text: '取消', cls: 'nw-btn' });
        cancel.onclick = () => modal.close();
        modal.open();
    }

    private openCreateProject(): void {
        const name = this.threeChapters[0]?.title || this.premiseInput || '黄金开篇';
        new CreateProjectModal(this.app, this.plugin, {
            name,
            genre: Array.from(this.selectedGenres)[0] || '',
            description: this.premiseInput,
            projectType: 'original',
                        onCreated: async (projectName) => {
                await this.saveGoldenToProject(projectName);
            },
        }).open();
    }

    private buildGoldenContent(): string {
        let content = `---
tags: [黄金开篇, 大纲]
生成时间: ${new Date().toISOString()}
---

# 黄金三章大纲

`;
        this.threeChapters.forEach(chapter => {
            content += `## 第${chapter.chapterNum}章：${chapter.title}\n\n`;
            content += '### 结构要点\n\n';
            chapter.structure.forEach((item, index) => {
                content += `${index + 1}. ${item}\n`;
            });
            content += `\n### 本章大纲\n\n${chapter.outline}\n\n---\n\n`;
        });
        return content;
    }

    private async saveGoldenToProject(project: string): Promise<void> {
        try {
            const dir = pjControlDir(project);
            await this.ensureFolder(dir);
            const filePath = `${dir}/黄金开篇.md`;
            const content = this.buildGoldenContent();
            const existing = this.app.vault.getAbstractFileByPath(filePath);
            if (existing instanceof TFile) {
                // 旧实现是 `old + '---' + content`：每保存一次就追加一整份文档 + 第二个 frontmatter 块，
                // Obsidian 只认第一块 → 内容看起来「没更新」，文件无限膨胀。这里是插件生成的成稿，直接覆盖。
                await this.app.vault.modify(existing, content);
            } else {
                await this.app.vault.create(filePath, content);
            }
            new Notice(`✅ 已保存到「${project}/04-项目总控/黄金开篇.md」`, 5000);
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                const leaf = this.app.workspace.getLeaf('tab');
                await leaf.openFile(file);
            }
            this.close();
        } catch (e) {
            log.error('[GoldenOpeningModal] 保存黄金开篇失败:', e);
            new Notice('❌ 保存失败，请检查权限', 5000);
        }
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
        const styleId = 'novel-writer-golden-opening-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
.nw-go-header {
    margin-bottom: 16px;
}
.nw-go-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 12px;
    border-bottom: 1px solid var(--background-modifier-border);
}
.nw-go-tab {
    padding: 8px 12px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
    white-space: nowrap;
}
.nw-go-tab:hover {
    color: var(--text-normal);
}
.nw-go-tab.active {
    color: var(--interactive-accent);
    border-bottom-color: var(--interactive-accent);
}
.nw-go-content {
    padding-top: 8px;
}
.nw-go-section {
    margin-bottom: 20px;
    padding: 16px;
    background: var(--background-secondary);
    border-radius: 8px;
}
.nw-go-section-title {
    margin: 0 0 12px 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
}
.nw-go-subtitle {
    margin: 16px 0 8px 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
}
.nw-go-desc {
    margin: 0 0 12px 0;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
}
.nw-go-label {
    display: block;
    margin: 12px 0 6px 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
}
.nw-go-textarea {
    width: 100%;
    font-size: 13px;
    box-sizing: border-box;
}
.nw-go-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
}
.nw-go-tag {
    padding: 6px 14px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 16px;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
}
.nw-go-tag:hover {
    border-color: var(--interactive-accent);
    color: var(--interactive-accent);
}
.nw-go-tag.active {
    background: var(--interactive-accent);
    border-color: var(--interactive-accent);
    color: white;
}
.nw-go-btn-row {
    display: flex;
    justify-content: center;
    margin-top: 16px;
}
.nw-go-chapter-card {
    padding: 14px;
    background: var(--background-primary);
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
    margin-bottom: 12px;
}
.nw-go-chapter-header {
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--background-modifier-border);
}
.nw-go-chapter-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--interactive-accent);
}
.nw-go-structure-list {
    margin-bottom: 12px;
}
.nw-go-structure-item {
    padding: 4px 0;
    font-size: 13px;
    color: var(--text-secondary);
}
.nw-go-chapter-outline {
    margin: 0;
    padding: 10px;
    background: var(--background-secondary);
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.7;
    color: var(--text-primary);
}
.nw-go-export-btn {
    width: 100%;
    margin-top: 12px;
    padding: 10px;
    font-size: 14px;
}
.nw-go-hook-card {
    padding: 12px;
    background: var(--background-primary);
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
    margin-bottom: 10px;
}
.nw-go-hook-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
}
.nw-go-hook-type {
    font-size: 12px;
    font-weight: 600;
    color: var(--interactive-accent);
}
.nw-go-copy-btn {
    padding: 3px 10px;
    font-size: 11px;
}
.nw-go-hook-content {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-primary);
}
.nw-go-score-card {
    text-align: center;
    padding: 20px;
    background: var(--background-primary);
    border-radius: 8px;
    margin-bottom: 16px;
}
.nw-go-score-number {
    font-size: 48px;
    font-weight: 700;
    color: var(--interactive-accent);
    line-height: 1;
}
.nw-go-score-label {
    font-size: 13px;
    color: var(--text-muted);
    margin-top: 4px;
}
.nw-go-score-grade {
    margin-top: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-success);
}
.nw-go-hook-detect-item {
    padding: 10px;
    background: var(--background-primary);
    border-radius: 6px;
    margin-bottom: 8px;
}
.nw-go-hook-detect-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
}
.nw-go-hook-detect-type {
    font-size: 12px;
    font-weight: 600;
    color: var(--interactive-accent);
    min-width: 70px;
}
.nw-go-strength-bar {
    flex: 1;
    height: 6px;
    background: var(--background-secondary);
    border-radius: 3px;
    overflow: hidden;
}
.nw-go-strength-fill {
    height: 100%;
    background: var(--interactive-accent);
    border-radius: 3px;
    transition: width 0.3s;
}
.nw-go-strength-value {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    min-width: 35px;
    text-align: right;
}
.nw-go-hook-detect-content {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.5;
}
.nw-go-analysis-text {
    margin: 0;
    padding: 12px;
    background: var(--background-primary);
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.7;
    color: var(--text-primary);
}
.nw-go-rhythm-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 16px;
}
@media (max-width: 500px) {
    .nw-go-rhythm-grid {
        grid-template-columns: 1fr;
    }
}
.nw-go-rhythm-card {
    padding: 14px;
    background: var(--background-primary);
    border-radius: 8px;
    text-align: center;
}
.nw-go-rhythm-label {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 4px;
}
.nw-go-rhythm-value {
    font-size: 18px;
    font-weight: 600;
    color: var(--interactive-accent);
    margin-bottom: 8px;
}
.nw-go-rhythm-bar {
    height: 8px;
    background: var(--background-secondary);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 4px;
}
.nw-go-rhythm-fill {
    height: 100%;
    background: var(--interactive-accent);
    border-radius: 4px;
    transition: width 0.3s;
}
.nw-go-rhythm-score {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
}
.nw-go-para-item {
    padding: 10px;
    background: var(--background-primary);
    border-radius: 6px;
    margin-bottom: 8px;
}
.nw-go-para-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
}
.nw-go-para-num {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
}
.nw-go-para-pace {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--background-secondary);
    color: var(--text-muted);
}
.nw-go-para-suggestion {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.5;
}
.nw-go-suggestions-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.nw-go-suggestion-item {
    padding: 8px 10px;
    background: var(--background-primary);
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.6;
}
.nw-go-suggestion-num {
    font-weight: 600;
    color: var(--interactive-accent);
}
.nw-go-suggestion-text {
    color: var(--text-primary);
}
.nw-go-char-card {
    padding: 12px;
    background: var(--background-primary);
    border-radius: 8px;
    margin-bottom: 10px;
    border-left: 3px solid var(--interactive-accent);
}
.nw-go-char-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
}
.nw-go-char-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
}
.nw-go-char-timing {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--background-secondary);
    color: var(--text-muted);
}
.nw-go-char-role,
.nw-go-char-relation {
    margin: 4px 0;
    font-size: 12px;
    color: var(--text-secondary);
}
.nw-go-dump-card {
    padding: 16px;
    background: var(--background-primary);
    border-radius: 8px;
    text-align: center;
    margin-bottom: 16px;
}
.nw-go-dump-status {
    margin-bottom: 12px;
}
.nw-go-dump-status-text {
    font-size: 16px;
    font-weight: 600;
}
.nw-go-dump-status-text.warning {
    color: var(--text-error);
}
.nw-go-dump-status-text.ok {
    color: var(--text-success);
}
.nw-go-severity-bar {
    height: 10px;
    background: var(--background-secondary);
    border-radius: 5px;
    overflow: hidden;
    margin-bottom: 6px;
}
.nw-go-severity-fill {
    height: 100%;
    border-radius: 5px;
    transition: width 0.3s;
}
.nw-go-severity-text {
    font-size: 12px;
    color: var(--text-muted);
}
.nw-go-dump-loc {
    padding: 6px 10px;
    background: var(--background-primary);
    border-radius: 6px;
    margin-bottom: 6px;
    font-size: 12px;
}
.nw-go-dump-loc-num {
    font-weight: 600;
    color: var(--text-error);
}
.nw-go-dump-loc-text {
    color: var(--text-secondary);
}
.nw-go-overall-score {
    text-align: center;
    padding: 24px;
    background: linear-gradient(135deg, var(--interactive-accent), var(--interactive-accent-hover));
    border-radius: 12px;
    margin-bottom: 20px;
    color: white;
}
.nw-go-overall-number {
    font-size: 64px;
    font-weight: 700;
    line-height: 1;
}
.nw-go-overall-label {
    font-size: 14px;
    opacity: 0.9;
    margin-top: 4px;
}
.nw-go-overall-grade {
    margin-top: 8px;
    font-size: 16px;
    font-weight: 600;
}
.nw-go-score-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 16px;
}
.nw-go-score-item {
    padding: 10px 12px;
    background: var(--background-primary);
    border-radius: 8px;
}
.nw-go-score-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
}
.nw-go-score-item-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
}
.nw-go-score-item-value {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
}
.nw-go-score-bar-wrap {
    height: 8px;
    background: var(--background-secondary);
    border-radius: 4px;
    overflow: hidden;
}
.nw-go-score-bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s;
}
.nw-go-improvement-item {
    padding: 12px;
    background: var(--background-primary);
    border-radius: 8px;
    margin-bottom: 10px;
    border-left: 4px solid;
}
.nw-go-improvement-item.priority-high {
    border-left-color: #ff6b6b;
}
.nw-go-improvement-item.priority-medium {
    border-left-color: #f9ca24;
}
.nw-go-improvement-item.priority-low {
    border-left-color: #4ecdc4;
}
.nw-go-priority-badge {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 6px;
    display: inline-block;
}
.nw-go-improvement-content {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-primary);
}
`;
        document.head.appendChild(style);
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
