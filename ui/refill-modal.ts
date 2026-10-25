import { App, Modal, Notice } from 'obsidian';
import { KnowledgeBaseManager, BookBasicInfo } from '../services/knowledge-base-manager';
import { DeconstructionScheduler, BreakdownDimension, BreakdownProgress } from '../services/deconstruction-scheduler';
import { StyleFingerprint, StyleFingerprintLibrary } from '../engine/style-fingerprint-library';
import { FingerprintExtractor } from '../engine/fingerprint-extractor';
import type { ProviderFactoryConfig } from '../engine/embedding/provider-factory';
import { createFingerprintEmbedding } from './fingerprint-embedding';
import type { AIEngine } from '../engine/ai-engine';
import { createLogger } from '../shared/logger';
import { OperationConfirmModal } from './components/progress';


const log = createLogger('RefillModal');
type RefillMode = 'missing' | 'all';
type RefillType = 'knowledge' | 'fingerprint';

interface FingerprintRefillOptions {
    refillFeatures: boolean;
    refillSamples: boolean;
    reVectorize: boolean;
}

const DIMENSION_CONFIG: { key: BreakdownDimension; label: string; icon: string }[] = [
    { key: 'style', label: '风格', icon: '🎨' },
    { key: 'rhythm', label: '节奏', icon: '🎵' },
    { key: 'technique', label: '技巧', icon: '⚡' },
    { key: 'structure', label: '结构', icon: '🏗️' },
    { key: 'character', label: '人设', icon: '👤' },
    { key: 'foreshadow', label: '伏笔', icon: '🔮' },
];

export class RefillModal extends Modal {
    private type: RefillType;
    
    private bookId?: string;
    private bookName?: string;
    private knowledgeBaseManager?: KnowledgeBaseManager;
    private deconstructionScheduler?: DeconstructionScheduler;
    
    private fingerprint?: StyleFingerprint;
    private fingerprintLibrary?: StyleFingerprintLibrary;
    private aiEngine?: AIEngine;
    private embeddingSettings?: Partial<ProviderFactoryConfig>;
    
    private mode: RefillMode = 'missing';
    private selectedDimensions: Set<BreakdownDimension> = new Set();
    private dimensionStatus: Record<BreakdownDimension, 'completed' | 'missing' | 'failed'> = {
        style: 'missing',
        rhythm: 'missing',
        technique: 'missing',
        structure: 'missing',
        character: 'missing',
        foreshadow: 'missing',
        commercial: 'missing',
        readability: 'missing',
    };
    
    private fingerprintRefillOptions: FingerprintRefillOptions = {
        refillFeatures: true,
        refillSamples: true,
        reVectorize: true,
    };
    
    private isRunning = false;
    private currentProgress = 0;
    private progressMessage = '';
    private currentDimension = '';
    
    private progressBar?: HTMLElement;
    private progressText?: HTMLElement;
    private startBtn?: HTMLElement;
    private cancelBtn?: HTMLElement;
    private modeRadios?: HTMLElement[];
    private dimensionCheckboxes?: Map<BreakdownDimension, HTMLElement>;

    constructor(
        app: App,
        options: {
            type: 'knowledge';
            bookId: string;
            bookName: string;
            knowledgeBaseManager: KnowledgeBaseManager;
            deconstructionScheduler: DeconstructionScheduler;
        } | {
            type: 'fingerprint';
            fingerprint: StyleFingerprint;
            fingerprintLibrary: StyleFingerprintLibrary;
            aiEngine: AIEngine;
            /** 插件设置：用于按「向量提供商」构造 embedding（缺省会明确中止，不回退 Ollama） */
            embeddingSettings?: Partial<ProviderFactoryConfig>;
        }
    ) {
        super(app);
        this.type = options.type;
        
        if (options.type === 'knowledge') {
            this.bookId = options.bookId;
            this.bookName = options.bookName;
            this.knowledgeBaseManager = options.knowledgeBaseManager;
            this.deconstructionScheduler = options.deconstructionScheduler;
        } else {
            this.fingerprint = options.fingerprint;
            this.fingerprintLibrary = options.fingerprintLibrary;
            this.aiEngine = options.aiEngine;
            this.embeddingSettings = options.embeddingSettings;
        }
    }

    async onOpen() {
        this.modalEl.addClass('nw-scope');
        if (this.type === 'knowledge') {
            await this.loadDimensionStatus();
        }
        this.render();
    }

    onClose() {
        this.contentEl.empty();
    }

    private async loadDimensionStatus(): Promise<void> {
        if (!this.knowledgeBaseManager || !this.bookId) return;
        this.dimensionStatus = await this.knowledgeBaseManager.getDimensionStatus(this.bookId);
        this.updateSelectedDimensions();
    }

    private updateSelectedDimensions(): void {
        this.selectedDimensions.clear();
        if (this.mode === 'missing') {
            for (const [dim, status] of Object.entries(this.dimensionStatus)) {
                if (status === 'missing' || status === 'failed') {
                    this.selectedDimensions.add(dim as BreakdownDimension);
                }
            }
        } else {
            DIMENSION_CONFIG.forEach(d => this.selectedDimensions.add(d.key));
        }
    }

    private getEstimatedTime(): number {
        return this.selectedDimensions.size * 30;
    }

    private formatTime(seconds: number): string {
        if (seconds < 60) {
            return `${seconds}秒`;
        }
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `${mins}分${secs}秒` : `${mins}分钟`;
    }

    private getFingerprintCompleteness(fp: StyleFingerprint): { score: number; level: 'green' | 'yellow' | 'red'; label: string } {
        let score = 0;
        
        const features = fp.features;
        const featureKeys: Array<keyof typeof features> = ['sentenceRhythm', 'wordPreference', 'narrativeStyle', 'rhetoric', 'dialogueStyle', 'paragraphStructure', 'overallTone'];
        const filledFeatures = featureKeys.filter(k => features[k] && features[k].length > 0).length;
        score += Math.round((filledFeatures / 7) * 40);
        
        if (fp.samples.length >= 15) {
            score += 30;
        } else if (fp.samples.length > 0) {
            score += Math.round((fp.samples.length / 15) * 30);
        }
        
        if (fp.sourceText && fp.sourceText.length > 0) {
            score += 30;
        }
        
        if (score >= 85) {
            return { score, level: 'green', label: '完整' };
        } else if (score >= 50) {
            return { score, level: 'yellow', label: '部分完整' };
        } else {
            return { score, level: 'red', label: '不完整' };
        }
    }

    private getCompletenessBadge(completeness: { level: 'green' | 'yellow' | 'red'; label: string; score: number }): HTMLElement {
        const colors: Record<string, { bg: string; text: string }> = {
            green: { bg: 'rgba(var(--background-modifier-success-rgb), 0.15)', text: 'var(--text-success)' },
            yellow: { bg: 'rgba(var(--background-modifier-warning-rgb), 0.15)', text: 'var(--text-warning)' },
            red: { bg: 'rgba(var(--background-modifier-error-rgb), 0.15)', text: 'var(--text-error)' },
        };
        const info = colors[completeness.level];
        const badge = createDiv({
            attr: {
                style: `display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600;color:${info.text};background:${info.bg};`
            }
        });
        const dots: Record<string, string> = { green: '●●●', yellow: '●●○', red: '●○○' };
        badge.createSpan({ text: dots[completeness.level] });
        badge.createSpan({ text: `${completeness.label} (${completeness.score}%)` });
        return badge;
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        this.modalEl.addClass('nw-modal-sm');
        contentEl.style.width = '100%';

        if (this.type === 'fingerprint') {
            this.renderFingerprintRefill(contentEl);
        } else {
            this.renderKnowledgeRefill(contentEl);
        }
    }

    private renderFingerprintRefill(contentEl: HTMLElement): void {
        if (!this.fingerprint) return;

        contentEl.createEl('h3', {
            text: `🔄 重新提取指纹 - ${this.fingerprint.name}`,
            attr: { style: 'margin:0 0 16px 0;font-size:16px;' }
        });

        const completeness = this.getFingerprintCompleteness(this.fingerprint);
        const completenessRow = contentEl.createDiv({
            attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;' }
        });
        completenessRow.createEl('div', {
            text: '当前完整度',
            attr: { style: 'font-size:13px;font-weight:600;' }
        });
        completenessRow.appendChild(this.getCompletenessBadge(completeness));

        const optionsSection = contentEl.createDiv({
            attr: { style: 'margin-bottom:20px;padding:12px;background:var(--background-secondary);border-radius:6px;' }
        });
        optionsSection.createEl('div', {
            text: '补全选项',
            attr: { style: 'font-size:13px;font-weight:600;margin-bottom:10px;' }
        });

        const options = [
            { key: 'refillFeatures', label: '补全 features', desc: '重新从 sourceText 提取特征', icon: '🎨' },
            { key: 'refillSamples', label: '补全 samples', desc: '重新从 sourceText 采样（15-30段）', icon: '📝' },
            { key: 'reVectorize', label: '重新向量化', desc: '调用 vectorStore.add()', icon: '🧠' },
        ];

        options.forEach(opt => {
            const isSelected = this.fingerprintRefillOptions[opt.key as keyof FingerprintRefillOptions];
            const row = optionsSection.createDiv({
                attr: {
                    style: `
                        display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer;
                        border-bottom:1px solid var(--background-modifier-border);
                    `
                }
            });

            const checkbox = row.createEl('input', {
                type: 'checkbox',
                attr: {
                    checked: isSelected,
                    disabled: this.isRunning,
                    style: 'width:16px;height:16px;cursor:pointer;'
                }
            });

            checkbox.addEventListener('change', () => {
                this.fingerprintRefillOptions[opt.key as keyof FingerprintRefillOptions] = checkbox.checked;
                this.render();
            });

            const info = row.createDiv({ attr: { style: 'flex:1;' } });
            info.createEl('div', {
                text: `${opt.icon} ${opt.label}`,
                attr: { style: 'font-size:13px;font-weight:500;' }
            });
            info.createEl('div', {
                text: opt.desc,
                attr: { style: 'font-size:11px;color:var(--text-muted);' }
            });
        });

        if (this.isRunning) {
            const progressSection = contentEl.createDiv({
                attr: { style: 'margin-bottom:16px;' }
            });

            progressSection.createEl('div', {
                text: this.progressMessage || '重新提取中...',
                attr: { style: 'font-size:13px;margin-bottom:8px;text-align:center;' }
            });

            const barContainer = progressSection.createDiv({
                attr: {
                    style: 'height:8px;background:var(--background-secondary);border-radius:4px;overflow:hidden;'
                }
            });

            this.progressBar = barContainer.createDiv({
                attr: {
                    style: `
                        height:100%;width:${this.currentProgress}%;
                        background:var(--interactive-accent);border-radius:4px;
                        transition:width 0.3s ease;
                    `
                }
            });

            this.progressText = progressSection.createDiv({
                text: `${this.currentProgress}%`,
                attr: { style: 'font-size:12px;color:var(--text-muted);text-align:center;margin-top:6px;' }
            });
        }

        const btnRow = contentEl.createDiv({
            attr: { style: 'display:flex;gap:10px;justify-content:flex-end;' }
        });

        this.cancelBtn = btnRow.createEl('button', {
            text: this.isRunning ? '关闭（后台继续）' : '取消',
            attr: {
                type: 'button',
                style: `
                    padding:8px 20px;cursor:pointer;
                    border:1px solid var(--background-modifier-border);
                    border-radius:6px;font-size:13px;
                    background:var(--background-primary);color:var(--text-normal);
                `
            }
        });
        this.cancelBtn.addEventListener('click', () => {
            this.close();
        });

        if (!this.isRunning) {
            const hasOptions = Object.values(this.fingerprintRefillOptions).some(v => v);
            this.startBtn = btnRow.createEl('button', {
                text: '🚀 开始重新提取',
                attr: {
                    type: 'button',
                    style: `
                        padding:8px 24px;cursor:pointer;
                        border:none;border-radius:6px;font-size:13px;font-weight:600;
                        background:${hasOptions ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
                        color:${hasOptions ? 'var(--text-on-accent)' : 'var(--text-muted)'};
                        ${!hasOptions ? 'cursor:not-allowed;' : ''}
                    `
                }
            });
            this.startBtn.addEventListener('click', () => {
                if (!hasOptions) return;
                this.startFingerprintRefill();
            });
        }
    }

    private renderKnowledgeRefill(contentEl: HTMLElement): void {
        contentEl.createEl('h3', {
            text: `🔄 补全拆解 - 《${this.bookName}》`,
            attr: { style: 'margin:0 0 16px 0;font-size:16px;' }
        });

        const modeSection = contentEl.createDiv({
            attr: { style: 'margin-bottom:20px;padding:12px;background:var(--background-secondary);border-radius:6px;' }
        });
        modeSection.createEl('div', {
            text: '拆解模式',
            attr: { style: 'font-size:13px;font-weight:600;margin-bottom:10px;' }
        });

        this.modeRadios = [];
        const modes: { value: RefillMode; label: string; desc: string }[] = [
            { value: 'missing', label: '补缺失维度', desc: '仅拆解未完成或失败的维度' },
            { value: 'all', label: '全部重跑', desc: '重新拆解所有维度，覆盖已有结果' },
        ];

        modes.forEach(mode => {
            const row = modeSection.createDiv({
                attr: {
                    style: 'display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;'
                }
            });

            const radio = row.createEl('input', {
                type: 'radio',
                attr: {
                    name: 'refill-mode',
                    value: mode.value,
                    checked: this.mode === mode.value,
                    style: 'width:16px;height:16px;'
                }
            });
            this.modeRadios!.push(radio);

            radio.addEventListener('change', () => {
                this.mode = mode.value;
                this.updateSelectedDimensions();
                this.render();
            });

            const label = row.createDiv();
            label.createEl('div', {
                text: mode.label,
                attr: { style: 'font-size:13px;font-weight:500;' }
            });
            label.createEl('div', {
                text: mode.desc,
                attr: { style: 'font-size:11px;color:var(--text-muted);' }
            });
        });

        const dimSection = contentEl.createDiv({
            attr: { style: 'margin-bottom:20px;' }
        });
        dimSection.createEl('div', {
            text: '选择维度',
            attr: { style: 'font-size:13px;font-weight:600;margin-bottom:10px;' }
        });

        const grid = dimSection.createDiv({
            attr: { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;' }
        });

        this.dimensionCheckboxes = new Map();

        DIMENSION_CONFIG.forEach(dim => {
            const isSelected = this.selectedDimensions.has(dim.key);
            const status = this.dimensionStatus[dim.key];

            const checkboxEl = grid.createDiv({
                attr: {
                    style: `
                        display:flex;align-items:center;gap:6px;
                        padding:8px 12px;border-radius:6px;
                        background:${isSelected ? 'rgba(var(--interactive-accent-rgb), 0.1)' : 'var(--background-secondary)'};
                        border:1px solid ${isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
                        cursor:pointer;transition:all 0.2s;
                    `
                }
            });

            checkboxEl.addEventListener('click', () => {
                if (this.isRunning) return;
                if (isSelected) {
                    this.selectedDimensions.delete(dim.key);
                } else {
                    this.selectedDimensions.add(dim.key);
                }
                this.render();
            });

            const checkbox = checkboxEl.createEl('input', {
                type: 'checkbox',
                attr: {
                    checked: isSelected,
                    disabled: this.isRunning,
                    style: 'width:14px;height:14px;cursor:pointer;'
                }
            });
            this.dimensionCheckboxes!.set(dim.key, checkbox);

            const info = checkboxEl.createDiv({ attr: { style: 'flex:1;' } });
            info.createEl('div', {
                text: `${dim.icon} ${dim.label}`,
                attr: { style: 'font-size:12px;font-weight:500;' }
            });

            const statusText = status === 'completed' ? '✓ 已完成' : status === 'failed' ? '✗ 失败' : '○ 缺失';
            const statusColor = status === 'completed' ? 'var(--text-success)' : status === 'failed' ? 'var(--text-error)' : 'var(--text-muted)';
            info.createEl('div', {
                text: statusText,
                attr: { style: `font-size:10px;color:${statusColor};` }
            });
        });

        const timeSection = contentEl.createDiv({
            attr: {
                style: 'margin-bottom:20px;padding:12px;background:var(--background-secondary-alt);border-radius:6px;'
            }
        });
        timeSection.createEl('div', {
            text: `⏱️ 预估时间：${this.formatTime(this.getEstimatedTime())}（每维度约30秒）`,
            attr: { style: 'font-size:13px;color:var(--text-muted);' }
        });
        timeSection.createEl('div', {
            text: `📋 已选择 ${this.selectedDimensions.size} / 6 个维度`,
            attr: { style: 'font-size:12px;color:var(--text-faint);margin-top:4px;' }
        });

        if (this.isRunning) {
            const progressSection = contentEl.createDiv({
                attr: { style: 'margin-bottom:16px;' }
            });

            progressSection.createEl('div', {
                text: this.progressMessage || '拆解中...',
                attr: { style: 'font-size:13px;margin-bottom:8px;text-align:center;' }
            });

            if (this.currentDimension) {
                progressSection.createEl('div', {
                    text: `当前：${this.currentDimension}`,
                    attr: { style: 'font-size:12px;color:var(--text-muted);text-align:center;margin-bottom:8px;' }
                });
            }

            const barContainer = progressSection.createDiv({
                attr: {
                    style: 'height:8px;background:var(--background-secondary);border-radius:4px;overflow:hidden;'
                }
            });

            this.progressBar = barContainer.createDiv({
                attr: {
                    style: `
                        height:100%;width:${this.currentProgress}%;
                        background:var(--interactive-accent);border-radius:4px;
                        transition:width 0.3s ease;
                    `
                }
            });

            this.progressText = progressSection.createDiv({
                text: `${this.currentProgress}%`,
                attr: { style: 'font-size:12px;color:var(--text-muted);text-align:center;margin-top:6px;' }
            });
        }

        const btnRow = contentEl.createDiv({
            attr: { style: 'display:flex;gap:10px;justify-content:flex-end;' }
        });

        this.cancelBtn = btnRow.createEl('button', {
            text: this.isRunning ? '关闭（后台继续）' : '取消',
            attr: {
                type: 'button',
                style: `
                    padding:8px 20px;cursor:pointer;
                    border:1px solid var(--background-modifier-border);
                    border-radius:6px;font-size:13px;
                    background:${this.isRunning ? 'var(--background-secondary)' : 'var(--background-primary)'};color:var(--text-normal);
                `
            }
        });
        this.cancelBtn.addEventListener('click', () => {
            this.close();
        });

        if (!this.isRunning) {
            this.startBtn = btnRow.createEl('button', {
                text: '🚀 开始拆解',
                attr: {
                    type: 'button',
                    style: `
                        padding:8px 24px;cursor:pointer;
                        border:none;border-radius:6px;font-size:13px;font-weight:600;
                        background:${this.selectedDimensions.size > 0 ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
                        color:${this.selectedDimensions.size > 0 ? 'var(--text-on-accent)' : 'var(--text-muted)'};
                        ${this.selectedDimensions.size === 0 ? 'cursor:not-allowed;' : ''}
                    `
                }
            });
            this.startBtn.addEventListener('click', () => {
                if (this.selectedDimensions.size === 0) return;
                this.startDeconstruction();
            });
        }
    }

    private async startDeconstruction(): Promise<void> {
        if (this.mode === 'all') {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '重新拆解',
                description: '确定要重新拆解所有维度吗？这将覆盖已有的拆解结果。',
                confirmText: '确认拆解',
                cancelText: '取消',
            });
            if (!confirmed) {
                return;
            }
        }

        this.isRunning = true;
        this.currentProgress = 0;
        this.progressMessage = '准备开始拆解...';
        this.render();

        try {
            if (!this.knowledgeBaseManager || !this.bookId || !this.deconstructionScheduler) {
                throw new Error('缺少必要的服务实例');
            }
            const book = await this.knowledgeBaseManager.getBook(this.bookId);
            if (!book) {
                new Notice('❌ 书籍不存在');
                this.isRunning = false;
                this.render();
                return;
            }

            const sourceText = await this.knowledgeBaseManager.getSourceText(this.bookId);
            const dimensions = Array.from(this.selectedDimensions);

            const unsubscribe = this.deconstructionScheduler.onProgress((progress: BreakdownProgress) => {
                if (progress.bookId !== this.bookId) return;

                this.currentProgress = progress.totalProgress;
                this.progressMessage = progress.message || '拆解中...';
                
                const dimLabels: Record<BreakdownDimension, string> = {
                    style: '风格分析',
                    rhythm: '节奏分析',
                    technique: '写作技巧',
                    structure: '结构拆解',
                    character: '人设提取',
                    foreshadow: '伏笔梳理',
                    commercial: '商业价值',
                    readability: '可读性分析',
                };
                this.currentDimension = progress.currentDimension ? dimLabels[progress.currentDimension] : '';

                if (this.progressBar) {
                    this.progressBar.style.width = `${this.currentProgress}%`;
                }
                if (this.progressText) {
                    this.progressText.textContent = `${this.currentProgress}%`;
                }

                if (progress.status === 'completed') {
                    unsubscribe();
                    new Notice(`✅ 《${this.bookName}》拆解完成！`);
                    this.isRunning = false;
                    this.loadDimensionStatus().then(() => this.render());
                } else if (progress.status === 'failed') {
                    unsubscribe();
                    new Notice(`❌ 《${this.bookName}》拆解失败：${progress.error || '未知错误'}`);
                    this.isRunning = false;
                    this.loadDimensionStatus().then(() => this.render());
                } else if (progress.status === 'cancelled') {
                    unsubscribe();
                    this.isRunning = false;
                    this.render();
                }
            });

            await this.deconstructionScheduler.addTask(this.bookId, sourceText, dimensions);
        } catch (error) {
            log.error('[RefillModal] 拆解失败:', error);
            new Notice(`❌ 拆解失败：${error instanceof Error ? error.message : String(error)}`);
            this.isRunning = false;
            this.render();
        }
    }

    private async startFingerprintRefill(): Promise<void> {
        if (!this.fingerprint || !this.fingerprintLibrary || !this.aiEngine) return;

        if (!this.fingerprint.sourceText || this.fingerprint.sourceText.length === 0) {
            new Notice('❌ 指纹缺少 sourceText，无法重新提取');
            return;
        }

        if (!this.embeddingSettings) {
            new Notice('❌ 缺少向量设置，无法重新提取指纹（请从设置页重新打开）');
            return;
        }

        this.isRunning = true;
        this.currentProgress = 0;
        this.progressMessage = '准备重新提取...';
        this.render();

        try {
            const vectorScope: 'global' | 'project' = this.fingerprint.scope === 'template' ? 'global' : this.fingerprint.scope;
            const { provider, vectorStore } = createFingerprintEmbedding(
                this.app,
                vectorScope,
                this.embeddingSettings,
            );
            const extractor = new FingerprintExtractor(this.aiEngine, provider, vectorStore);

            const onProgress = (progress: { phase: string; percent: number; message: string }) => {
                this.currentProgress = progress.percent;
                this.progressMessage = progress.message;
                
                if (this.progressBar) {
                    this.progressBar.style.width = `${this.currentProgress}%`;
                }
                if (this.progressText) {
                    this.progressText.textContent = `${this.currentProgress}%`;
                }
            };

            const options = {
                refillFeatures: this.fingerprintRefillOptions.refillFeatures,
                refillSamples: this.fingerprintRefillOptions.refillSamples,
                reVectorize: this.fingerprintRefillOptions.reVectorize,
            };

            await this.fingerprintLibrary.refillFingerprint(
                this.fingerprint.id,
                this.fingerprint.scope,
                options,
                this.fingerprint.sourceText,
                extractor,
                vectorStore,
                onProgress
            );

            new Notice(`✅ 指纹「${this.fingerprint.name}」重新提取完成！`);
            this.isRunning = false;
            this.fingerprint = this.fingerprintLibrary.getFingerprint(this.fingerprint.id, this.fingerprint.scope);
            this.render();
        } catch (error) {
            log.error('[RefillModal] 指纹重新提取失败:', error);
            new Notice(`❌ 重新提取失败：${error instanceof Error ? error.message : String(error)}`);
            this.isRunning = false;
            this.render();
        }
    }
}