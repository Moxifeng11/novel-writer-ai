/**
 * character-recognition-modal.ts — 角色识别审核入口
 *
 * 将 CharacterRecognitionPipeline（规则/向量/LLM 三层）与
 * SuggestionManager + CharacterReviewPanel + CategorizationReviewPanel 串成
 * 一个可用入口：识别当前章节 → 生成建议 → 人工采纳/拒绝/修改。
 *
 * FR-F-06：为原先无入口的角色识别模块提供真实调用方。
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { CharacterDeconstructor } from '@/engine/deconstructors/character-deconstructor';
import { CharacterRecognitionPipeline } from '@/engine/character-recognition-pipeline';
import { SuggestionManager } from '@/engine/suggestion-manager';
import { VectorEnhancer } from '@/engine/vector-enhancer';
import { ENGINE_NAMES } from '@/shared/engine-names';
import type { AnalysisSuggestion } from '@/engine/types/analysis-suggestion';
import { CharacterReviewPanel } from './components/character-review-panel';
import { CategorizationReviewPanel } from './components/categorization-review-panel';
import { createEmptyState } from './components/empty-state';
import { createLogger } from '@/shared/logger';

const log = createLogger('CharacterRecognitionModal');

/**
 * CharacterRecognitionModal 类。
 */
export class CharacterRecognitionModal extends Modal {
    private plugin: NovelWriterPlugin;
    private suggestionManager: SuggestionManager = new SuggestionManager();
    private statusEl!: HTMLElement;
    private resultEl!: HTMLElement;
    private analyzeBtn!: HTMLButtonElement;
    private characterPanel: CharacterReviewPanel | null = null;
    private categorizationPanel: CategorizationReviewPanel | null = null;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '👤 角色识别审核' });
        contentEl.createEl('p', {
            text: '基于当前章节正文识别角色候选，生成可审核建议。规则层始终启用；向量层在模型可用时自动加入。',
            attr: { style: 'color: var(--text-muted); font-size: 0.9em;' },
        });

        this.statusEl = contentEl.createDiv({
            attr: { style: 'font-size: 0.85em; color: var(--text-muted); margin: 8px 0;' },
        });

        this.analyzeBtn = contentEl.createEl('button', {
            text: '🔍 识别当前章节角色',
            cls: 'mod-cta',
        });
        this.analyzeBtn.onclick = () => void this.runAnalysis();

        this.resultEl = contentEl.createDiv({ attr: { style: 'margin-top: 12px;' } });
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }

    private async runAnalysis(): Promise<void> {
        // 工作台/项目页没有 activeFile：优先用界面当前章节，避免「请先打开文件」
        const target = this.plugin.getActiveChapterTarget();
        const file = target
            ? this.app.vault.getAbstractFileByPath(target.bodyPath)
            : this.app.workspace.getActiveFile();
        if (!(file instanceof TFile) || file.extension !== 'md') {
            new Notice('⚠️ 请先在工作台选择章节，或打开一个章节 Markdown 文件', 4000);
            return;
        }

        const text = await this.app.vault.read(file);
        if (text.trim().length < 100) {
            new Notice('⚠️ 当前文件内容过短，无法识别角色', 4000);
            return;
        }

        this.analyzeBtn.disabled = true;
        this.statusEl.setText('识别中…');
        try {
            const vectorEnhancer = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.VECTOR_ENHANCER) ?? undefined;
            const deconstructor = new CharacterDeconstructor(vectorEnhancer);
            const pipeline = new CharacterRecognitionPipeline(
                deconstructor,
                this.suggestionManager,
                vectorEnhancer,
            );

            // v4.25：设置页「角色识别设置」此前零消费方（空转 UI）——这里最小接线：
            // 层开关来自 characterRecognitionLayers；向量阈值/LLM 批大小/候选上限来自对应分组。
            const layers = new Set(this.plugin.settings.characterRecognitionLayers ?? ['rule', 'vector']);
            const vectorLayerCfg = this.plugin.settings.vectorLayer;
            const llmLayerCfg = this.plugin.settings.llmLayer;
            const result = await pipeline.analyze(text, {
                enableRuleLayer: layers.has('rule'),
                enableVectorLayer: layers.has('vector') && !!vectorEnhancer && vectorLayerCfg?.enabled !== false,
                enableLLMLayer: layers.has('llm') && llmLayerCfg?.enabled === true,
                vectorThreshold: vectorLayerCfg?.semanticFilterThreshold,
                llmBatchSize: llmLayerCfg?.verifyBatchSize,
                maxCandidates: 60,
            });

            // pipeline 只把 character 建议写入 manager，合并建议与角色定位需宿主补录
            for (const suggestion of result.mergeSuggestions) {
                this.suggestionManager.addSuggestion({
                    type: suggestion.type,
                    confidence: suggestion.confidence,
                    source: suggestion.source,
                    payload: suggestion.payload,
                    reason: suggestion.reason,
                    evidence: suggestion.evidence,
                });
            }
            for (const character of result.finalCharacters) {
                const name = typeof character?.name === 'string' ? character.name : '';
                if (!name) continue;
                const category = character.role === 'protagonist'
                    ? 'protagonist'
                    : character.role === 'antagonist'
                        ? 'antagonist'
                        : 'supporting';
                this.suggestionManager.addSuggestion({
                    type: 'character_role',
                    confidence: 0.6,
                    source: 'rule',
                    payload: { characterName: name, category },
                    reason: '基于规则层角色定位',
                });
            }

            const stats = this.suggestionManager.getStats();
            const layerText = Object.entries(result.layerStatus)
                .map(([layer, status]) => `${layer}:${status}`)
                .join(' ');
            this.statusEl.setText(`完成：${stats.total} 条建议（${layerText}）`);

            this.renderPanels();
        } catch (e) {
            log.warn('[CharacterRecognitionModal] 识别失败:', e);
            this.statusEl.setText('识别失败');
            new Notice(`❌ 角色识别失败：${(e as Error).message}`, 5000);
        } finally {
            this.analyzeBtn.disabled = false;
        }
    }

    private renderPanels(): void {
        this.resultEl.empty();

        if (this.suggestionManager.getStats().total === 0) {
            this.resultEl.appendChild(createEmptyState({
                icon: 'search',
                title: '未识别到角色',
                description: '当前章节可能缺少足够的人物对话或姓名线索，可换一章再试。',
            }));
            return;
        }

        const characterWrap = this.resultEl.createDiv();
        const categorizationWrap = this.resultEl.createDiv();

        this.characterPanel = new CharacterReviewPanel(characterWrap, {
            suggestionManager: this.suggestionManager,
            onAdopt: (suggestion: AnalysisSuggestion) => {
                this.suggestionManager.adopt(suggestion.id);
                this.refreshPanels();
            },
            onReject: (suggestion: AnalysisSuggestion) => {
                this.suggestionManager.reject(suggestion.id);
                this.refreshPanels();
            },
            onModify: (suggestion: AnalysisSuggestion, payload: Record<string, any>) => {
                this.suggestionManager.adopt(suggestion.id, payload);
                this.refreshPanels();
            },
            onBatchAdopt: () => {
                this.suggestionManager.batchAdopt({});
                this.refreshPanels();
            },
        });
        this.characterPanel.render();

        this.categorizationPanel = new CategorizationReviewPanel(categorizationWrap, {
            suggestionManager: this.suggestionManager,
            categoryTypes: ['protagonist', 'antagonist', 'supporting'],
            onAdopt: (suggestion: AnalysisSuggestion) => {
                this.suggestionManager.adopt(suggestion.id);
                this.refreshPanels();
            },
            onReject: (suggestion: AnalysisSuggestion) => {
                this.suggestionManager.reject(suggestion.id);
                this.refreshPanels();
            },
            onModify: (suggestion: AnalysisSuggestion, newCategory: string) => {
                this.suggestionManager.adopt(suggestion.id, { category: newCategory });
                this.refreshPanels();
            },
            onBatchAdopt: () => {
                this.suggestionManager.batchAdopt({ type: 'character_role' });
                this.refreshPanels();
            },
        });
        this.categorizationPanel.render();
    }

    private refreshPanels(): void {
        this.characterPanel?.update();
        this.categorizationPanel?.update();
    }
}
