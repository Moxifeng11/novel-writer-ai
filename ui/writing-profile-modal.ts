import { App, Modal, Setting, Notice, DropdownComponent } from 'obsidian';
import { WritingProfile, WritingProfileManager, StyleConfig, RhythmConfig } from '../engine/writing-profile';
import { KnowledgeTagManager } from '../engine/knowledge-tags';
import { StyleFingerprintLibrary, StyleFingerprint } from '../engine/style-fingerprint-library';
import { ENGINE_NAMES, type EngineRegistry } from '../engine/engine-registry';
import { FingerprintIntensityModal } from './fingerprint-intensity-modal';
import { createLogger } from '../shared/logger';


const log = createLogger('WritingProfileModal');
const PRIMARY_GENRES = ['玄幻', '都市', '言情', '历史', '科幻', '悬疑', '武侠', '游戏', '其他'];

const SECONDARY_GENRES = [
    '东方玄幻', '异世大陆', '高武世界', '王朝争霸', '传统玄幻',
    '西方奇幻', '史诗奇幻', '都市奇幻',
    '传统武侠', '新派武侠', '国术武侠',
    '古典仙侠', '现代修真', '洪荒封神', '修仙',
    '都市生活', '都市异能', '都市重生', '商业大亨', '校园', '职场', '官场', '都市修仙', '神豪流', '赘婿流',
    '架空历史', '秦汉三国', '隋唐五代', '两宋元明', '历史传记', '清史民国',
    '军事战争', '谍战特工', '抗战烽火', '军旅生涯',
    '电子竞技', '游戏异界', '虚拟网游', '游戏竞技',
    '末世危机', '进化变异', '星际科幻', '古武机甲', '未来世界', '科幻末世',
    '诡秘悬疑', '侦探推理', '恐怖惊悚', '民间奇闻', '探险生存',
    '现代言情', '总裁豪门', '校园青春', '职场丽人', '婚恋情缘',
    '宫斗宅斗', '经商种田', '穿越奇情', '重生异能', '快意江湖', '古典架空',
    '仙侠奇缘', '玄幻言情', '异世传说', '星际恋歌', '科幻空间',
    '甜宠文', '虐文', '耽美言情', '百合言情',
];

const PRIMARY_STYLES = ['简洁', '华丽', '冷峻', '细腻', '热血', '幽默', '沉重', '轻松'];
const SECONDARY_STYLES = ['', '简洁', '华丽', '冷峻', '细腻', '热血', '幽默', '沉重', '轻松'];

const PERSPECTIVES = [
    { value: 'first_person', label: '第一人称' },
    { value: 'third_person_omniscient', label: '第三人称全知' },
    { value: 'third_person_limited', label: '第三人称限知' },
];

const SENTENCE_RHYTHMS = [
    '短句为主，节奏明快',
    '长短结合，张弛有度',
    '长句为主，舒缓细腻',
    '对仗工整，韵律感强',
    '碎片化，跳跃感强',
];

const PACES = [
    { value: 'fast', label: '快' },
    { value: 'medium', label: '中' },
    { value: 'slow', label: '慢' },
];

const PACING_PATTERNS = [
    '升级流模式',
    '情感递进模式',
    '探案推进模式',
    '权谋推进模式',
    '江湖恩怨模式',
    '探索推进模式',
    '职场/商战模式',
    '标准叙事模式',
    '其他',
];

const CLIMAX_FREQUENCIES = [
    '每3章一个小高潮',
    '每5章一个小高潮',
    '每10章一个小高潮',
    '每卷一个大高潮',
    '每3-5章一个小高潮，每10-15章一个大高潮',
    '每5-8章一个小高潮，每15-20章一个大高潮',
    '每2-4章一个小转折，每8-12章一个真相揭晓',
];

export class WritingProfileModal extends Modal {
    private plugin: any;
    private projectPath: string;
    private profile: WritingProfile;
    private originalProfile: WritingProfile;
    private profileManager: WritingProfileManager;
    private activeTab: string = 'genre';
    private tabContent!: HTMLElement;
    private tabBar!: HTMLElement;
    private isDirty: boolean = false;

    private knowledgeTagManager: KnowledgeTagManager | null = null;
    private techniqueTags: string[] = [];

    private fingerprintLibrary: StyleFingerprintLibrary | null = null;
    private globalFingerprints: StyleFingerprint[] = [];
    private projectFingerprints: StyleFingerprint[] = [];
    private fingerprintLoading: boolean = false;

    private customRuleInput: string = '';

    constructor(app: App, plugin: any, projectPath: string) {
        super(app);
        this.plugin = plugin;
        this.projectPath = projectPath;
        // 通过 EngineRegistry 获取共享实例（registry 已在初始化时赋值给 plugin.writingProfileManager）
        const registry: EngineRegistry = plugin.engineRegistry;
        this.profileManager = registry.get<WritingProfileManager>(ENGINE_NAMES.WRITING_PROFILE_MANAGER);
        this.profile = this.profileManager.getEmptyProfile();
        this.originalProfile = this.profileManager.getEmptyProfile();
    }

    async onOpen() {
        this.modalEl.addClass('nw-scope');

        const wrapper = this.contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal-lg');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        this.contentEl.style.width = '100%';
        this.contentEl.style.setProperty('overflow-y', 'auto', 'important');
        this.contentEl.empty();
        this.contentEl.addClass('novel-writer-writing-profile');

        this.contentEl.createEl('h3', { text: '✍️ 写作配置', attr: { style: 'margin-top:0;margin-bottom:8px;' } });

        this.tabBar = this.contentEl.createDiv({ cls: 'nw-settings-tabbar' });
        const tabs = [
            { id: 'genre', label: '📖 题材与风格' },
            { id: 'rhythm', label: '⏱️ 节奏偏好' },
            { id: 'technique', label: '🎯 技巧偏好' },
            { id: 'fingerprint', label: '🔍 指纹配置' },
            { id: 'rules', label: '📝 自定义规则' },
            { id: 'consistency', label: '✅ 一致性检测' },
        ];
        for (const tab of tabs) {
            const tabEl = this.tabBar.createDiv({
                cls: 'nw-settings-tab',
                text: tab.label,
                attr: { 'data-tab-id': tab.id }
            });
            if (tab.id === this.activeTab) tabEl.addClass('active');
            tabEl.addEventListener('click', () => {
                this.activeTab = tab.id;
                this.renderActiveTab();
            });
        }

        this.tabContent = this.contentEl.createDiv({ cls: 'nw-settings-tab-content' });

        await this.load();
        await this.initDependencies();
        this.renderActiveTab();
        this.renderFooter();
    }

    onClose() {
        if (this.isDirty) {
            if (!confirm('有未保存的修改，确定要关闭吗？')) {
                return;
            }
        }
        this.contentEl.empty();
    }

    private async initDependencies(): Promise<void> {
        try {
            // 通过 EngineRegistry 获取共享实例（registry 已在初始化时赋值给 plugin.knowledgeTagManager）
            const registry: EngineRegistry = this.plugin.engineRegistry;
            const tagManager: KnowledgeTagManager = registry.get<KnowledgeTagManager>(ENGINE_NAMES.KNOWLEDGE_TAG_MANAGER);
            this.knowledgeTagManager = tagManager;
            const techniqueTagList = tagManager.getTagsByCategory('technique');
            this.techniqueTags = techniqueTagList.filter(t => t.parentId).map(t => t.name);
        } catch (e) {
            log.warn('[WritingProfileModal] 初始化标签管理器失败:', e);
        }

        try {
            this.fingerprintLibrary = new StyleFingerprintLibrary(this.app, this.projectPath);
            await this.loadFingerprints();
        } catch (e) {
            log.warn('[WritingProfileModal] 初始化指纹库失败:', e);
        }
    }

    private async loadFingerprints(): Promise<void> {
        if (!this.fingerprintLibrary) return;
        this.fingerprintLoading = true;
        try {
            this.globalFingerprints = await this.fingerprintLibrary.loadGlobal();
            this.projectFingerprints = await this.fingerprintLibrary.loadProject();
        } catch (e) {
            log.warn('[WritingProfileModal] 加载指纹库失败:', e);
        } finally {
            this.fingerprintLoading = false;
        }
    }

    private async load(): Promise<void> {
        try {
            this.profile = await this.profileManager.load(this.projectPath);
            this.originalProfile = JSON.parse(JSON.stringify(this.profile));
        } catch {
            this.profile = this.profileManager.getEmptyProfile();
            this.originalProfile = JSON.parse(JSON.stringify(this.profile));
        }
        this.isDirty = false;
    }

    private async save(): Promise<void> {
        try {
            await this.profileManager.save(this.projectPath, this.profile);
            this.originalProfile = JSON.parse(JSON.stringify(this.profile));
            this.isDirty = false;
            new Notice('✅ 写作配置已保存');
        } catch (e) {
            log.warn('[WritingProfileModal] 保存失败:', e);
            new Notice('❌ 保存失败，请查看控制台');
        }
    }

    private resetToDefault(): void {
        if (!confirm('确定要重置为默认值吗？所有修改将丢失。')) return;
        const projectName = this.profile.projectName;
        const projectType = this.profile.projectType;
        const genre = this.profile.genre.primary || '玄幻';
        this.profile = this.profileManager.generateDefault(genre, projectName, projectType);
        this.isDirty = true;
        this.renderActiveTab();
        new Notice('已重置为默认值');
    }

    private markDirty(): void {
        this.isDirty = true;
    }

    private renderActiveTab(): void {
        this.tabContent.empty();
        this.tabBar.querySelectorAll('.nw-settings-tab').forEach(el => {
            el.toggleClass('active', el.getAttribute('data-tab-id') === this.activeTab);
        });
        switch (this.activeTab) {
            case 'genre': this.renderGenreTab(); break;
            case 'rhythm': this.renderRhythmTab(); break;
            case 'technique': this.renderTechniqueTab(); break;
            case 'fingerprint': void this.renderFingerprintTab(); break;
            case 'rules': this.renderRulesTab(); break;
            case 'consistency': this.renderConsistencyTab(); break;
        }
    }

    private renderGenreTab(): void {
        const section = this.tabContent.createDiv();

        new Setting(section)
            .setName('主题材')
            .setDesc('选择小说的主要题材类型')
            .addDropdown(dropdown => {
                PRIMARY_GENRES.forEach(genre => {
                    dropdown.addOption(genre, genre);
                });
                dropdown.setValue(this.profile.genre.primary || '玄幻');
                dropdown.onChange(value => {
                    this.profile.genre.primary = value;
                    if (!this.profile.genre.tags.includes(value)) {
                        this.profile.genre.tags = [value, ...this.profile.genre.tags.filter(t => t !== value)];
                    }
                    this.markDirty();
                });
            });

        const secondarySetting = new Setting(section)
            .setName('副题材')
            .setDesc('选择次要题材标签，可多选');

        const secondaryContainer = section.createDiv({
            attr: { style: 'margin-top:-8px;margin-bottom:12px;padding:8px 12px;border:1px solid var(--background-modifier-border);border-radius:6px;min-height:40px;display:flex;flex-wrap:wrap;gap:6px;' }
        });

        const renderSecondaryTags = () => {
            secondaryContainer.empty();
            if (SECONDARY_GENRES.length === 0) {
                secondaryContainer.createEl('span', { text: '暂无副题材', attr: { style: 'font-size:12px;color:var(--text-muted);' } });
                return;
            }
            SECONDARY_GENRES.forEach(tag => {
                const isSelected = this.profile.genre.secondary?.includes(tag);
                const tagEl = secondaryContainer.createEl('span', {
                    text: tag,
                    attr: {
                        style: `padding:3px 10px;border-radius:10px;font-size:11px;cursor:pointer;${
                            isSelected
                                ? 'background:var(--interactive-accent);color:var(--text-on-accent);'
                                : 'background:var(--background-secondary);color:var(--text-normal);'
                        }`
                    }
                });
                tagEl.addEventListener('click', () => {
                    if (!this.profile.genre.secondary) this.profile.genre.secondary = [];
                    if (isSelected) {
                        this.profile.genre.secondary = this.profile.genre.secondary.filter(t => t !== tag);
                    } else {
                        this.profile.genre.secondary.push(tag);
                    }
                    this.markDirty();
                    renderSecondaryTags();
                });
            });
        };
        renderSecondaryTags();

        new Setting(section)
            .setName('主要文风')
            .setDesc('选择小说的主要写作风格')
            .addDropdown(dropdown => {
                PRIMARY_STYLES.forEach(style => {
                    dropdown.addOption(style, style);
                });
                dropdown.setValue(this.profile.style.primaryStyle || '简洁');
                dropdown.onChange(value => {
                    this.profile.style.primaryStyle = value;
                    this.markDirty();
                });
            });

        new Setting(section)
            .setName('次要文风')
            .setDesc('可选的辅助文风风格')
            .addDropdown(dropdown => {
                dropdown.addOption('', '（无）');
                SECONDARY_STYLES.filter(s => s).forEach(style => {
                    dropdown.addOption(style, style);
                });
                dropdown.setValue(this.profile.style.secondaryStyle || '');
                dropdown.onChange(value => {
                    this.profile.style.secondaryStyle = value || undefined;
                    this.markDirty();
                });
            });

        new Setting(section)
            .setName('叙事视角')
            .setDesc('选择故事的叙事视角')
            .addDropdown(dropdown => {
                PERSPECTIVES.forEach(p => {
                    dropdown.addOption(p.value, p.label);
                });
                dropdown.setValue(this.profile.style.perspective || 'third_person_omniscient');
                dropdown.onChange(value => {
                    this.profile.style.perspective = value as StyleConfig['perspective'];
                    this.markDirty();
                });
            });

        new Setting(section)
            .setName('句式节奏')
            .setDesc('选择句子的节奏风格')
            .addDropdown(dropdown => {
                SENTENCE_RHYTHMS.forEach(rhythm => {
                    dropdown.addOption(rhythm, rhythm);
                });
                dropdown.setValue(this.profile.style.sentenceRhythm || SENTENCE_RHYTHMS[1]);
                dropdown.onChange(value => {
                    this.profile.style.sentenceRhythm = value;
                    this.markDirty();
                });
            });

        const formalityRow = new Setting(section)
            .setName('正式程度')
            .setDesc(`口语化 ←→ 书面化（当前：${(this.profile.style.formalityLevel * 100).toFixed(0)}%）`)
            .addSlider(slider => {
                slider.setLimits(0, 1, 0.01);
                slider.setValue(this.profile.style.formalityLevel ?? 0.5);
                slider.setDynamicTooltip();
                slider.onChange(value => {
                    this.profile.style.formalityLevel = value;
                    formalityRow.setDesc(`口语化 ←→ 书面化（当前：${(value * 100).toFixed(0)}%）`);
                    this.markDirty();
                });
            });
    }

    private renderRhythmTab(): void {
        const section = this.tabContent.createDiv();

        new Setting(section)
            .setName('整体节奏')
            .setDesc('选择小说的整体叙事节奏')
            .addDropdown(dropdown => {
                PACES.forEach(p => {
                    dropdown.addOption(p.value, p.label);
                });
                dropdown.setValue(this.profile.rhythm.pace || 'medium');
                dropdown.onChange(value => {
                    this.profile.rhythm.pace = value as RhythmConfig['pace'];
                    this.markDirty();
                });
            });

        new Setting(section)
            .setName('节奏模式')
            .setDesc('选择主要的剧情推进模式')
            .addDropdown(dropdown => {
                PACING_PATTERNS.forEach(pattern => {
                    dropdown.addOption(pattern, pattern);
                });
                dropdown.setValue(this.profile.rhythm.pacingPattern || '标准叙事模式');
                dropdown.onChange(value => {
                    this.profile.rhythm.pacingPattern = value;
                    this.markDirty();
                });
            });

        new Setting(section)
            .setName('单章目标字数')
            .setDesc('每章的目标字数（默认 2500）')
            .addText(text => text
                .setPlaceholder('2500')
                .setValue(String(this.profile.rhythm.chapterTargetWords || 2500))
                .onChange(value => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num > 0) {
                        this.profile.rhythm.chapterTargetWords = num;
                        this.markDirty();
                    }
                }));

        new Setting(section)
            .setName('高潮频率')
            .setDesc('剧情高潮出现的频率')
            .addDropdown(dropdown => {
                CLIMAX_FREQUENCIES.forEach(freq => {
                    dropdown.addOption(freq, freq);
                });
                dropdown.setValue(this.profile.rhythm.climaxFrequency || CLIMAX_FREQUENCIES[1]);
                dropdown.onChange(value => {
                    this.profile.rhythm.climaxFrequency = value;
                    this.markDirty();
                });
            });
    }

    private renderTechniqueTab(): void {
        const section = this.tabContent.createDiv();

        section.createEl('div', {
            text: '启用的技巧',
            attr: { style: 'font-size:13px;font-weight:500;margin-bottom:8px;margin-top:4px;' }
        });

        const enabledContainer = section.createDiv({
            attr: { style: 'margin-bottom:16px;padding:8px 12px;border:1px solid var(--background-modifier-border);border-radius:6px;min-height:40px;display:flex;flex-wrap:wrap;gap:6px;' }
        });

        const renderEnabledTags = () => {
            enabledContainer.empty();
            if (this.techniqueTags.length === 0) {
                enabledContainer.createEl('span', { text: '加载中...', attr: { style: 'font-size:12px;color:var(--text-muted);' } });
                return;
            }
            this.techniqueTags.forEach(tag => {
                const isSelected = this.profile.techniques.enabled?.includes(tag);
                const tagEl = enabledContainer.createEl('span', {
                    text: tag,
                    attr: {
                        style: `padding:3px 10px;border-radius:10px;font-size:11px;cursor:pointer;${
                            isSelected
                                ? 'background:var(--interactive-accent);color:var(--text-on-accent);'
                                : 'background:var(--background-secondary);color:var(--text-normal);'
                        }`
                    }
                });
                tagEl.addEventListener('click', () => {
                    if (!this.profile.techniques.enabled) this.profile.techniques.enabled = [];
                    if (isSelected) {
                        this.profile.techniques.enabled = this.profile.techniques.enabled.filter(t => t !== tag);
                    } else {
                        this.profile.techniques.enabled.push(tag);
                    }
                    this.markDirty();
                    renderEnabledTags();
                });
            });
        };
        renderEnabledTags();

        section.createEl('div', {
            text: '禁用的技巧（不喜欢的写法）',
            attr: { style: 'font-size:13px;font-weight:500;margin-bottom:8px;' }
        });

        const disabledContainer = section.createDiv({
            attr: { style: 'margin-bottom:16px;padding:8px 12px;border:1px solid var(--background-modifier-border);border-radius:6px;min-height:40px;display:flex;flex-wrap:wrap;gap:6px;' }
        });

        const renderDisabledTags = () => {
            disabledContainer.empty();
            if (this.techniqueTags.length === 0) {
                disabledContainer.createEl('span', { text: '加载中...', attr: { style: 'font-size:12px;color:var(--text-muted);' } });
                return;
            }
            this.techniqueTags.forEach(tag => {
                const isSelected = this.profile.techniques.disabled?.includes(tag);
                const tagEl = disabledContainer.createEl('span', {
                    text: tag,
                    attr: {
                        style: `padding:3px 10px;border-radius:10px;font-size:11px;cursor:pointer;${
                            isSelected
                                ? 'background:var(--background-modifier-error);color:var(--text-on-accent);'
                                : 'background:var(--background-secondary);color:var(--text-normal);'
                        }`
                    }
                });
                tagEl.addEventListener('click', () => {
                    if (!this.profile.techniques.disabled) this.profile.techniques.disabled = [];
                    if (isSelected) {
                        this.profile.techniques.disabled = this.profile.techniques.disabled.filter(t => t !== tag);
                    } else {
                        this.profile.techniques.disabled.push(tag);
                    }
                    this.markDirty();
                    renderDisabledTags();
                });
            });
        };
        renderDisabledTags();

        const dialogueRow = new Setting(section)
            .setName('对话占比偏好')
            .setDesc(`对话在叙事中的占比偏好（当前：${((this.profile.techniques.dialogueRatio ?? 0.4) * 100).toFixed(0)}%）`)
            .addSlider(slider => {
                slider.setLimits(0, 1, 0.01);
                slider.setValue(this.profile.techniques.dialogueRatio ?? 0.4);
                slider.setDynamicTooltip();
                slider.onChange(value => {
                    this.profile.techniques.dialogueRatio = value;
                    dialogueRow.setDesc(`对话在叙事中的占比偏好（当前：${(value * 100).toFixed(0)}%）`);
                    this.markDirty();
                });
            });

        const descriptionRow = new Setting(section)
            .setName('描写占比偏好')
            .setDesc(`描写在叙事中的占比偏好（当前：${((this.profile.techniques.descriptionRatio ?? 0.3) * 100).toFixed(0)}%）`)
            .addSlider(slider => {
                slider.setLimits(0, 1, 0.01);
                slider.setValue(this.profile.techniques.descriptionRatio ?? 0.3);
                slider.setDynamicTooltip();
                slider.onChange(value => {
                    this.profile.techniques.descriptionRatio = value;
                    descriptionRow.setDesc(`描写在叙事中的占比偏好（当前：${(value * 100).toFixed(0)}%）`);
                    this.markDirty();
                });
            });
    }

    private async renderFingerprintTab(): Promise<void> {
        const section = this.tabContent.createDiv();

        section.createEl('p', {
            text: '配置写作指纹的启用和注入强度，用于保持风格一致性。',
            cls: 'setting-item-description'
        });

        if (this.fingerprintLoading) {
            section.createDiv({
                attr: { style: 'padding:40px;text-align:center;color:var(--text-faint);font-size:13px;' },
                text: '加载中...'
            });
            return;
        }

        const globalGroup = section.createDiv({ attr: { style: 'margin-bottom:20px;' } });
        const globalHeader = globalGroup.createDiv({ attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;' } });
        globalHeader.createEl('span', { text: '🌐 全局指纹', attr: { style: 'font-weight:600;font-size:13px;' } });
        globalHeader.createEl('span', { text: `共 ${this.globalFingerprints.length} 个`, attr: { style: 'font-size:11px;color:var(--text-muted);' } });

        const globalList = globalGroup.createDiv({
            attr: { style: 'max-height:150px;overflow-y:auto;padding:8px 12px;border:1px solid var(--background-modifier-border);border-radius:6px;' }
        });
        if (this.globalFingerprints.length === 0) {
            globalList.createEl('span', { text: '暂无全局指纹', attr: { style: 'font-size:12px;color:var(--text-muted);' } });
        } else {
            this.globalFingerprints.forEach(fp => {
                const isEnabled = this.profile.fingerprint.enabledGlobal?.includes(fp.id);
                const row = globalList.createDiv({
                    attr: { style: 'display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--background-modifier-border);' }
                });
                const checkbox = row.createEl('input', {
                    attr: { type: 'checkbox', style: 'cursor:pointer;' }
                });
                checkbox.checked = isEnabled;
                checkbox.addEventListener('change', () => {
                    if (!this.profile.fingerprint.enabledGlobal) this.profile.fingerprint.enabledGlobal = [];
                    if (checkbox.checked) {
                        if (!this.profile.fingerprint.enabledGlobal.includes(fp.id)) {
                            this.profile.fingerprint.enabledGlobal.push(fp.id);
                        }
                    } else {
                        this.profile.fingerprint.enabledGlobal = this.profile.fingerprint.enabledGlobal.filter(id => id !== fp.id);
                    }
                    this.markDirty();
                });
                row.createEl('span', { text: fp.name, attr: { style: 'font-size:12px;flex:1;' } });
                if (fp.tags && fp.tags.length > 0) {
                    row.createEl('span', { text: fp.tags.slice(0, 2).join(', '), attr: { style: 'font-size:11px;color:var(--text-muted);' } });
                }
            });
        }

        const projectGroup = section.createDiv({ attr: { style: 'margin-bottom:20px;' } });
        const projectHeader = projectGroup.createDiv({ attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;' } });
        projectHeader.createEl('span', { text: '📁 项目指纹', attr: { style: 'font-weight:600;font-size:13px;' } });
        projectHeader.createEl('span', { text: `共 ${this.projectFingerprints.length} 个`, attr: { style: 'font-size:11px;color:var(--text-muted);' } });

        const projectList = projectGroup.createDiv({
            attr: { style: 'max-height:150px;overflow-y:auto;padding:8px 12px;border:1px solid var(--background-modifier-border);border-radius:6px;' }
        });
        if (this.projectFingerprints.length === 0) {
            projectList.createEl('span', { text: '暂无项目指纹', attr: { style: 'font-size:12px;color:var(--text-muted);' } });
        } else {
            this.projectFingerprints.forEach(fp => {
                const isEnabled = this.profile.fingerprint.enabledProject?.includes(fp.id);
                const row = projectList.createDiv({
                    attr: { style: 'display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--background-modifier-border);' }
                });
                const checkbox = row.createEl('input', {
                    attr: { type: 'checkbox', style: 'cursor:pointer;' }
                });
                checkbox.checked = isEnabled;
                checkbox.addEventListener('change', () => {
                    if (!this.profile.fingerprint.enabledProject) this.profile.fingerprint.enabledProject = [];
                    if (checkbox.checked) {
                        if (!this.profile.fingerprint.enabledProject.includes(fp.id)) {
                            this.profile.fingerprint.enabledProject.push(fp.id);
                        }
                    } else {
                        this.profile.fingerprint.enabledProject = this.profile.fingerprint.enabledProject.filter(id => id !== fp.id);
                    }
                    this.markDirty();
                });
                row.createEl('span', { text: fp.name, attr: { style: 'font-size:12px;flex:1;' } });
                if (fp.tags && fp.tags.length > 0) {
                    row.createEl('span', { text: fp.tags.slice(0, 2).join(', '), attr: { style: 'font-size:11px;color:var(--text-muted);' } });
                }
            });
        }

        const strengthRow = new Setting(section)
            .setName('注入强度')
            .setDesc(`注入强度越高，风格越贴近参考但可能影响原创性（当前：${(this.profile.fingerprint.injectionStrength * 100).toFixed(0)}%）。如需对各指纹进行 V2 12 维独立强度调节，请使用下方"打开 V2 强度调节"按钮。`)
            .addSlider(slider => {
                slider.setLimits(0.1, 1.0, 0.05);
                slider.setValue(this.profile.fingerprint.injectionStrength ?? 0.5);
                slider.setDynamicTooltip();
                slider.onChange(value => {
                    this.profile.fingerprint.injectionStrength = value;
                    strengthRow.setDesc(`注入强度越高，风格越贴近参考但可能影响原创性（当前：${(value * 100).toFixed(0)}%）。如需对各指纹进行 V2 12 维独立强度调节，请使用下方"打开 V2 强度调节"按钮。`);
                    this.markDirty();
                });
            });

        // V2 强度调节入口（针对具体指纹的 12 维独立强度配置）
        const allFingerprints: StyleFingerprint[] = [
            ...(this.globalFingerprints || []),
            ...(this.projectFingerprints || []),
        ];
        if (this.fingerprintLibrary && allFingerprints.length > 0) {
            const v2Row = new Setting(section)
                .setName('V2 强度调节（高级）')
                .setDesc('为具体指纹配置 V2 12 维独立强度，覆盖上方全局注入强度');

            const select = new DropdownComponent(v2Row.controlEl);
            select.addOption('', '— 选择指纹 —');
            allFingerprints.forEach(fp => {
                const label = `[${fp.scope}] ${fp.name}`;
                select.addOption(fp.id, label);
            });

            v2Row.addExtraButton(btn => {
                btn.setIcon('sliders-horizontal')
                    .setTooltip('打开 V2 强度调节')
                    .onClick(() => {
                        const fpId = select.getValue();
                        if (!fpId) {
                            new Notice('请先选择一个指纹');
                            return;
                        }
                        const target = allFingerprints.find(fp => fp.id === fpId);
                        if (!target) {
                            new Notice('未找到选中的指纹');
                            return;
                        }
                        new FingerprintIntensityModal(this.app, {
                            fingerprint: target,
                            library: this.fingerprintLibrary!,
                            project: this.projectPath,
                        }).open();
                    });
            });
        }
    }

    private renderRulesTab(): void {
        const section = this.tabContent.createDiv();

        section.createEl('p', {
            text: '添加自定义写作规则，每行一条。这些规则会在写作时作为参考。',
            cls: 'setting-item-description'
        });

        const inputRow = section.createDiv({ attr: { style: 'display:flex;gap:8px;margin-bottom:12px;' } });
        const input = inputRow.createEl('input', {
            attr: {
                type: 'text',
                placeholder: '输入规则内容，按 Enter 或点击添加',
                value: this.customRuleInput,
                style: 'flex:1;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:13px;background:var(--background-primary);color:var(--text-normal);'
            }
        });
        input.addEventListener('input', (e) => {
            this.customRuleInput = (e.target as HTMLInputElement).value;
        });
        const addBtn = inputRow.createEl('button', {
            text: '➕ 添加',
            attr: {
                type: 'button',
                style: 'padding:6px 16px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:12px;'
            }
        });
        addBtn.addEventListener('click', () => this.addCustomRule());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addCustomRule();
            }
        });

        const rulesContainer = section.createDiv({
            attr: { style: 'max-height:350px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:6px;' }
        });

        const renderRules = () => {
            rulesContainer.empty();
            if (!this.profile.customRules || this.profile.customRules.length === 0) {
                rulesContainer.createDiv({
                    attr: { style: 'padding:32px;text-align:center;color:var(--text-muted);font-size:13px;' }
                }).createEl('span', { text: '暂无自定义规则' });
                return;
            }
            this.profile.customRules.forEach((rule, index) => {
                const row = rulesContainer.createDiv({
                    attr: {
                        style: `display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--background-modifier-border);${
                            index === this.profile.customRules!.length - 1 ? 'border-bottom:none;' : ''
                        }`
                    }
                });
                row.createEl('span', { text: `${index + 1}.`, attr: { style: 'font-size:12px;color:var(--text-muted);min-width:24px;' } });
                const ruleText = row.createEl('span', {
                    text: rule,
                    attr: { style: 'flex:1;font-size:12px;word-break:break-all;' }
                });
                const deleteBtn = row.createEl('button', {
                    text: '✕',
                    attr: {
                        type: 'button',
                        style: 'padding:2px 8px;cursor:pointer;border:none;background:transparent;color:var(--text-muted);font-size:14px;'
                    }
                });
                deleteBtn.addEventListener('click', () => {
                    this.profile.customRules = this.profile.customRules!.filter((_, i) => i !== index);
                    this.markDirty();
                    renderRules();
                });
            });
        };
        renderRules();
    }

    private addCustomRule(): void {
        const rule = this.customRuleInput.trim();
        if (!rule) {
            new Notice('请输入规则内容');
            return;
        }
        if (!this.profile.customRules) this.profile.customRules = [];
        if (this.profile.customRules.includes(rule)) {
            new Notice('该规则已存在');
            return;
        }
        this.profile.customRules.push(rule);
        this.customRuleInput = '';
        this.markDirty();
        this.renderRulesTab();
    }

    private renderConsistencyTab(): void {
        const section = this.tabContent.createDiv();

        section.createEl('p', {
            text: '配置一致性检测的开关和阈值。',
            cls: 'setting-item-description'
        });

        new Setting(section)
            .setName('人设一致性检测')
            .setDesc('检测角色的性格、行为、能力等是否前后一致')
            .addToggle(toggle => {
                toggle.setValue(this.profile.consistency.characterCheck !== false);
                toggle.onChange(value => {
                    this.profile.consistency.characterCheck = value;
                    this.markDirty();
                });
            });

        new Setting(section)
            .setName('伏笔追踪检测')
            .setDesc('追踪伏笔的埋设和回收，确保前后呼应')
            .addToggle(toggle => {
                toggle.setValue(this.profile.consistency.foreshadowCheck !== false);
                toggle.onChange(value => {
                    this.profile.consistency.foreshadowCheck = value;
                    this.markDirty();
                });
            });

        new Setting(section)
            .setName('节奏一致性检测')
            .setDesc('检测整体叙事节奏是否符合设定的节奏偏好（MVP可选）')
            .addToggle(toggle => {
                toggle.setValue(this.profile.consistency.rhythmCheck === true);
                toggle.onChange(value => {
                    this.profile.consistency.rhythmCheck = value;
                    this.markDirty();
                });
            });

        section.createEl('div', {
            text: '💡 检测阈值说明',
            attr: { style: 'font-size:13px;font-weight:500;margin-top:16px;margin-bottom:8px;' }
        });

        section.createEl('div', {
            text: '一致性检测会在写作过程中自动运行，当检测到不一致时会给出提示。检测阈值决定了提示的敏感度，阈值越低提示越频繁。具体阈值可在未来版本中进行精细调整。',
            attr: { style: 'font-size:12px;color:var(--text-muted);line-height:1.6;padding:12px;background:var(--background-secondary);border-radius:6px;' }
        });
    }

    private renderFooter(): void {
        const btnRow = this.contentEl.createDiv({
            cls: 'nw-settings-btn-row',
            attr: { style: 'display:flex;gap:8px;margin-top:20px;justify-content:space-between;' }
        });

        const leftBtns = btnRow.createDiv({ attr: { style: 'display:flex;gap:8px;' } });
        const rightBtns = btnRow.createDiv({ attr: { style: 'display:flex;gap:8px;' } });

        const resetBtn = leftBtns.createEl('button', {
            cls: 'nw-settings-danger-btn',
            text: '🔄 重置为默认值',
            attr: { type: 'button' }
        });
        resetBtn.addEventListener('click', () => this.resetToDefault());

        const cancelBtn = rightBtns.createEl('button', {
            cls: 'nw-settings-secondary-btn',
            text: '取消',
            attr: { type: 'button' }
        });
        cancelBtn.addEventListener('click', () => {
            if (this.isDirty && !confirm('有未保存的修改，确定要关闭吗？')) return;
            this.close();
        });

        const saveBtn = rightBtns.createEl('button', {
            cls: 'nw-settings-primary-btn',
            text: '💾 保存',
            attr: { type: 'button' }
        });
        saveBtn.addEventListener('click', async () => {
            await this.save();
            this.close();
        });
    }
}
