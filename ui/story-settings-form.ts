/**
 * story-settings-form.ts — 长篇小说「故事创作设置」编辑组件
 *
 * 创建项目弹窗与向导编辑弹窗共用：五套结构模板、九组配置、组合校验与真随机。
 */
import {
    STORY_OPTION_GROUPS,
    STORY_STRUCTURES,
    createDefaultStorySettings,
    generateRandomStorySettings,
    getStoryStructure,
    getStructureStageSummary,
    validateStorySettings,
    type LongStorySettings,
    type StoryOptionCategory,
} from '../shared/story-structure';

/**
 * StorySettingsEditorOptions 类型定义。
 */
export interface StorySettingsEditorOptions {
    getGenre?: () => string;
    onChange?: (settings: LongStorySettings) => void;
}

/**
 * StorySettingsEditor 类。
 */
export class StorySettingsEditor {
    private settings: LongStorySettings;
    private root: HTMLElement | null = null;
    private warningEl: HTMLElement | null = null;
    private seedEl: HTMLElement | null = null;
    private structureGrid: HTMLElement | null = null;
    private detailEl: HTMLElement | null = null;
    private lockStructure = false;
    private genreProvider: () => string;

    constructor(
        private readonly container: HTMLElement,
        initial?: Partial<LongStorySettings> | null,
        private readonly options: StorySettingsEditorOptions = {},
    ) {
        this.settings = { ...createDefaultStorySettings(initial?.structureId || 'qichengzhuanhe'), ...initial };
        if (!this.settings.structureId || !STORY_STRUCTURES.some(item => item.id === this.settings.structureId)) {
            this.settings.structureId = 'qichengzhuanhe';
        }
        this.genreProvider = options.getGenre || (() => '');
        this.render();
    }

    /**
     * 获取值。
      * @returns LongStorySettings 实例
     */
    getValue(): LongStorySettings {
        return { ...this.settings };
    }

    /**
     * 设置题材。
     * @param _genre - 题材
     */
    setGenre(_genre: string): void {
        this.refreshWarning();
    }

    /**
     * 设置设置列表。
     * @param next - 下一个
     */
    setSettings(next: Partial<LongStorySettings>): void {
        this.settings = { ...this.settings, ...next };
        this.render();
    }

    /**
     * randomize 方法。
     * @param lockStructure - 是否锁定结构
      * @returns LongStorySettings 实例
     */
    randomize(lockStructure = this.lockStructure): LongStorySettings {
        const generated = generateRandomStorySettings({
            genre: this.genreProvider(),
            structureId: lockStructure ? this.settings.structureId : undefined,
        });
        this.settings = generated;
        this.render();
        return this.getValue();
    }

    private render(): void {
        if (this.root) this.root.remove();
        const root = this.container.createDiv({ cls: 'nw-story-settings' });
        this.root = root;

        const head = root.createDiv({ cls: 'nw-story-settings-head' });
        const titleWrap = head.createDiv();
        titleWrap.createEl('div', { text: '故事结构', cls: 'nw-story-settings-title' });
        titleWrap.createEl('div', {
            text: '先选结构，再配置人物、冲突与力量体系；所有选项都会写入项目提示词。',
            cls: 'nw-story-settings-desc',
        });

        const randomWrap = head.createDiv({ cls: 'nw-story-random-wrap' });
        const lockLabel = randomWrap.createEl('label', { cls: 'nw-story-lock' });
        const lockInput = lockLabel.createEl('input', { type: 'checkbox' });
        lockInput.checked = this.lockStructure;
        lockInput.addEventListener('change', () => {
            this.lockStructure = lockInput.checked;
        });
        lockLabel.createSpan({ text: '锁定当前结构' });
        const randomBtn = randomWrap.createEl('button', {
            text: '🎲 智能随机',
            cls: 'nw-btn nw-btn-secondary nw-story-random-btn',
            attr: { type: 'button', title: '用 CSPRNG 生成一套自洽的结构与设定组合' },
        });
        randomBtn.addEventListener('click', () => this.randomize());

        const structureGrid = root.createDiv({ cls: 'nw-story-structure-grid' });
        this.structureGrid = structureGrid;
        for (const structure of STORY_STRUCTURES) {
            const card = structureGrid.createEl('button', {
                cls: 'nw-story-structure-card',
                attr: { type: 'button', title: structure.description },
            });
            card.dataset.structure = structure.id;
            card.createSpan({ text: structure.icon, cls: 'nw-story-structure-icon' });
            const info = card.createDiv({ cls: 'nw-story-structure-info' });
            info.createSpan({ text: structure.name, cls: 'nw-story-structure-name' });
            info.createSpan({ text: getStructureStageSummary(structure.id), cls: 'nw-story-structure-stages' });
            card.addEventListener('click', () => {
                this.settings.structureId = structure.id;
                this.refreshStructureCards();
                this.refreshDetail();
                this.refreshWarning();
                this.emitChange();
            });
        }
        this.refreshStructureCards();

        this.detailEl = root.createDiv({ cls: 'nw-story-active-detail' });
        this.refreshDetail();

        this.warningEl = root.createDiv({ cls: 'nw-story-warning' });

        const groups = root.createDiv({ cls: 'nw-story-groups' });
        for (const section of ['核心设定', '风格与节奏'] as const) {
            const column = groups.createDiv({ cls: 'nw-story-group-column' });
            column.createDiv({ text: section, cls: 'nw-story-section-title' });
            for (const group of STORY_OPTION_GROUPS.filter(item => item.section === section)) {
                this.renderGroup(column, group);
            }
        }

        const storyGroup = root.createDiv({ cls: 'nw-story-option-group' });
        const storyHead = storyGroup.createDiv({ cls: 'nw-story-option-head' });
        storyHead.createSpan({ text: '一句话故事', cls: 'nw-story-option-label' });
        storyHead.createSpan({ text: '随机生成后可直接用于简介/大纲；可手动修改', cls: 'nw-story-option-hint' });
        const storyInput = storyGroup.createEl('textarea', {
            cls: 'nw-textarea nw-story-oneline',
            attr: { rows: '3', placeholder: '例如：一个被逐出师门的落魄弟子，靠听见亡者低语追查师门灭门真相。' },
        });
        storyInput.value = this.settings.oneLineStory;
        storyInput.addEventListener('input', () => {
            this.settings.oneLineStory = storyInput.value;
            this.emitChange();
        });

        const footer = root.createDiv({ cls: 'nw-story-settings-footer' });
        this.seedEl = footer.createSpan({ cls: 'nw-story-seed' });
        this.refreshSeed();
        this.refreshWarning();
    }

    private renderGroup(container: HTMLElement, group: (typeof STORY_OPTION_GROUPS)[number]): void {
        const groupEl = container.createDiv({ cls: 'nw-story-option-group' });
        const groupHead = groupEl.createDiv({ cls: 'nw-story-option-head' });
        groupHead.createSpan({ text: group.label, cls: 'nw-story-option-label' });
        groupHead.createSpan({ text: group.hint, cls: 'nw-story-option-hint' });
        const chips = groupEl.createDiv({ cls: 'nw-story-option-chips' });
        for (const option of group.options) {
            const chip = chips.createEl('button', {
                text: option.label,
                cls: 'nw-story-option-chip',
                attr: { type: 'button', title: option.description || option.label },
            });
            chip.dataset.value = option.id;
            chip.addEventListener('click', () => {
                (this.settings[group.key] as string) = option.id;
                this.refreshChips(groupEl, group.key);
                this.refreshWarning();
                this.emitChange();
            });
        }
        this.refreshChips(groupEl, group.key);
    }

    private refreshDetail(): void {
        if (!this.detailEl) return;
        const structure = getStoryStructure(this.settings.structureId);
        this.detailEl.empty();
        this.detailEl.createDiv({ text: `${structure.icon} ${structure.name}`, cls: 'nw-story-detail-name' });
        this.detailEl.createDiv({ text: structure.description, cls: 'nw-story-detail-desc' });
        const stages = this.detailEl.createDiv({ cls: 'nw-story-stage-track' });
        for (const stage of structure.stages) {
            const item = stages.createDiv({
                cls: 'nw-story-stage',
                attr: { title: `${stage.purpose}；关键节点：${stage.beats.join('、')}` },
            });
            item.createSpan({ text: stage.name, cls: 'nw-story-stage-name' });
            item.createSpan({ text: `${stage.ratio}%`, cls: 'nw-story-stage-ratio' });
            item.style.setProperty('--nw-stage-ratio', String(stage.ratio));
        }
    }

    private refreshStructureCards(): void {
        if (!this.structureGrid) return;
        this.structureGrid.querySelectorAll<HTMLElement>('.nw-story-structure-card').forEach(card => {
            card.toggleClass('is-active', card.dataset.structure === this.settings.structureId);
        });
    }

    private refreshChips(groupEl: HTMLElement, key: StoryOptionCategory): void {
        const current = this.settings[key];
        groupEl.querySelectorAll<HTMLElement>('.nw-story-option-chip').forEach(chip => {
            chip.toggleClass('is-active', chip.dataset.value === current);
        });
    }

    private refreshWarning(): void {
        if (!this.warningEl) return;
        const issues = validateStorySettings(this.settings);
        this.warningEl.toggleClass('nw-story-warning-error', issues.length > 0);
        this.warningEl.toggleClass('nw-story-warning-ok', issues.length === 0);
        this.warningEl.setText(issues.length > 0
            ? `⚠️ 当前组合需要调整：${issues.join('；')}`
            : `✓ 当前组合自洽：${getStoryStructure(this.settings.structureId).name} · ${getStructureStageSummary(this.settings.structureId)}`);
    }

    private refreshSeed(): void {
        if (!this.seedEl) return;
        this.seedEl.setText(this.settings.randomSeed ? `随机种子：${this.settings.randomSeed}` : '随机种子：尚未使用随机组合');
    }

    private emitChange(): void {
        this.refreshSeed();
        this.options.onChange?.(this.getValue());
    }
}
