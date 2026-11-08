import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { AIEngine, BatchEntityResult } from '@/engine/ai-engine';
import { ContextManager } from '@/engine/context-manager';
import { mkdirp, showSuccess, showError, showProgress, hideProgress } from '@/utils/helpers';
import { ENTITY_CATEGORIES } from '@/shared/entity-registry';
import {
    SUBDIR_CHARS,
    SUBDIR_LOCS,
    SUBDIR_FACTIONS,
    SUBDIR_ITEMS,
    pjWorldview,
    pjSettingLib,
} from '@/shared/paths';
import { ExistingEntityManagerModal } from './existing-entity-manager';
import type { EntityCategory as ModelCategory } from '@/shared/entity-models';
import { saveEntities, formatSaveOutcome, type EntityKind } from '@/shared/entity-persistence';
import { ensureEntityIntegrity } from '@/shared/entity-integrity';
import { mergeFanficRequirement } from '@/shared/fanfic-rules';
import { readFanficPromptBlockWithNotice } from './fanfic-prompt-notice';
import { createLogger } from '@/shared/logger';


const log = createLogger('UnifiedEntityGenerateModal');
interface ManagedEntity {
    entity: BatchEntityResult;
    deleted: boolean;
    modified: boolean;
    validated: boolean;
}

/** 类型选择卡片：承载分类 key 的临时属性（仅类型层，不入运行时） */
type CategoryCardElement = HTMLElement & { _catKey?: ModelCategory };

type GenerateStep = 'type-select' | 'basic-info' | 'params' | 'preview' | 'confirm';

/**
 * UnifiedEntityGenerateModal 类。
 */
export class UnifiedEntityGenerateModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private contextManager: ContextManager;

    private _currentProject: string = '';
    private _pendingResults: ManagedEntity[] = [];
    private _abortController: AbortController | null = null;

    private _currentStep: GenerateStep = 'type-select';
    private _selectedCategory: ModelCategory = 'character';
    private _entityNames: string = '';
    private _description: string = '';
    private _count: number = 5;
    private _generating: boolean = false;

    private _stepIndicatorEl!: HTMLElement;
    private _contentAreaEl!: HTMLElement;

    private categoryConfig: Record<ModelCategory, {
        subdir: string;
        label: string;
        icon: string;
        namePlaceholder: string;
        promptPlaceholder: string;
    }>;

    constructor(
        app: App,
        plugin: NovelWriterPlugin,
        project?: string,
        initialCategory?: ModelCategory,
    ) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
        this.contextManager = plugin.ctxManager;

        if (project) {
            this._currentProject = project;
        }
        if (initialCategory) {
            this._selectedCategory = initialCategory;
            if (project) {
                this._currentStep = 'basic-info';
            }
        }

        this.categoryConfig = {
            character: {
                subdir: SUBDIR_CHARS,
                label: '人物',
                icon: '👤',
                namePlaceholder: '如：张三, 李四, 王五',
                promptPlaceholder:
                    '例如：\n- 主角是一个冷酷的杀手，有一个温柔的妹妹\n- 反派是曾经的恩师，因理念分歧走向对立\n- 需要 2 个主角的队友，性格互补\n\n留空则由 AI 根据世界观自由发挥',
            },
            faction: {
                subdir: SUBDIR_FACTIONS,
                label: '势力',
                icon: '🏰',
                namePlaceholder: '如：青云宗, 天剑门, 暗影会',
                promptPlaceholder:
                    '例如：\n- 正道领袖宗门，弟子众多但内部派系林立\n- 隐世家族，掌握上古秘法\n- 魔道组织，行踪诡秘\n\n留空则由 AI 根据世界观自由发挥',
            },
            location: {
                subdir: SUBDIR_LOCS,
                label: '地点',
                icon: '📍',
                namePlaceholder: '如：青云山, 落霞城, 幽冥谷',
                promptPlaceholder:
                    '例如：\n- 云雾缭绕的修仙圣地\n- 繁华的贸易都市\n- 凶险的禁地秘境\n\n留空则由 AI 根据世界观自由发挥',
            },
            item: {
                subdir: SUBDIR_ITEMS,
                label: '物品功法',
                icon: '⚔️',
                namePlaceholder: '如：倚天剑, 九阳神功, 太虚丹',
                promptPlaceholder:
                    '例如：\n- 上古神兵，有剑灵\n- 顶级功法，修炼难度极高\n- 稀有丹药，可提升修为\n\n留空则由 AI 根据世界观自由发挥',
            },
        };
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            // Rev 184：640px 下 5 步向导与两列字段挤压，改用 900px 档并允许小屏收缩
            wrapper.addClass('nw-modal-lg');
        }
        contentEl.addClass('nw-entity-scope');
        contentEl.addClass('nw-form-stack');

        contentEl.empty();
        this._pendingResults = [];

        this._renderStepIndicator();
        this._contentAreaEl = contentEl.createDiv();
        this._renderCurrentStep();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        super.onClose();
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
        this.plugin._entityModalJustClosed = true;
        const callbacks = this.plugin._entityModalCloseCallbacks;
        while (callbacks.length > 0) {
            const cb = callbacks.shift();
            try {
                cb?.();
            } catch (e) {
                log.warn('[小说工坊] 实体Modal关闭回调异常:', e);
            }
        }
    }

    private _renderStepIndicator(): void {
        const { contentEl } = this;

        this._stepIndicatorEl = contentEl.createDiv({ cls: 'nw-ue-steps' });

        const steps: { key: GenerateStep; label: string; num: number }[] = [
            { key: 'type-select', label: '选择类型', num: 1 },
            { key: 'basic-info', label: '基本信息', num: 2 },
            { key: 'params', label: '生成参数', num: 3 },
            { key: 'preview', label: '预览确认', num: 4 },
            { key: 'confirm', label: '完成保存', num: 5 },
        ];

        const stepKeys = new Set(steps.map((s) => s.key));
        const allSteps = steps;
        let currentIdx = allSteps.findIndex((s) => s.key === this._currentStep);
        if (currentIdx < 0) currentIdx = 0;

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const stepItem = this._stepIndicatorEl.createDiv({ cls: 'nw-ue-step' });
            const stepState = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'pending';
            stepItem.addClass(`nw-is-${stepState}`);

            stepItem.createEl('div', {
                text: String(step.num),
                cls: 'nw-ue-step-circle',
            });

            stepItem.createEl('span', {
                text: step.label,
                cls: 'nw-ue-step-label',
            });

            if (i < steps.length - 1) {
                const line = this._stepIndicatorEl.createDiv({ cls: 'nw-ue-step-line' });
                if (i < currentIdx) line.addClass('nw-is-done');
            }
        }
    }

    private _renderCurrentStep(): void {
        this._contentAreaEl.empty();

        switch (this._currentStep) {
            case 'type-select':
                this._renderTypeSelectStep();
                break;
            case 'basic-info':
                this._renderBasicInfoStep();
                break;
            case 'params':
                this._renderParamsStep();
                break;
            case 'preview':
                this._renderPreviewStep();
                break;
            case 'confirm':
                this._renderConfirmStep();
                break;
        }
    }

    private _goToStep(step: GenerateStep): void {
        this._currentStep = step;
        this._stepIndicatorEl.remove();
        this._renderStepIndicator();
        this._renderCurrentStep();
    }

    private _renderTypeSelectStep(): void {
        const container = this._contentAreaEl;

        container.createEl('h2', { text: '✨ 选择实体类型', cls: 'nw-ue-heading' });

        const projectRow = container.createDiv({ cls: 'nw-ue-project-info' });
        projectRow.createEl('label', { text: '选择项目：', cls: 'nw-ue-label' });
        const projectSelect = projectRow.createEl('select', {
            cls: 'nw-select novel-writer-select',
        });
        projectSelect.addClass('nw-ue-w-full');

        this.contextManager.detectProjects().then((projects) => {
            if (projects.length === 0) {
                container.createEl('p', { text: '❌ 未找到项目，请先创建新项目', cls: 'nw-ue-error' });
                return;
            }
            projects.forEach((p) => {
                const opt = projectSelect.createEl('option', { value: p, text: p });
                if (p === this._currentProject) {
                    opt.selected = true;
                }
            });
            if (!this._currentProject && projects.length > 0) {
                this._currentProject = projects[0];
            }
            projectSelect.onchange = () => {
                this._currentProject = projectSelect.value;
            };
        });

        const typeGrid = container.createDiv({ cls: 'nw-ue-type-grid' });

        const categories: { key: ModelCategory; label: string; icon: string; desc: string }[] = [
            { key: 'character', label: '人物', icon: '👤', desc: '角色、NPC、反派等' },
            { key: 'faction', label: '势力', icon: '🏰', desc: '宗门、家族、组织等' },
            { key: 'location', label: '地点', icon: '📍', desc: '城市、秘境、遗迹等' },
            { key: 'item', label: '物品功法', icon: '⚔️', desc: '法宝、丹药、功法等' },
        ];

        for (const cat of categories) {
            const card = typeGrid.createEl('button', { cls: 'nw-ue-type-card' });
            card.toggleClass('nw-is-selected', this._selectedCategory === cat.key);

            card.onclick = () => {
                this._selectedCategory = cat.key;
                this._updateAllTypeCards(categories);
            };

            card.createEl('div', { text: cat.icon, cls: 'nw-ue-type-icon' });
            card.createEl('div', { text: cat.label, cls: 'nw-ue-type-name' });
            card.createEl('div', { text: cat.desc, cls: 'nw-ue-muted-sm' });

            (card as CategoryCardElement)._catKey = cat.key;
        }

        const btnRow = container.createDiv({ cls: 'nw-ue-row-end' });

        const cancelBtn = btnRow.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-gen-modal-cancel-btn',
        });
        cancelBtn.onclick = () => this.close();

        const nextBtn = btnRow.createEl('button', {
            text: '下一步 →',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button nw-gen-modal-confirm-btn',
        });
        nextBtn.onclick = () => {
            if (!this._currentProject) {
                new Notice('⚠️ 请先选择项目', 3000);
                return;
            }
            this._goToStep('basic-info');
        };
    }

    private _updateAllTypeCards(categories: { key: ModelCategory }[]): void {
        const grid = this._contentAreaEl.querySelector('.nw-ue-type-grid');
        if (!grid) return;
        grid.querySelectorAll('button').forEach((card) => {
            const key = (card as CategoryCardElement)._catKey;
            card.toggleClass('nw-is-selected', key === this._selectedCategory);
        });
    }

    private _renderBasicInfoStep(): void {
        const container = this._contentAreaEl;
        const config = this.categoryConfig[this._selectedCategory];

        container.createEl('h2', {
            text: `${config.icon} ${config.label} — 基本信息`,
            cls: 'nw-ue-heading',
        });

        const projectInfo = container.createDiv({ cls: 'nw-ue-project-info' });
        projectInfo.createSpan({
            text: `📁 项目：${this._currentProject}`,
            cls: 'nw-ue-muted',
        });

        const nameLabel = container.createEl('label', {
            text: `${config.label}名称（逗号分隔，留空由 AI 自动命名）：`,
            cls: 'nw-ue-label',
        });
        const nameInput = container.createEl('input', {
            type: 'text',
            placeholder: config.namePlaceholder,
            cls: 'nw-input novel-writer-input',
        });
        nameInput.addClass('nw-ue-input');
        nameInput.value = this._entityNames;
        nameInput.oninput = () => {
            this._entityNames = nameInput.value;
        };

        const descLabel = container.createEl('label', {
            text: '✍️ 提示词（描述你想要的特点，AI 将据此生成）：',
            cls: 'nw-ue-label',
        });
        const descInput = container.createEl('textarea', {
            placeholder: config.promptPlaceholder,
            cls: 'nw-textarea novel-writer-textarea',
        });
        descInput.addClass('nw-ue-textarea');
        descInput.value = this._description;
        descInput.oninput = () => {
            this._description = descInput.value;
        };

        const btnRow = container.createDiv({ cls: 'nw-ue-row-between' });

        const leftBtns = btnRow.createDiv({ cls: 'nw-ue-row' });
        const prevBtn = leftBtns.createEl('button', {
            text: '← 上一步',
            cls: 'nw-btn nw-gen-modal-cancel-btn',
        });
        prevBtn.onclick = () => this._goToStep('type-select');

        const rightBtns = btnRow.createDiv({ cls: 'nw-ue-row' });
        const cancelBtn = rightBtns.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-gen-modal-cancel-btn',
        });
        cancelBtn.onclick = () => this.close();

        const nextBtn = rightBtns.createEl('button', {
            text: '下一步 →',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button nw-gen-modal-confirm-btn',
        });
        nextBtn.onclick = () => this._goToStep('params');
    }

    private _renderParamsStep(): void {
        const container = this._contentAreaEl;
        const config = this.categoryConfig[this._selectedCategory];

        container.createEl('h2', {
            text: `${config.icon} ${config.label} — 生成参数`,
            cls: 'nw-ue-heading',
        });

        const countRow = container.createDiv({ cls: 'nw-ue-count-row' });
        countRow.createEl('label', { text: '生成数量：', cls: 'nw-ue-count-label' });
        const countInput = countRow.createEl('input', {
            type: 'number',
            value: String(this._count),
            attr: { min: '1', max: '20' },
            cls: 'nw-input novel-writer-input',
        });
        countInput.addClass('nw-ue-count-input');
        countInput.oninput = () => {
            const val = parseInt(countInput.value, 10);
            if (!isNaN(val) && val >= 1 && val <= 20) {
                this._count = val;
            }
        };

        const rawNames = this._entityNames.trim();
        const nameList = rawNames
            ? rawNames.split(/[,，]/).map((n) => n.trim()).filter(Boolean)
            : [];
        if (nameList.length > 0) {
            countInput.disabled = true;
            this._count = nameList.length;
            countInput.value = String(nameList.length);
            countRow.createEl('span', {
                text: `（已指定 ${nameList.length} 个名称）`,
                cls: 'nw-ue-muted-sm',
            });
        }

        const summary = container.createDiv({ cls: 'nw-ue-summary' });
        summary.createEl('div', { text: '📋 生成摘要', cls: 'nw-ue-summary-title' });
        const summaryGrid = summary.createDiv({ cls: 'nw-ue-summary-grid' });
        summaryGrid.createSpan({ text: '实体类型：', cls: 'nw-ue-muted' });
        summaryGrid.createSpan({ text: `${config.icon} ${config.label}` });
        summaryGrid.createSpan({ text: '生成数量：', cls: 'nw-ue-muted' });
        summaryGrid.createSpan({ text: `${this._count} 个` });
        if (nameList.length > 0) {
            summaryGrid.createSpan({ text: '指定名称：', cls: 'nw-ue-muted' });
            summaryGrid.createSpan({ text: nameList.join('、') });
        }
        if (this._description.trim()) {
            summaryGrid.createSpan({ text: '提示词：', cls: 'nw-ue-muted' });
            summaryGrid.createSpan({
                text: this._description.length > 50
                    ? this._description.substring(0, 50) + '...'
                    : this._description,
            });
        }

        const btnRow = container.createDiv({ cls: 'nw-ue-row-between' });

        const leftBtns = btnRow.createDiv({ cls: 'nw-ue-row' });
        const prevBtn = leftBtns.createEl('button', {
            text: '← 上一步',
            cls: 'nw-btn nw-gen-modal-cancel-btn',
        });
        prevBtn.onclick = () => this._goToStep('basic-info');

        const rightBtns = btnRow.createDiv({ cls: 'nw-ue-row' });
        const cancelBtn = rightBtns.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-gen-modal-cancel-btn',
        });
        cancelBtn.onclick = () => this.close();

        const generateBtn = rightBtns.createEl('button', {
            text: '🚀 开始生成',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button nw-gen-modal-confirm-btn',
        });
        generateBtn.onclick = () => this._startGeneration();
    }

    private async _startGeneration(): Promise<void> {
        if (this._generating) return;
        this._generating = true;

        const config = this.categoryConfig[this._selectedCategory];
        showProgress(`正在生成${config.label}...`);

        this._abortController = new AbortController();

        try {
            const worldviewPath = pjWorldview(this._currentProject);
            const settingLibPath = pjSettingLib(this._currentProject);

            let worldview = '';
            let settingLib = '';

            try {
                const wvFile = this.app.vault.getAbstractFileByPath(worldviewPath);
                if (wvFile instanceof TFile) {
                    worldview = await this.app.vault.read(wvFile);
                }
            } catch (e) {
                log.warn('读取世界观失败:', e);
            }

            try {
                const slFile = this.app.vault.getAbstractFileByPath(settingLibPath);
                if (slFile instanceof TFile) {
                    settingLib = await this.app.vault.read(slFile);
                }
            } catch (e) {
                log.warn('读取设定库失败:', e);
            }

            const rawNames = this._entityNames.trim();
            const nameList = rawNames
                ? rawNames.split(/[,，]/).map((n) => n.trim()).filter(Boolean)
                : [];

            let results: BatchEntityResult[] = [];

            // 同人项目：原作核心设定与创作规则必须进入实体生成要求，否则人物/势力/地点会脱离原作体系
            const fanficBlock = await readFanficPromptBlockWithNotice(this.app, this._currentProject);
            const description = mergeFanficRequirement(fanficBlock, this._description);

            switch (this._selectedCategory) {
                case 'character':
                    const charRes = await this.aiEngine.generateCharacters(
                        worldview,
                        this._count,
                        description || undefined,
                        undefined,
                        false,
                        nameList.length > 0 ? nameList : undefined,
                        settingLib || undefined,
                        this._abortController.signal,
                    );
                    if (charRes.content) {
                        results = this._parseCharacterResults(charRes.content);
                    }
                    break;

                case 'faction':
                    results = await this.aiEngine.generateFactionsBatch(
                        worldview,
                        nameList,
                        description,
                        this._count,
                        undefined,
                        settingLib || undefined,
                    );
                    break;

                case 'location':
                    results = await this.aiEngine.generateLocationsBatch(
                        worldview,
                        nameList,
                        description,
                        this._count,
                        undefined,
                        settingLib || undefined,
                    );
                    break;

                case 'item':
                    results = await this.aiEngine.generateItemsBatch(
                        worldview,
                        nameList,
                        description,
                        this._count,
                        undefined,
                        undefined,
                        settingLib || undefined,
                    );
                    break;
            }

            this._pendingResults = results.map((r) => ({
                entity: r,
                deleted: false,
                modified: false,
                validated: false,
            }));

            hideProgress();
            this._generating = false;
            this._goToStep('preview');
        } catch (e) {
            hideProgress();
            this._generating = false;
            if ((e as { name?: string }).name === 'AbortError') {
                new Notice('⚠️ 生成已取消', 3000);
            } else {
                showError(`生成失败：${(e as { message?: string }).message || e}`);
                log.error('[统一生成] 生成失败:', e);
            }
        }
    }

    private _parseCharacterResults(content: string): BatchEntityResult[] {
        const results: BatchEntityResult[] = [];
        const sections = content.split(/(?=^# |^## )/m).filter((s) => s.trim());

        for (const section of sections) {
            const nameMatch = section.match(/^#{1,2}\s+(.+?)\s*$/m);
            if (nameMatch) {
                const name = nameMatch[1].trim();
                if (name && !name.includes('模板') && !name.includes('说明')) {
                    results.push({ name, content: section.trim() });
                }
            }
        }

        if (results.length === 0 && content.trim()) {
            results.push({ name: '人物1', content: content.trim() });
        }

        return results;
    }

    private _renderPreviewStep(): void {
        const container = this._contentAreaEl;
        const config = this.categoryConfig[this._selectedCategory];

        container.createEl('h2', {
            text: `${config.icon} 预览 — ${this._pendingResults.length} 个${config.label}`,
            cls: 'nw-ue-heading',
        });

        if (this._pendingResults.length === 0) {
            container.createEl('p', { text: '❌ 没有生成结果', cls: 'nw-ue-error-block' });
            return;
        }

        const listEl = container.createDiv({ cls: 'nw-ue-result-list' });

        this._pendingResults.forEach((item, idx) => {
            if (item.deleted) return;

            const card = listEl.createDiv({ cls: 'nw-ue-result-card' });
            const titleRow = card.createDiv({ cls: 'nw-ue-result-title' });

            titleRow.createEl('span', {
                text: `${idx + 1}. ${item.entity.name}`,
                cls: 'nw-ue-result-name',
            });

            const btns = titleRow.createDiv({ cls: 'nw-ue-result-btns' });
            const editBtn = btns.createEl('button', { text: '✏️ 编辑', cls: 'nw-ue-result-btn' });
            const delBtn = btns.createEl('button', {
                text: '🗑️ 删除',
                cls: 'nw-ue-result-btn nw-ue-result-btn-danger',
            });

            const previewEl = card.createDiv({ cls: 'nw-ue-result-preview' });

            const cleanContent = item.entity.content
                .replace(/^---[\s\S]*?---\s*/, '')
                .replace(/#{1,6}\s+/g, '')
                .replace(/\*\*/g, '')
                .replace(/\n+/g, ' ')
                .trim();
            previewEl.setText(
                cleanContent.length > 150
                    ? cleanContent.substring(0, 150) + '...'
                    : cleanContent,
            );

            delBtn.onclick = () => {
                item.deleted = true;
                this._renderCurrentStep();
            };

            editBtn.onclick = () => {
                this._editEntityInline(item, card);
            };
        });

        const remaining = this._pendingResults.filter((r) => !r.deleted).length;
        const countInfo = container.createDiv({ cls: 'nw-ue-count-info' });
        countInfo.setText(`共 ${this._pendingResults.length} 个，将保存 ${remaining} 个`);

        const btnRow = container.createDiv({ cls: 'nw-ue-row-between' });

        const leftBtns = btnRow.createDiv({ cls: 'nw-ue-row' });
        const prevBtn = leftBtns.createEl('button', {
            text: '← 重新生成',
            cls: 'nw-btn nw-gen-modal-cancel-btn',
        });
        prevBtn.onclick = () => this._goToStep('params');

        const rightBtns = btnRow.createDiv({ cls: 'nw-ue-row' });
        const cancelBtn = rightBtns.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-gen-modal-cancel-btn',
        });
        cancelBtn.onclick = () => this.close();

        const saveBtn = rightBtns.createEl('button', {
            text: '💾 确认保存',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button nw-gen-modal-confirm-btn',
        });
        saveBtn.onclick = () => this._saveResults();
    }

    private _editEntityInline(item: ManagedEntity, cardEl: HTMLElement): void {
        cardEl.empty();

        const titleRow = cardEl.createDiv({ cls: 'nw-ue-edit-title' });
        titleRow.createEl('label', { text: '名称：', cls: 'nw-ue-edit-label' });
        const nameInput = titleRow.createEl('input', {
            type: 'text',
            value: item.entity.name,
            cls: 'nw-input novel-writer-input',
        });
        nameInput.addClass('nw-ue-edit-name');

        cardEl.createEl('label', { text: '内容：', cls: 'nw-ue-edit-label' });
        const contentInput = cardEl.createEl('textarea', {
            value: item.entity.content,
            cls: 'nw-textarea novel-writer-textarea',
        });
        contentInput.addClass('nw-ue-edit-content');

        const btnRow = cardEl.createDiv({ cls: 'nw-ue-edit-actions' });
        const cancelBtn = btnRow.createEl('button', { text: '取消', cls: 'nw-ue-edit-cancel' });
        cancelBtn.onclick = () => this._renderCurrentStep();

        const saveBtn = btnRow.createEl('button', {
            text: '保存修改',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        });
        saveBtn.addClass('nw-ue-edit-save');
        saveBtn.onclick = () => {
            item.entity.name = nameInput.value.trim() || item.entity.name;
            item.entity.content = contentInput.value;
            item.modified = true;
            this._renderCurrentStep();
        };
    }

    private async _saveResults(): Promise<void> {
        const config = this.categoryConfig[this._selectedCategory];
        const toSave = this._pendingResults.filter((r) => !r.deleted);

        if (toSave.length === 0) {
            new Notice('⚠️ 没有要保存的实体', 3000);
            return;
        }

        showProgress(`正在保存 ${toSave.length} 个${config.label}...`);

        try {
            const dirPath = `${this._currentProject}/${config.subdir}`;
            await mkdirp(this.app, dirPath);

            const kindByCategory: Record<ModelCategory, EntityKind> = {
                character: 'characters',
                faction: 'factions',
                location: 'locations',
                item: 'items',
            };
            const kind = kindByCategory[this._selectedCategory];

            // 保存前完整性闭环：校验 → AI 补全一次 → 复检；不完整的不落盘
            let worldview = '';
            try {
                const wvFile = this.app.vault.getAbstractFileByPath(pjWorldview(this._currentProject));
                if (wvFile instanceof TFile) worldview = await this.app.vault.read(wvFile);
            } catch { /* silent-ok: 世界观缺失时补全仍可进行 */ }

            const ready: Array<{ name: string; content: string }> = [];
            const integrityFailures: string[] = [];
            for (let i = 0; i < toSave.length; i++) {
                const item = toSave[i];
                showProgress(`正在校验/补全 ${i + 1}/${toSave.length} 个${config.label}...`);
                const result = await ensureEntityIntegrity(
                    kind,
                    item.entity.name,
                    item.entity.content,
                    (req) => this.plugin.aiEngine.repairEntity(kind, req.name, req.content, req.missingFields, worldview)
                );
                if (!result.valid) {
                    integrityFailures.push(
                        `${item.entity.name}（缺少：${result.missingFields.slice(0, 4).join('、')}${result.missingFields.length > 4 ? ' 等' : ''}）`
                    );
                    continue;
                }
                item.entity.content = result.content;
                ready.push({ name: item.entity.name, content: result.content });
            }

            if (ready.length === 0) {
                hideProgress();
                showError(`❌ 全部 ${config.label} 未通过完整性校验，未保存：\n${integrityFailures.slice(0, 5).join('\n')}`);
                return;
            }

            const outcome = await saveEntities(
                this.app,
                this._currentProject,
                kind,
                ready
            );

            hideProgress();
            if (integrityFailures.length > 0) {
                outcome.failed.push(...integrityFailures.map(text => ({
                    name: text.split('（')[0],
                    error: `完整性校验未通过：${text}`,
                })));
            }
            showSuccess(`✅ ${formatSaveOutcome(outcome, kind)}`);
            this._goToStep('confirm');
        } catch (e) {
            hideProgress();
            showError(`保存失败：${(e as { message?: string }).message || e}`);
        }
    }

    private _renderConfirmStep(): void {
        const container = this._contentAreaEl;
        const config = this.categoryConfig[this._selectedCategory];
        const saved = this._pendingResults.filter((r) => !r.deleted);

        container.createEl('h2', { text: '🎉 生成完成！', cls: 'nw-ue-heading-lg' });

        const resultBox = container.createDiv({ cls: 'nw-ue-confirm-box' });
        resultBox.createEl('div', { text: config.icon, cls: 'nw-ue-confirm-icon' });
        resultBox.createEl('div', {
            text: `成功生成 ${saved.length} 个${config.label}`,
            cls: 'nw-ue-confirm-title',
        });
        resultBox.createEl('div', {
            text: `已保存到：${this._currentProject}/${config.subdir}`,
            cls: 'nw-ue-confirm-desc',
        });

        const btnRow = container.createDiv({ cls: 'nw-ue-row-center' });

        const manageBtn = btnRow.createEl('button', {
            text: '📚 打开实体管理',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        });
        manageBtn.onclick = () => {
            this.close();
            this.plugin.openEntityManagerModal(this._currentProject);
        };

        const fileMgrBtn = btnRow.createEl('button', {
            text: '📂 管理文件',
            cls: 'nw-btn',
        });
        fileMgrBtn.addClass('nw-ue-file-btn');
        fileMgrBtn.onclick = () => {
            this.close();
            new ExistingEntityManagerModal(
                this.app,
                this.plugin,
                this._currentProject,
                config.subdir,
                `${config.icon} ${config.label}`,
            ).open();
        };

        const closeBtn = btnRow.createEl('button', {
            text: '关闭',
            cls: 'nw-btn nw-gen-modal-cancel-btn',
        });
        closeBtn.onclick = () => this.close();
    }
}
