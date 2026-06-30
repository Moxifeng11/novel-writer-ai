import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine, BatchEntityResult } from '../engine/ai-engine';
import { ContextManager } from '../engine/context-manager';
import { mkdirp, showSuccess, showWarning, showError, showProgress, hideProgress } from '../utils/helpers';
import { validateCharacterOutput } from '../shared/template-validator';
import { ExistingEntityManagerModal } from './existing-entity-manager';
import { pjCharsDir, pjCharFile, pjWorldview, SUBDIR_CHARS } from '../shared/paths';

interface CharacterData {
    name: string;
    rawContent: string;
}

interface ManagedEntity {
    entity: BatchEntityResult;
    deleted: boolean;
    modified: boolean;
    validated: boolean;
}

export class GenerateCharacterModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private contextManager: ContextManager;
    private _pendingResults: ManagedEntity[] = [];
    private _currentProject: string = '';

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
        this.contextManager = plugin.ctxManager;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.style.setProperty('max-width', 'min(680px, 90vw)', 'important');
            wrapper.style.setProperty('width', 'min(680px, 90vw)', 'important');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.maxWidth = 'min(680px, 90vw)';
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');

        contentEl.empty();
        this._pendingResults = [];
        this._renderInputForm();
    }

    private _renderInputForm(): void {
        const { contentEl } = this;
        contentEl.empty();

        const titleBar = contentEl.createDiv({ cls: 'nw-gen-modal-titlebar' });
        titleBar.createEl('h2', { text: '👤 生成人物' });
        const manageBtn = titleBar.createEl('button', { text: '📂 管理已生成', cls: 'nw-gen-modal-manage-btn' });

        const projectSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });

        manageBtn.onclick = () => {
            const project = projectSelect.value || this._currentProject;
            if (!project) { new Notice('⚠️ 请先选择项目', 3000); return; }
            this.close();
            new ExistingEntityManagerModal(this.app, this.plugin, project, SUBDIR_CHARS, '👤 人物').open();
        };

        const populate = async () => {
            const projects = await this.contextManager.detectProjects();
            if (projects.length === 0) {
                contentEl.createEl('p', { text: '❌ 未找到项目，请先创建新项目' });
                return;
            }
            projects.forEach(p => projectSelect.createEl('option', { value: p, text: p }));
            const preSelected = this.plugin._pendingEntityProject;
            if (preSelected && projects.includes(preSelected)) {
                projectSelect.value = preSelected;
                this.plugin._pendingEntityProject = null;
            } else if (this._currentProject && projects.includes(this._currentProject)) {
                projectSelect.value = this._currentProject;
            }

            const nameLabel = contentEl.createEl('label', {
                text: '实体名称（逗号分隔，留空由 AI 自动命名）：',
                cls: 'nw-gen-modal-name-label'
            });
            const nameInput = contentEl.createEl('input', {
                type: 'text',
                placeholder: '如：张三, 李四, 王五',
                cls: 'nw-input novel-writer-input'
            });

            const countRow = contentEl.createDiv({ cls: 'nw-gen-modal-count-row' });
            countRow.createEl('label', { text: '生成数量：' });
            const countInput = countRow.createEl('input', { type: 'number', value: '5', cls: 'nw-gen-modal-count-input' });
            countInput.setAttr('min', '1'); countInput.setAttr('max', '20');
            const countHint = countRow.createEl('span', { text: '（AI 自动命名，1-20 个）', cls: 'nw-gen-modal-count-hint' });

            nameInput.oninput = () => {
                const rawNames = nameInput.value.trim();
                const nameList = rawNames ? rawNames.split(/[,，]/).map(n => n.trim()).filter(n => !!n) : [];
                if (nameList.length > 0) {
                    countInput.value = String(nameList.length);
                    countInput.disabled = true;
                    countHint.setText(`已指定 ${nameList.length} 个名称`);
                } else {
                    countInput.disabled = false;
                    countHint.setText('（AI 自动命名，1-20 个）');
                }
            };

            const promptLabel = contentEl.createEl('label', {
                text: '✍️ 提示词（描述你想要的人物特点，AI 将据此生成名字和设定）',
                cls: 'nw-gen-modal-prompt-label'
            });
            const promptInput = contentEl.createEl('textarea', {
                placeholder: '例如：\n- 主角是一个冷酷的杀手，有一个温柔的妹妹\n- 反派是曾经的恩师，因理念分歧走向对立\n- 需要 2 个主角的队友，性格互补\n- 所有人物都要符合都市悬疑风格\n\n留空则由 AI 根据世界观自由发挥',
                cls: 'nw-textarea novel-writer-textarea nw-gen-modal-prompt-textarea'
            });

            const progressLabel = contentEl.createDiv({ cls: 'nw-gen-modal-progress' });

            const generateButton = contentEl.createEl('button', {
                text: '🚀 批量生成人物', cls: 'nw-btn nw-btn-primary novel-writer-primary-button'
            });

            generateButton.onclick = async () => {
                const project = projectSelect.value;
                this._currentProject = project;
                const rawNames = nameInput.value.trim();
                const nameList = rawNames ? rawNames.split(/[,，]/).map(n => n.trim()).filter(n => !!n) : [];
                const count = nameList.length > 0 ? nameList.length : (parseInt(countInput.value, 10) || 5);
                const prompt = promptInput.value.trim();

                if (!this.plugin.settings.apiKey) { new Notice('❌ 请先配置API密钥', 5000); return; }

                const ctx = this.plugin._pendingEntityContext;
                const isEarlyStage = ctx?.isEarlyStage && ctx.project === project;
                if (ctx) this.plugin._pendingEntityContext = null;

                const EARLY_STAGE_HINT = `【前期内容提示】
这是项目前期的核心人物设定。请确保：
1. 每个人物有清晰的身份定位和核心动机
2. 人物关系有明确的起点（不要设计后期才揭露的秘密）
3. 为后续人物弧光留出成长空间
4. 性格特征要鲜明，有代表性
5. 背景故事要有足够细节支撑人物行为逻辑

`;
                const effectivePrompt = isEarlyStage
                    ? (prompt ? `${EARLY_STAGE_HINT}${prompt}` : EARLY_STAGE_HINT.trim())
                    : prompt;

                let worldView = '';
                try {
                    const wf = this.app.vault.getAbstractFileByPath(pjWorldview(project));
                    if (wf instanceof TFile) worldView = await this.app.vault.read(wf);
                } catch (e) { console.warn('[小说工坊] 操作异常:', e instanceof Error ? e.message : e); }

                if (!worldView) { new Notice('⚠️ 未找到世界观总览，建议先生成世界观', 5000); }

                generateButton.disabled = true;
                const modelName = this.plugin.settings.flashModel || this.plugin.settings.defaultModel || 'AI';
                generateButton.setText(`⏳ 正在生成 ${count} 个人物（模型：${modelName}）...`);
                progressLabel.style.display = 'block';
                progressLabel.setText('⏳ AI 正在批量创作中...');

                let isFirstCharacter = false;
                try {
                    const projectPath = pjCharsDir(project);
                    const files = this.app.vault.getFiles().filter(f => f.path.startsWith(projectPath) && f.path.endsWith('.md'));
                    if (files.length === 0) {
                        isFirstCharacter = true;
                    } else {
                        let hasProtagonist = false;
                        for (const file of files) {
                            try {
                                const content = await this.app.vault.read(file);
                                if (content.includes('身份：主角') || content.includes('身份: 主角')) {
                                    hasProtagonist = true;
                                    break;
                                }
                            } catch (e) { console.warn('[小说工坊] 读取人物文件失败:', file?.path, e instanceof Error ? e.message : e); }
                        }
                        isFirstCharacter = !hasProtagonist;
                    }
                } catch (e) { isFirstCharacter = false; }

                let result;
                try {
                    result = await this.aiEngine.generateCharacters(worldView, count, effectivePrompt, undefined, isFirstCharacter, nameList);
                } catch (e: any) {
                    new Notice(`❌ AI调用失败: ${e?.message || e}`, 8000);
                    console.error('[生成人物] AI异常:', e);
                    generateButton.disabled = false; generateButton.setText('🚀 批量生成人物'); progressLabel.style.display = 'none';
                    return;
                }

                if (result.error) {
                    new Notice(`❌ 人物生成失败: ${result.error}`, 8000);
                    generateButton.disabled = false; generateButton.setText('🚀 批量生成人物'); progressLabel.style.display = 'none';
                    return;
                }

                let characters = this.parseCharacters(result.content, count);
                const allBlocks = this.splitCharacterBlocks(result.content, count);

                const MAX_RETRIES = 2;
                for (let retry = 0; retry < MAX_RETRIES && characters.length < count; retry++) {
                    const missingCount = count - characters.length;
                    if (missingCount <= 0) break;
                    console.log(`[小说工坊] 人物补全第${retry + 1}轮：已有 ${characters.length}/${count}，还需 ${missingCount} 个`);
                    new Notice(`⏳ 正在补全 ${missingCount} 个不完整人物...`, 2000);
                    try {
                        const retryResult = await this.aiEngine.generateCharacters(
                            worldView, missingCount,
                            prompt ? `${prompt}\n\n【注意】之前生成的人物中有不完整的被丢弃，请重新生成 ${missingCount} 个全新的、完整的人物卡。确保每个字段都有内容，不要用待补充。` :
                                `请重新生成 ${missingCount} 个全新的、完整的人物卡。确保每个字段都有内容，不要用待补充。`,
                            undefined, isFirstCharacter && characters.length === 0, nameList
                        );
                        if (retryResult.error) break;
                        const newChars = this.parseCharacters(retryResult.content, missingCount);
                        for (const nc of newChars) {
                            if (characters.length >= count) break;
                            if (!characters.find(c => c.name === nc.name)) {
                                characters.push(nc);
                            }
                        }
                    } catch (e) { console.warn('[小说工坊] 人物补全重试失败:', e instanceof Error ? e.message : e); break; }
                }

                characters = characters.slice(0, count);

                this._pendingResults = characters.map(c => ({
                    entity: { name: c.name, content: c.rawContent },
                    deleted: false, modified: false, validated: true
                }));
                this._renderManagementPanel('人物');
            };
        };
        populate();
    }

    private _renderManagementPanel(entityLabel: string): void {
        const { contentEl } = this;
        contentEl.empty();

        const header = contentEl.createDiv({ cls: 'nw-gen-modal-mgmt-header' });
        header.createEl('h3', { text: '📋 生成结果管理' });
        const activeCount = this._pendingResults.filter(r => !r.deleted).length;
        const deletedCount = this._pendingResults.filter(r => r.deleted).length;
        header.createEl('span', {
            text: `${activeCount} 待保存${deletedCount > 0 ? ` / ${deletedCount} 已删除` : ''}`,
            cls: 'nw-gen-modal-mgmt-count'
        });

        const listContainer = contentEl.createDiv({ cls: 'nw-gen-modal-list' });

        this._pendingResults.forEach((managed, idx) => {
            const card = listContainer.createDiv({ cls: `nw-gen-modal-card${managed.deleted ? ' is-deleted' : ''}` });

            const titleRow = card.createDiv({ cls: 'nw-gen-modal-title-row' });

            if (managed.deleted) {
                titleRow.createEl('span', { text: `🗑️ ${managed.entity.name}`, cls: 'nw-gen-modal-deleted-name' });
            } else {
                const nameSpan = titleRow.createEl('span', { text: `👤 ${managed.entity.name}`, cls: 'nw-gen-modal-entity-name' });
                const renameBtn = titleRow.createEl('button', { text: '✏️ 改名', cls: 'nw-gen-modal-sm-btn' });
                renameBtn.onclick = () => {
                    const newName = prompt('输入新名字：', managed.entity.name);
                    if (newName && newName.trim()) {
                        managed.entity.name = newName.trim();
                        managed.modified = true;
                        nameSpan.setText(`👤 ${managed.entity.name}`);
                    }
                };
            }

            const contentPreview = card.createDiv({ cls: 'nw-gen-modal-content-preview' });
            const previewText = managed.entity.content
                ? managed.entity.content.replace(/^---[\s\S]*?---/, '').trim().slice(0, 300)
                : '';
            contentPreview.createEl('pre', { text: previewText || '(空)' });

            const actionRow = card.createDiv({ cls: 'nw-gen-modal-action-row' });
            if (!managed.deleted) {
                const editBtn = actionRow.createEl('button', { text: '✏️ 编辑', cls: 'nw-gen-modal-sm-btn' });
                editBtn.onclick = () => {
                    const newContent = prompt('编辑内容（YAML + 正文）：', managed.entity.content);
                    if (newContent !== null) {
                        managed.entity.content = newContent;
                        managed.modified = true;
                        contentPreview.querySelector('pre')!.textContent = newContent.replace(/^---[\s\S]*?---/, '').trim().slice(0, 300);
                    }
                };
                const delBtn = actionRow.createEl('button', { text: '🗑️ 删除', cls: 'nw-gen-modal-sm-btn nw-gen-modal-del-btn' });
                delBtn.onclick = () => {
                    managed.deleted = true;
                    this._renderManagementPanel(entityLabel);
                };
            } else {
                const restoreBtn = actionRow.createEl('button', { text: '↩️ 恢复', cls: 'nw-gen-modal-sm-btn' });
                restoreBtn.onclick = () => {
                    managed.deleted = false;
                    this._renderManagementPanel(entityLabel);
                };
            }
        });

        const footer = contentEl.createDiv({ cls: 'nw-gen-modal-footer' });
        const saveBtn = footer.createEl('button', {
            text: `💾 保存 ${activeCount} 个${entityLabel}`,
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button'
        });
        saveBtn.onclick = async () => this._saveAllEntities(entityLabel);

        const backBtn = footer.createEl('button', {
            text: '← 返回继续生成', cls: 'nw-btn'
        });
        backBtn.onclick = () => this._renderInputForm();
    }

    private async _saveAllEntities(entityLabel: string): Promise<void> {
        const toSave = this._pendingResults.filter(r => !r.deleted);
        if (toSave.length === 0) { new Notice('⚠️ 没有可保存的实体', 3000); return; }

        await mkdirp(this.app, pjCharsDir(this._currentProject));
        let createdCount = 0;
        for (const managed of toSave) {
            try {
                const charPath = pjCharFile(this._currentProject, managed.entity.name);
                if (!this.app.vault.getAbstractFileByPath(charPath)) {
                    await this.app.vault.create(charPath, managed.entity.content);
                    createdCount++;
                }
            } catch (e) { console.warn(`创建人物 ${managed.entity.name} 失败:`, e instanceof Error ? e.message : e); }
        }

        showSuccess(`已保存 ${createdCount} 个${entityLabel}`);
        await this.ensureProtagonistMarked(this._currentProject);
        this.close();
    }

    private async ensureProtagonistMarked(project: string): Promise<void> {
        try {
            const projectPath = pjCharsDir(project);
            const files = this.app.vault.getFiles().filter(f => f.path.startsWith(projectPath) && f.path.endsWith('.md'));
            let hasProtagonist = false;
            for (const file of files) {
                try {
                    const content = await this.app.vault.read(file);
                    if (content.includes('身份：主角') || content.includes('身份: 主角')) {
                        hasProtagonist = true;
                        break;
                    }
                } catch (e) { console.warn('[小说工坊] 读取人物文件失败:', file?.path, e instanceof Error ? e.message : e); }
            }
            if (!hasProtagonist && files.length > 0) {
                const firstFile = files[0];
                const content = await this.app.vault.read(firstFile);
                const updated = content.replace(
                    /(身份[：:]\s*)([^\n]*)/,
                    '$1主角'
                );
                if (updated !== content) {
                    await this.app.vault.modify(firstFile, updated);
                    console.log('[小说工坊] 已自动标记主角:', firstFile.path);
                }
            }
        } catch (e) { console.warn('[小说工坊] 标记主角失败:', e instanceof Error ? e.message : e); }
    }

    private parseCharacters(content: string, expectedCount?: number): CharacterData[] {
        const characters: CharacterData[] = [];
        const characterBlocks = this.splitCharacterBlocks(content, expectedCount);
        for (const block of characterBlocks) {
            const trimmedBlock = block.trim();
            const validation = validateCharacterOutput(trimmedBlock);
            if (validation.valid) {
                const name = this.extractCharacterName(trimmedBlock);
                if (!name) continue;
                characters.push({ name, rawContent: trimmedBlock });
            }
        }
        return characters;
    }

    private splitCharacterBlocks(content: string, expectedCount?: number): string[] {
        const lines = content.split('\n');
        const dashIndices: number[] = [];
        for (let i = 0; i < lines.length; i++) {
            if (/^---\s*$/.test(lines[i])) dashIndices.push(i);
        }
        if (dashIndices.length < 2) {
            return content.split(/^(?=---\s*$)/m).filter(b => b.trim());
        }
        const expected = typeof expectedCount === 'number' && expectedCount > 0 ? expectedCount : 0;
        const isStandardFormat = expected > 0 ? dashIndices.length >= expected * 2 : dashIndices.length % 2 === 0;
        if (isStandardFormat) {
            const blocks: string[] = [];
            let i = 0;
            while (i < dashIndices.length) {
                const closeIdx = dashIndices[i + 1];
                if (closeIdx === undefined) break;
                let nextOpen = dashIndices.length;
                for (let j = i + 2; j < dashIndices.length; j++) {
                    if (j + 1 < dashIndices.length) { nextOpen = j; break; }
                }
                const blockLines = lines.slice(dashIndices[i], dashIndices[nextOpen] !== undefined ? dashIndices[nextOpen] : lines.length);
                const blockText = blockLines.join('\n').trim();
                if (blockText) blocks.push(blockText);
                i = nextOpen;
            }
            return blocks;
        }
        const blocks: string[] = [];
        for (let k = 0; k < dashIndices.length; k++) {
            const startIdx = dashIndices[k];
            const endIdx = k + 1 < dashIndices.length ? dashIndices[k + 1] : lines.length;
            const blockLines = lines.slice(startIdx, endIdx);
            let blockText = blockLines.join('\n').trim();
            if (!blockText) continue;
            const dashCountInBlock = (blockText.match(/^---\s*$/gm) || []).length;
            if (dashCountInBlock === 1) blockText = blockText + '\n---';
            blocks.push(blockText);
        }
        return blocks;
    }

    private extractCharacterName(content: string): string | null {
        const nameMatch = content.match(/^(?:姓名|名字|名称)[：:]\s*(.+)$/m);
        if (nameMatch) return nameMatch[1].trim();
        const h1Match = content.match(/^#\s+(.+)$/m);
        if (h1Match) return h1Match[1].trim();
        return null;
    }
}
