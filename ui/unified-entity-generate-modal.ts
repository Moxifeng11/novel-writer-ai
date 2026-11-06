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
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
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

        this._stepIndicatorEl = contentEl.createDiv({
            attr: {
                style:
                    'display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:16px; padding:10px 0; border-bottom:1px solid var(--background-modifier-border);',
            },
        });

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
            const stepItem = this._stepIndicatorEl.createDiv({
                attr: {
                    style:
                        'display:flex; flex-direction:column; align-items:center; gap:4px; flex:1; min-width:0;',
                },
            });

            const circle = stepItem.createEl('div', {
                text: String(step.num),
                attr: {
                    style:
                        'width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:var(--nw-font-size-sm, 12px); font-weight:600; flex-shrink:0;',
                },
            });

            const label = stepItem.createEl('span', {
                text: step.label,
                attr: {
                    style:
                        'font-size:var(--nw-font-size-xs, 11px); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;',
                },
            });

            if (i < currentIdx) {
                circle.style.background = 'var(--text-accent)';
                circle.style.color = 'white';
                label.style.color = 'var(--text-muted)';
            } else if (i === currentIdx) {
                circle.style.background = 'var(--text-accent)';
                circle.style.color = 'white';
                label.style.color = 'var(--text-accent)';
                label.style.fontWeight = '600';
            } else {
                circle.style.background = 'var(--background-secondary)';
                circle.style.color = 'var(--text-muted)';
                label.style.color = 'var(--text-muted)';
            }

            if (i < steps.length - 1) {
                const line = this._stepIndicatorEl.createDiv({
                    attr: {
                        style:
                            'flex:1; height:2px; background:var(--background-modifier-border); margin:0 4px; margin-bottom:20px;',
                    },
                });
                if (i < currentIdx) {
                    line.style.background = 'var(--text-accent)';
                }
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

        container.createEl('h2', {
            text: '✨ 选择实体类型',
            attr: { style: 'margin:0 0 16px 0; font-size:20px;' },
        });

        const projectRow = container.createDiv({
            attr: { style: 'margin-bottom:20px;' },
        });
        projectRow.createEl('label', {
            text: '选择项目：',
            attr: { style: 'display:block; margin-bottom:6px; font-weight:500;' },
        });
        const projectSelect = projectRow.createEl('select', {
            cls: 'nw-select novel-writer-select',
        });
        projectSelect.style.width = '100%';

        this.contextManager.detectProjects().then((projects) => {
            if (projects.length === 0) {
                container.createEl('p', {
                    text: '❌ 未找到项目，请先创建新项目',
                    attr: { style: 'color:var(--text-error);' },
                });
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

        const typeGrid = container.createDiv({
            attr: {
                style:
                    'display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-bottom:20px;',
            },
        });

        const categories: { key: ModelCategory; label: string; icon: string; desc: string }[] = [
            { key: 'character', label: '人物', icon: '👤', desc: '角色、NPC、反派等' },
            { key: 'faction', label: '势力', icon: '🏰', desc: '宗门、家族、组织等' },
            { key: 'location', label: '地点', icon: '📍', desc: '城市、秘境、遗迹等' },
            { key: 'item', label: '物品功法', icon: '⚔️', desc: '法宝、丹药、功法等' },
        ];

        for (const cat of categories) {
            const card = typeGrid.createEl('button', {
                attr: {
                    style:
                        'padding:20px; border-radius:10px; cursor:pointer; text-align:left; border:2px solid var(--background-modifier-border); background:var(--background-primary); transition:all 0.2s;',
                },
            });

            const updateCardStyle = () => {
                if (this._selectedCategory === cat.key) {
                    card.style.borderColor = 'var(--text-accent)';
                    card.style.background = 'var(--background-primary-alt)';
                    card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                } else {
                    card.style.borderColor = 'var(--background-modifier-border)';
                    card.style.background = 'var(--background-primary)';
                    card.style.boxShadow = 'none';
                }
            };
            updateCardStyle();

            card.onmouseenter = () => {
                if (this._selectedCategory !== cat.key) {
                    card.style.borderColor = 'var(--background-modifier-hover)';
                }
            };
            card.onmouseleave = () => {
                updateCardStyle();
            };

            card.onclick = () => {
                this._selectedCategory = cat.key;
                typeGrid.querySelectorAll('button').forEach(() => { });
                this._updateAllTypeCards(categories);
            };

            const iconEl = card.createEl('div', {
                text: cat.icon,
                attr: { style: 'font-size:32px; margin-bottom:8px;' },
            });
            const nameEl = card.createEl('div', {
                text: cat.label,
                attr: { style: 'font-weight:600; font-size:1.1em; margin-bottom:4px;' },
            });
            const descEl = card.createEl('div', {
                text: cat.desc,
                attr: { style: 'font-size:var(--nw-font-size-sm, 12px); color:var(--text-muted);' },
            });

            (card as CategoryCardElement)._catKey = cat.key;
        }

        const btnRow = container.createDiv({
            attr: { style: 'display:flex; justify-content:flex-end; gap:10px;' },
        });

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
        const grid = this._contentAreaEl.querySelector(
            'div[style*="grid-template-columns:repeat(auto-fit"]',
        );
        if (!grid) return;
        const cards = grid.querySelectorAll('button');
        cards.forEach((card) => {
            const key = (card as CategoryCardElement)._catKey;
            if (key === this._selectedCategory) {
                (card as HTMLElement).style.borderColor = 'var(--text-accent)';
                (card as HTMLElement).style.background = 'var(--background-primary-alt)';
                (card as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
            } else {
                (card as HTMLElement).style.borderColor = 'var(--background-modifier-border)';
                (card as HTMLElement).style.background = 'var(--background-primary)';
                (card as HTMLElement).style.boxShadow = 'none';
            }
        });
    }

    private _renderBasicInfoStep(): void {
        const container = this._contentAreaEl;
        const config = this.categoryConfig[this._selectedCategory];

        container.createEl('h2', {
            text: `${config.icon} ${config.label} — 基本信息`,
            attr: { style: 'margin:0 0 16px 0; font-size:20px;' },
        });

        const projectInfo = container.createDiv({
            attr: {
                style:
                    'padding:8px 12px; background:var(--background-secondary); border-radius:6px; margin-bottom:16px; font-size:var(--nw-font-size-base, 13px);',
            },
        });
        projectInfo.createSpan({
            text: `📁 项目：${this._currentProject}`,
            attr: { style: 'color:var(--text-muted);' },
        });

        const nameLabel = container.createEl('label', {
            text: `${config.label}名称（逗号分隔，留空由 AI 自动命名）：`,
            attr: { style: 'display:block; margin-bottom:6px; font-weight:500;' },
        });
        const nameInput = container.createEl('input', {
            type: 'text',
            placeholder: config.namePlaceholder,
            cls: 'nw-input novel-writer-input',
        });
        nameInput.style.width = '100%';
        nameInput.style.marginBottom = '16px';
        nameInput.value = this._entityNames;
        nameInput.oninput = () => {
            this._entityNames = nameInput.value;
        };

        const descLabel = container.createEl('label', {
            text: '✍️ 提示词（描述你想要的特点，AI 将据此生成）：',
            attr: { style: 'display:block; margin-bottom:6px; font-weight:500;' },
        });
        const descInput = container.createEl('textarea', {
            placeholder: config.promptPlaceholder,
            cls: 'nw-textarea novel-writer-textarea',
        });
        descInput.style.width = '100%';
        descInput.style.minHeight = '160px';
        descInput.style.marginBottom = '16px';
        descInput.value = this._description;
        descInput.oninput = () => {
            this._description = descInput.value;
        };

        const btnRow = container.createDiv({
            attr: { style: 'display:flex; justify-content:space-between; gap:10px;' },
        });

        const leftBtns = btnRow.createDiv({ attr: { style: 'display:flex; gap:10px;' } });
        const prevBtn = leftBtns.createEl('button', {
            text: '← 上一步',
            cls: 'nw-btn nw-gen-modal-cancel-btn',
        });
        prevBtn.onclick = () => this._goToStep('type-select');

        const rightBtns = btnRow.createDiv({ attr: { style: 'display:flex; gap:10px;' } });
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
            attr: { style: 'margin:0 0 16px 0; font-size:20px;' },
        });

        const countRow = container.createDiv({
            attr: {
                style: 'display:flex; align-items:center; gap:12px; margin-bottom:16px;',
            },
        });
        countRow.createEl('label', {
            text: '生成数量：',
            attr: { style: 'font-weight:500; min-width:80px;' },
        });
        const countInput = countRow.createEl('input', {
            type: 'number',
            value: String(this._count),
            attr: { min: '1', max: '20' },
            cls: 'nw-input novel-writer-input',
        });
        countInput.style.width = '100px';
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
            const hint = countRow.createEl('span', {
                text: `（已指定 ${nameList.length} 个名称）`,
                attr: { style: 'color:var(--text-muted); font-size:var(--nw-font-size-sm, 12px);' },
            });
        }

        const summary = container.createDiv({
            attr: {
                style:
                    'padding:12px; background:var(--background-secondary); border-radius:8px; margin-bottom:20px;',
            },
        });
        summary.createEl('div', {
            text: '📋 生成摘要',
            attr: { style: 'font-weight:600; margin-bottom:8px;' },
        });
        const summaryGrid = summary.createDiv({
            attr: {
                style:
                    'display:grid; grid-template-columns:auto 1fr; gap:4px 12px; font-size:var(--nw-font-size-base, 13px);',
            },
        });
        summaryGrid.createSpan({
            text: '实体类型：',
            attr: { style: 'color:var(--text-muted);' },
        });
        summaryGrid.createSpan({ text: `${config.icon} ${config.label}` });
        summaryGrid.createSpan({
            text: '生成数量：',
            attr: { style: 'color:var(--text-muted);' },
        });
        summaryGrid.createSpan({ text: `${this._count} 个` });
        if (nameList.length > 0) {
            summaryGrid.createSpan({
                text: '指定名称：',
                attr: { style: 'color:var(--text-muted);' },
            });
            summaryGrid.createSpan({ text: nameList.join('、') });
        }
        if (this._description.trim()) {
            summaryGrid.createSpan({
                text: '提示词：',
                attr: { style: 'color:var(--text-muted);' },
            });
            const descPreview = summaryGrid.createSpan({
                text: this._description.length > 50
                    ? this._description.substring(0, 50) + '...'
                    : this._description,
            });
        }

        const btnRow = container.createDiv({
            attr: { style: 'display:flex; justify-content:space-between; gap:10px;' },
        });

        const leftBtns = btnRow.createDiv({ attr: { style: 'display:flex; gap:10px;' } });
        const prevBtn = leftBtns.createEl('button', {
            text: '← 上一步',
            cls: 'nw-btn nw-gen-modal-cancel-btn',
        });
        prevBtn.onclick = () => this._goToStep('basic-info');

        const rightBtns = btnRow.createDiv({ attr: { style: 'display:flex; gap:10px;' } });
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
            attr: { style: 'margin:0 0 16px 0; font-size:20px;' },
        });

        if (this._pendingResults.length === 0) {
            container.createEl('p', {
                text: '❌ 没有生成结果',
                attr: { style: 'color:var(--text-error); text-align:center; padding:40px;' },
            });
            return;
        }

        const listEl = container.createDiv({
            attr: {
                style:
                    'max-height:400px; overflow-y:auto; border:1px solid var(--background-modifier-border); border-radius:8px; margin-bottom:16px;',
            },
        });

        this._pendingResults.forEach((item, idx) => {
            if (item.deleted) return;

            const card = listEl.createDiv({
                attr: {
                    style:
                        'padding:12px; border-bottom:1px solid var(--background-modifier-border);',
                },
            });

            const titleRow = card.createDiv({
                attr: {
                    style:
                        'display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px;',
                },
            });

            const nameEl = titleRow.createEl('span', {
                text: `${idx + 1}. ${item.entity.name}`,
                attr: { style: 'font-weight:600;' },
            });

            const btns = titleRow.createDiv({
                attr: { style: 'display:flex; gap:6px;' },
            });

            const editBtn = btns.createEl('button', {
                text: '✏️ 编辑',
                attr: {
                    style:
                        'font-size:var(--nw-font-size-sm, 12px); padding:3px 10px; border-radius:4px; cursor:pointer; border:1px solid var(--background-modifier-border); background:var(--background-secondary);',
                },
            });

            const delBtn = btns.createEl('button', {
                text: '🗑️ 删除',
                attr: {
                    style:
                        'font-size:var(--nw-font-size-sm, 12px); padding:3px 10px; border-radius:4px; cursor:pointer; border:1px solid var(--background-modifier-border); background:var(--background-secondary); color:var(--text-error);',
                },
            });

            const previewEl = card.createDiv({
                attr: {
                    style:
                        'font-size:var(--nw-font-size-sm, 12px); color:var(--text-muted); max-height:60px; overflow:hidden; line-height:1.4;',
                },
            });

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
        const countInfo = container.createDiv({
            attr: {
                style:
                    'text-align:right; color:var(--text-muted); font-size:var(--nw-font-size-sm, 12px); margin-bottom:12px;',
            },
        });
        countInfo.setText(`共 ${this._pendingResults.length} 个，将保存 ${remaining} 个`);

        const btnRow = container.createDiv({
            attr: { style: 'display:flex; justify-content:space-between; gap:10px;' },
        });

        const leftBtns = btnRow.createDiv({ attr: { style: 'display:flex; gap:10px;' } });
        const prevBtn = leftBtns.createEl('button', {
            text: '← 重新生成',
            cls: 'nw-btn nw-gen-modal-cancel-btn',
        });
        prevBtn.onclick = () => this._goToStep('params');

        const rightBtns = btnRow.createDiv({ attr: { style: 'display:flex; gap:10px;' } });
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

        const titleRow = cardEl.createDiv({
            attr: { style: 'margin-bottom:8px;' },
        });
        const nameLabel = titleRow.createEl('label', {
            text: '名称：',
            attr: { style: 'display:block; font-size:var(--nw-font-size-sm, 12px); margin-bottom:4px;' },
        });
        const nameInput = titleRow.createEl('input', {
            type: 'text',
            value: item.entity.name,
            cls: 'nw-input novel-writer-input',
        });
        nameInput.style.width = '100%';
        nameInput.style.fontSize = '0.9em';

        const contentLabel = cardEl.createEl('label', {
            text: '内容：',
            attr: { style: 'display:block; font-size:var(--nw-font-size-sm, 12px); margin-bottom:4px;' },
        });
        const contentInput = cardEl.createEl('textarea', {
            value: item.entity.content,
            cls: 'nw-textarea novel-writer-textarea',
        });
        contentInput.style.width = '100%';
        contentInput.style.minHeight = '200px';
        contentInput.style.fontSize = '0.85em';

        const btnRow = cardEl.createDiv({
            attr: { style: 'display:flex; justify-content:flex-end; gap:8px; margin-top:8px;' },
        });

        const cancelBtn = btnRow.createEl('button', {
            text: '取消',
            attr: {
                style:
                    'font-size:var(--nw-font-size-sm, 12px); padding:4px 12px; border-radius:4px; cursor:pointer; border:1px solid var(--background-modifier-border); background:var(--background-secondary);',
            },
        });
        cancelBtn.onclick = () => this._renderCurrentStep();

        const saveBtn = btnRow.createEl('button', {
            text: '保存修改',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        });
        saveBtn.style.fontSize = '0.8em';
        saveBtn.style.padding = '4px 12px';
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

        container.createEl('h2', {
            text: '🎉 生成完成！',
            attr: { style: 'margin:0 0 16px 0; font-size:24px; text-align:center;' },
        });

        const resultBox = container.createDiv({
            attr: {
                style:
                    'padding:24px; background:var(--background-secondary); border-radius:12px; text-align:center; margin-bottom:20px;',
            },
        });
        resultBox.createEl('div', {
            text: config.icon,
            attr: { style: 'font-size:48px; margin-bottom:12px;' },
        });
        resultBox.createEl('div', {
            text: `成功生成 ${saved.length} 个${config.label}`,
            attr: { style: 'font-size:1.2em; font-weight:600; margin-bottom:8px;' },
        });
        resultBox.createEl('div', {
            text: `已保存到：${this._currentProject}/${config.subdir}`,
            attr: { style: 'font-size:var(--nw-font-size-base, 13px); color:var(--text-muted);' },
        });

        const btnRow = container.createDiv({
            attr: { style: 'display:flex; justify-content:center; gap:12px; flex-wrap:wrap;' },
        });

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
        fileMgrBtn.style.cssText =
            'border:1px solid var(--background-modifier-border); background:var(--background-secondary);';
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
