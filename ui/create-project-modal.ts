import { App, Modal, Notice, DataAdapter, TFile } from 'obsidian';
import { OperationConfirmModal } from './components/progress';
import NovelWriterPlugin from '../main';
import { ContextManager } from '../engine/context-manager';
import { WritingProfileManager } from '../engine/writing-profile';
import { ENGINE_NAMES } from '../shared/engine-names';
import { SUBDIR_SETTING_LIB_FILE, SUBDIR_WRITING_STYLE_FILE, SUBDIR_WORLD_ARCH, PJ_FANFIC_DIR, PJ_WORLD_ARCH_DIR, PJ_TEMPLATE_DIR, PJ_OUTLINE_DIR, pjFanficDir, pjProjectMeta, templateFingerprintsFile, projectFingerprintsFile, projectFingerprintLibraryDir } from '../shared/paths';
import { createLogger } from '../shared/logger';
import { ensureTemplateScaffold } from '../shared/template-scaffold';
import { newProjectPath } from '../domains/kernel/project-locator';
import { fanficSettingsFileName, isFanficApproved } from './full-writer/fanfic-settings-utils';
import { suggestProjectName, validateProjectName } from '../shared/project-name';
import {
    CREATION_MODE_SPECS,
    buildCreationModeGuide,
    buildCreationModeMetaSection,
    type CreationMode,
    type CreationModeMeta,
} from '../shared/creation-mode';
import { buildStoryStructureGuide } from '../shared/story-structure';
import { StorySettingsEditor } from './story-settings-form';
import { createLongNovelProject } from './services/project-create-service';


const log = createLogger('CreateProjectModal');

/**
 * CreateProjectPrefill 类型定义。
 */
export interface CreateProjectPrefill {
    name?: string;
    genre?: string;
    description?: string;
    projectType?: 'original' | 'fanfic';
    sourceWork?: string;
    sourceWorldview?: string;
    /** 兼容旧调用；本弹窗只会创建长篇 */
    creationMode?: CreationMode;
    onCreated?: (projectName: string) => void | Promise<void>;
}

/**
 * 创建项目弹窗。
 */
export class CreateProjectModal extends Modal {
    private plugin: NovelWriterPlugin;
    private adapter: DataAdapter;
    private selectedFanficSettingPath = '';
    private fanficSettingsOutsideClickHandler?: (ev: MouseEvent) => void;

    constructor(app: App, plugin: NovelWriterPlugin, private readonly prefill?: CreateProjectPrefill) {
        super(app);
        this.plugin = plugin;
        this.adapter = app.vault.adapter;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope', 'nw-modal', 'nw-create-project-modal');
        const { contentEl } = this;

        contentEl.empty();

        const headerEl = contentEl.createDiv({ cls: 'nw-modal-header' });
        headerEl.createEl('span', { cls: 'nw-modal-icon', text: '📖' });
        const titleWrap = headerEl.createDiv({ cls: 'nw-modal-title-wrap' });
        titleWrap.createEl('h2', { cls: 'nw-modal-title', text: '新建长篇小说项目' });

        const bodyEl = contentEl.createDiv({ cls: 'nw-modal-body' });

        const projectNameGroup = bodyEl.createDiv({ cls: 'nw-form-group' });
        projectNameGroup.createEl('label', { cls: 'nw-form-label nw-form-label-required', text: '项目名称' });
        const projectNameInput = projectNameGroup.createEl('input', {
            type: 'text',
            placeholder: '请输入项目名称（中文小说名）',
            cls: 'nw-input nw-form-input'
        });

        // AI 随机构思：一次生成书名 / 题材 / 简介，避免用户从空白开始
        const aiRandomBtn = projectNameGroup.createEl('button', {
            text: '🎲 AI 随机构思',
            cls: 'nw-btn nw-btn-secondary nw-random-project-btn',
            attr: { type: 'button', title: '根据题材随机生成书名、题材与项目简介' }
        });
        aiRandomBtn.onclick = async () => {
            if (aiRandomBtn.disabled) return;
            aiRandomBtn.disabled = true;
            const originalText = aiRandomBtn.textContent || '';
            aiRandomBtn.textContent = '⏳ 构思中...';
            try {
                const preferredGenre = genreInput.value.trim();
                // 每次点击都换一组随机维度与随机种子：仅靠 temperature 无法避免
                // prompt 缓存命中导致的「每次结果都一样」。
                const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
                const identity = pick(['落魄宗门弟子', '小城捕快', '退役佣兵', '失忆匠人', '被逐出家门的庶子', '夜市摊主', '边关斥候', '落魄世家小姐', '刚入职的实习生', '守墓人']);
                const power = pick(['能听见亡者低语', '可回溯三息之前', '以情绪为燃料', '看见他人命线', '把记忆铸成器物', '在梦中预演战斗', '与一只上古异兽共享感官', '借债般预支未来气运']);
                const conflict = pick(['争夺一座会移动的古城', '揭开师门灭门真相', '阻止一场被写进史书的灾祸', '在两大势力夹缝中保下一条街', '追查一批失踪的觉醒者', '改写自己被定下的死局']);
                const tone = pick(['冷峻克制', '热血爽利', '诡谲悬疑', '轻松诙谐', '苍凉悲壮', '温柔治愈']);
                const randomSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

                const systemPrompt = '你是资深网文编辑与起名专家。只输出严格 JSON，不要输出 Markdown 代码块或解释。';
                const userPrompt = `请随机构思一个适合番茄小说平台的原创网文项目，输出 JSON：
{
  "name": "书名（2-10个汉字，有吸引力，不含标点）",
  "genre": "题材（从 玄幻/仙侠/都市/科幻/悬疑/历史/言情/奇幻/武侠/末世 中选一个）",
  "description": "一句话简介（40-80字，包含主角、核心冲突、开篇钩子）"
}
${preferredGenre
        ? `题材必须固定为「${preferredGenre}」，不得更改。`
        : '题材请从上述列表中随机选择，不要总是选同一个。'}
本次随机种子：${randomSeed}
灵感维度（可参考，不必逐字照搬）：
- 主角身份：${identity}
- 核心能力/金手指：${power}
- 核心冲突：${conflict}
- 情绪基调：${tone}
硬性要求：必须与「少年天才觉醒血脉、退婚打脸、宗门大比」这类最常见套路明显不同；书名不得与近期热门作品重名。`;
                const result = await this.plugin.aiEngine.callAI(
                    systemPrompt,
                    userPrompt,
                    undefined,
                    0.95,
                    1024,
                    { bypassCache: true }
                );
                if (result.error) {
                    new Notice(`❌ AI 构思失败：${result.error}`, 8000);
                    return;
                }
                const matched = result.content.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
                if (!matched) {
                    new Notice('❌ AI 返回格式异常，请重试', 6000);
                    return;
                }
                const data = JSON.parse(matched[0]) as { name?: string; genre?: string; description?: string };
                if (data.name) projectNameInput.value = String(data.name).trim();
                if (data.genre) {
                    genreInput.value = String(data.genre).trim();
                    tagContainer.querySelectorAll('.nw-genre-tag').forEach(t => {
                        t.classList.toggle('selected', t.textContent === genreInput.value);
                    });
                    storyEditor.setGenre(genreInput.value);
                }
                if (data.description) descriptionInput.value = String(data.description).trim();
                new Notice('✅ 已生成随机项目构思', 3000);
            } catch (e) {
                log.warn('[CreateProject] AI 随机构思失败:', e);
                new Notice('❌ AI 构思失败，请检查网络或模型配置', 8000);
            } finally {
                aiRandomBtn.disabled = false;
                aiRandomBtn.textContent = originalText;
            }
        };

        const genreGroup = bodyEl.createDiv({ cls: 'nw-form-group' });
        genreGroup.createEl('label', { cls: 'nw-form-label nw-form-label-required', text: '题材' });
        const genreTags = ['玄幻', '仙侠', '都市', '科幻', '悬疑', '历史', '言情', '奇幻', '武侠', '末世'];
        const tagContainer = genreGroup.createEl('div', { cls: 'nw-genre-tags' });

        genreTags.forEach(genre => {
            const tag = tagContainer.createEl('button', { text: genre, cls: 'nw-genre-tag', attr: { type: 'button' } });
            tag.onclick = () => {
                genreInput.value = genre;
                genreInput.focus();
                tagContainer.querySelectorAll('.nw-genre-tag').forEach(t => t.classList.remove('selected'));
                tag.classList.add('selected');
            };
        });

        const genreInput = genreGroup.createEl('input', {
            type: 'text',
            placeholder: '输入题材（或点击上方标签）',
            cls: 'nw-input nw-form-input'
        });

        const storySettingsHost = bodyEl.createDiv({ cls: 'nw-story-settings-host' });
        const storyEditor = new StorySettingsEditor(storySettingsHost, null, {
            getGenre: () => genreInput.value,
        });

        const modeGroup = bodyEl.createDiv({ cls: 'nw-form-group' });
        modeGroup.createEl('label', {
            cls: 'nw-form-label nw-form-label-required',
            text: '创作类型',
        });
        modeGroup.createEl('p', {
            cls: 'nw-text-12-muted',
            text: '本入口仅创建长篇小说。短篇与剧本请使用各自的独立入口。',
        });

        const typeGroup = bodyEl.createDiv({ cls: 'nw-form-group' });
        typeGroup.createEl('label', { cls: 'nw-form-label', text: '项目类型' });
        const typeToggle = typeGroup.createDiv({ cls: 'nw-project-type-toggle' });

        let projectType: 'original' | 'fanfic' = 'original';

        const originalBtn = typeToggle.createEl('button', { text: '🎨 原创', cls: 'nw-type-btn active', attr: { type: 'button', title: '原创小说项目' } });
        const fanficBtn = typeToggle.createEl('button', { text: '📖 同人', cls: 'nw-type-btn', attr: { type: 'button', title: '同人小说项目（需填原作信息）' } });

        const fanficFields = bodyEl.createDiv({ cls: 'nw-fanfic-fields' });

        const sourceGroup = fanficFields.createDiv({ cls: 'nw-form-group' });
        sourceGroup.createEl('label', { cls: 'nw-form-label', text: '原作名称' });
        const sourceInput = sourceGroup.createEl('input', { type: 'text', cls: 'nw-input nw-form-input' });

        const sourceWorldGroup = fanficFields.createDiv({ cls: 'nw-form-group' });
        sourceWorldGroup.createEl('label', { cls: 'nw-form-label', text: '原作世界观简述（可选，辅助AI理解）' });
        const sourceWorldInput = sourceWorldGroup.createEl('textarea', { cls: 'nw-textarea nw-form-textarea' });

        const settingsGroup = fanficFields.createDiv({ cls: 'nw-form-group nw-settings-import' });
        settingsGroup.createEl('label', { cls: 'nw-form-label', text: '从设定库导入（可选）' });

        const settingsSelector = settingsGroup.createDiv({ cls: 'nw-fanfic-selector' });
        const settingsTrigger = settingsSelector.createEl('button', {
            text: '选择设定库',
            cls: 'nw-btn nw-btn-secondary nw-fanfic-selector-trigger',
            attr: { title: '从已有设定库导入同人设定' }
        });
        settingsTrigger.type = 'button';
        const settingsValue = settingsSelector.createDiv({ cls: 'nw-fanfic-selector-value' });
        settingsValue.setText('当前：手动输入');
        const settingsList = settingsSelector.createDiv({ cls: 'nw-fanfic-selector-list' });

        let settingEntries: Array<{ path: string; name: string }> = [];

        const setSettingsListOpen = (open: boolean) => {
            settingsList.classList.toggle('open', open);
            if (open) {
                const searchInput = settingsList.querySelector('.nw-fanfic-selector-search') as HTMLInputElement;
                if (searchInput) {
                    searchInput.value = '';
                    searchInput.focus();
                    renderFilteredItems('');
                }
            }
        };

        const applySetting = async (selectedPath: string, selectedName: string) => {
            this.selectedFanficSettingPath = selectedPath;
            settingsTrigger.setText(selectedName || '手动输入');
            if (!selectedPath) {
                settingsValue.setText('当前：手动输入');
                sourceWorldInput.disabled = false;
                sourceWorldInput.value = '';
                return;
            }

            settingsValue.setText(`当前：${selectedName}`);
            try {
                const file = this.app.vault.getAbstractFileByPath(selectedPath);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    const fmMatch = content.match(/^---\n([\s\S]*?)---/);
                    if (fmMatch) {
                        const fmText = fmMatch[1];
                        const nameMatch = fmText.match(/作品名称:\s*(.+)/);
                        if (nameMatch) sourceInput.value = nameMatch[1].trim();
                        sourceWorldInput.value = `已从设定库导入：${selectedName}\n请查看 ${file.path} 获取完整设定`;
                        sourceWorldInput.disabled = true;
                    }
                }
            } catch (e) {
                log.warn('Failed to load fanfic settings:', e);
            }
        };

        const addSettingOption = (container: HTMLElement, text: string, path: string, name: string) => {
            const item = container.createEl('button', {
                text,
                cls: 'nw-fanfic-selector-item'
            });
            item.type = 'button';
            item.onclick = async () => {
                await applySetting(path, name);
                setSettingsListOpen(false);
            };
        };

        const renderFilteredItems = (query: string) => {
            const itemsContainer = settingsList.querySelector('.nw-fanfic-selector-items') as HTMLElement;
            if (!itemsContainer) return;
            itemsContainer.empty();

            const q = query.trim().toLowerCase();
            const filtered = q
                ? settingEntries.filter(e => e.name.toLowerCase().includes(q))
                : settingEntries;

            if (!q) {
                itemsContainer.createEl('div', { text: '选择设定库条目', cls: 'nw-fanfic-selector-hint' });
                addSettingOption(itemsContainer, '手动输入', '', '手动输入');
            }

            if (filtered.length === 0) {
                itemsContainer.createEl('div', { text: q ? '没有匹配的设定' : '暂无可用设定', cls: 'nw-fanfic-selector-empty' });
                return;
            }

            for (const entry of filtered) {
                addSettingOption(itemsContainer, entry.name, entry.path, entry.name);
            }
        };

        const loadSettingsLib = async () => {
            try {
                const fanficDir = `${PJ_FANFIC_DIR}`;
                const files = this.app.vault.getFiles().filter(f =>
                    f.path.startsWith(fanficDir) &&
                    f.name.endsWith('.md') &&
                    !f.name.includes('模板')
                );
                settingEntries = [];
                for (const file of files) {
                    settingEntries.push({ path: file.path, name: file.name.replace('.md', '') });
                }
                settingsList.empty();

                const searchInput = settingsList.createEl('input', {
                    type: 'text',
                    placeholder: '搜索设定...',
                    cls: 'nw-input nw-fanfic-selector-search'
                });
                searchInput.addEventListener('input', () => renderFilteredItems(searchInput.value));
                searchInput.addEventListener('click', (ev) => ev.stopPropagation());

                const itemsContainer = settingsList.createDiv({ cls: 'nw-fanfic-selector-items' });
                renderFilteredItems('');
            } catch (e) {
                log.warn('Failed to load fanfic settings lib:', e);
            }
        };

        settingsTrigger.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setSettingsListOpen(!settingsList.classList.contains('open'));
        };

        this.fanficSettingsOutsideClickHandler = (ev: MouseEvent) => {
            const target = ev.target as Node;
            if (!settingsSelector.contains(target)) {
                setSettingsListOpen(false);
            }
        };
        document.addEventListener('click', this.fanficSettingsOutsideClickHandler);

        loadSettingsLib();

        originalBtn.addEventListener('click', () => {
            projectType = 'original';
            originalBtn.classList.add('active');
            fanficBtn.classList.remove('active');
            fanficFields.classList.remove('visible');
        });

        fanficBtn.addEventListener('click', () => {
            projectType = 'fanfic';
            fanficBtn.classList.add('active');
            originalBtn.classList.remove('active');
            fanficFields.classList.add('visible');
        });

        const descGroup = bodyEl.createDiv({ cls: 'nw-form-group' });
        descGroup.createEl('label', { cls: 'nw-form-label', text: '项目描述（可选）' });
        const descriptionInput = descGroup.createEl('textarea', {
            placeholder: '简要描述你的项目...',
            cls: 'nw-textarea nw-form-textarea'
        });

        if (this.prefill) {
            projectNameInput.value = suggestProjectName(this.prefill.name || '');
            genreInput.value = this.prefill.genre || '';
            descriptionInput.value = this.prefill.description || '';
            tagContainer.querySelectorAll('.nw-genre-tag').forEach(tag => {
                tag.classList.toggle('selected', tag.textContent === genreInput.value);
            });
            if (this.prefill.projectType === 'fanfic') {
                fanficBtn.click();
                sourceInput.value = this.prefill.sourceWork || '';
                sourceWorldInput.value = this.prefill.sourceWorldview || '';
            }
        }

        const footerEl = contentEl.createDiv({ cls: 'nw-modal-footer' });
        const cancelBtn = footerEl.createEl('button', { text: '取消', cls: 'nw-btn nw-btn-secondary', attr: { type: 'button', title: '取消创建项目' } });
        cancelBtn.onclick = () => this.close();
        const createButton = footerEl.createEl('button', {
            text: '创建项目',
            cls: 'nw-btn nw-btn-primary',
            attr: { type: 'button', title: '创建项目并复制元文件模板' },
        });
        createButton.onclick = async () => {
            const projectName = projectNameInput.value.trim();
            const genre = genreInput.value.trim();

            // P1-14（v4.27）：防重复提交 + 复用共享校验（长度/保留名/重名）
            if (createButton.disabled) return;

            if (!genre) {
                new Notice('❌ 请输入或选择题材', 3000);
                return;
            }

            let existingNames: string[] = [];
            try {
                const projects = await this.plugin.ctxManager.detectProjects();
                existingNames = projects.map((p) => String(p).split('/').pop() || p);
            } catch { /* 扫描失败不阻断创建，交给后续重名检查 */ }
            const validation = validateProjectName(projectName, existingNames);
            if (!validation.valid) {
                new Notice(`❌ ${validation.error}`, 6000);
                return;
            }

            const storySettings = storyEditor.getValue();
            const creationMeta: CreationModeMeta = {
                mode: 'long',
                shortCategory: '',
                scriptGenre: '',
                targetWords: CREATION_MODE_SPECS.long.targetWords.default,
                targetUnits: CREATION_MODE_SPECS.long.targetUnits.default,
                storyStructure: storySettings.structureId,
                storySettings,
            };
            void creationMeta;
            createButton.disabled = true;
            createButton.setText('创建中…');
            try {
                await this.createProject(validation.normalized, genre, descriptionInput.value.trim(), projectType, sourceInput.value.trim(), sourceWorldInput.value.trim(), creationMeta);
            } catch (e) {
                const errMsg = e instanceof Error ? e.message : String(e);
                log.error('[小说工坊] 创建项目失败:', e);
                new Notice(`❌ 创建项目失败: ${errMsg}`, 8000);
            } finally {
                createButton.disabled = false;
                createButton.setText('创建项目');
            }
        };
    }

    private async createProject(projectName: string, genre: string, description: string, projectType: 'original' | 'fanfic', sourceWork: string, sourceWorldview: string, creationMeta: CreationModeMeta): Promise<void> {
        const result = await createLongNovelProject(this.app, this.plugin, {
            projectName,
            genre,
            description,
            projectType,
            sourceWork,
            sourceWorldview,
            fanficSettingPath: this.selectedFanficSettingPath || undefined,
            creationMeta,
            confirmOverwrite: () => OperationConfirmModal.confirm(this.app, {
                title: '覆盖项目',
                description: `「${projectName}」已存在，覆盖？`,
                confirmText: '确认覆盖',
                cancelText: '取消',
            }),
        });
        if (!result.created) {
            if (result.reason) new Notice(`❌ 未创建项目：${result.reason}`, 6000);
            return;
        }
        try {
            await this.prefill?.onCreated?.(result.projectId);
        } catch (e) {
            log.warn('[小说工坊] 预填项目创建后回调失败:', e);
            new Notice('项目已创建，但后续写入创意资料失败；请手动保存', 8000);
        }
        this.close();
    }


    /**
     * onClose 方法。
     */
    onClose(): void {
        if (this.fanficSettingsOutsideClickHandler) {
            document.removeEventListener('click', this.fanficSettingsOutsideClickHandler);
            this.fanficSettingsOutsideClickHandler = undefined;
        }
        this.selectedFanficSettingPath = '';
        const { contentEl } = this;
        contentEl.empty();
    }
}
