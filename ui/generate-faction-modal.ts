import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine, BatchEntityResult } from '../engine/ai-engine';
import { ContextManager } from '../engine/context-manager';
import { mkdirp, showSuccess, showWarning, showError } from '../utils/helpers';
import { validateFactionOutput } from '../shared/template-validator';
import { ExistingEntityManagerModal } from './existing-entity-manager';
import { pjFactionsDir, pjFactionFile, pjWorldview, SUBDIR_FACTIONS } from '../shared/paths';

interface ManagedEntity {
    entity: BatchEntityResult;
    deleted: boolean;
    modified: boolean;
    validated: boolean;
}

export class GenerateFactionModal extends Modal {
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
        titleBar.createEl('h2', { text: '🏰 生成势力' });
        const manageBtn = titleBar.createEl('button', { text: '📂 管理已生成', cls: 'nw-gen-modal-manage-btn' });

        const projectSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });

        manageBtn.onclick = () => {
            const project = projectSelect.value || this._currentProject;
            if (!project) { new Notice('⚠️ 请先选择项目', 3000); return; }
            this.close();
            new ExistingEntityManagerModal(this.app, this.plugin, project, SUBDIR_FACTIONS, '🏰 势力').open();
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
                placeholder: '如：青云宗, 天剑门, 暗影会',
                cls: 'nw-input novel-writer-input'
            });

            const countRow = contentEl.createDiv({ cls: 'nw-gen-modal-count-row' });
            countRow.createEl('label', { text: '生成数量：' });
            const countInput = countRow.createEl('input', { type: 'number', value: '3', cls: 'nw-gen-modal-count-input' });
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
                text: '✍️ 提示词（描述你想要的势力特点，AI 将据此生成名字和设定）',
                cls: 'nw-gen-modal-prompt-label'
            });
            const promptInput = contentEl.createEl('textarea', {
                placeholder: '例如：\n- 一个隐藏在都市中的神秘组织，掌控着超自然力量\n- 官方的超自然调查机构，与主角亦敌亦友\n- 一个由觉醒者组成的松散联盟\n- 所有势力都要符合都市悬疑风格\n\n留空则由 AI 根据世界观自由发挥',
                cls: 'nw-textarea novel-writer-textarea nw-gen-modal-prompt-textarea'
            });

            const progressLabel = contentEl.createDiv({ cls: 'nw-gen-modal-progress' });

            const generateButton = contentEl.createEl('button', {
                text: '🚀 批量生成势力', cls: 'nw-btn nw-btn-primary novel-writer-primary-button'
            });

            generateButton.onclick = async () => {
                const project = projectSelect.value;
                this._currentProject = project;
                const rawNames = nameInput.value.trim();
                const nameList = rawNames ? rawNames.split(/[,，]/).map(n => n.trim()).filter(n => !!n) : [];
                const count = nameList.length > 0 ? nameList.length : (parseInt(countInput.value, 10) || 3);
                const prompt = promptInput.value.trim();

                if (!this.plugin.settings.apiKey) { new Notice('❌ 请先配置API密钥', 5000); return; }

                const ctx = this.plugin._pendingEntityContext;
                const isEarlyStage = ctx?.isEarlyStage && ctx.project === project;
                if (ctx) this.plugin._pendingEntityContext = null;

                const EARLY_STAGE_HINT = `【前期内容提示】
这是项目前期的核心势力设定。请确保：
1. 每个势力有清晰的定位和核心诉求
2. 势力间关系有明确的起点（盟友/敌对/中立）
3. 为后续势力演变留出空间
4. 势力结构要有层次感（领导层/中层/基层）
5. 势力的核心资源和弱点要明确

`;
                const effectivePrompt = isEarlyStage
                    ? (prompt ? `${EARLY_STAGE_HINT}${prompt}` : EARLY_STAGE_HINT.trim())
                    : prompt;

                let wv = '';
                try { const wf = this.app.vault.getAbstractFileByPath(pjWorldview(project)); if (wf instanceof TFile) wv = await this.app.vault.read(wf); } catch (e) { console.warn("[小说工坊] 操作异常:", e instanceof Error ? e.message : e); }
                if (!wv) { new Notice('⚠️ 未找到世界观总览，建议先生成世界观', 5000); }

                generateButton.disabled = true;
                const modelName = this.plugin.settings.flashModel || this.plugin.settings.defaultModel || 'AI';
                generateButton.setText(`⏳ 正在生成 ${count} 个势力（模型：${modelName}）...`);
                progressLabel.style.display = 'block';
                progressLabel.setText('⏳ AI 正在批量创作中...');

                let results;
                try {
                    results = await this.aiEngine.generateFactionsBatch(wv, nameList, effectivePrompt, count, '');
                } catch (e: any) {
                    new Notice(`❌ AI调用失败: ${e?.message || e}`, 8000);
                    console.error('[生成势力] AI异常:', e);
                    generateButton.disabled = false; generateButton.setText('🚀 批量生成势力'); progressLabel.style.display = 'none';
                    return;
                }
                if (results.length === 0) {
                    new Notice('❌ 生成失败', 8000);
                    generateButton.disabled = false; generateButton.setText('🚀 批量生成势力'); progressLabel.style.display = 'none';
                    return;
                }

                this._pendingResults = results.map(r => ({ entity: r, deleted: false, modified: false, validated: false }));
                this._renderManagementPanel('势力');
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
                const nameSpan = titleRow.createEl('span', { text: `🏰 ${managed.entity.name}`, cls: 'nw-gen-modal-entity-name' });
                const renameBtn = titleRow.createEl('button', { text: '✏️ 改名', cls: 'nw-gen-modal-sm-btn' });
                renameBtn.onclick = () => {
                    const newName = prompt('输入新名字：', managed.entity.name);
                    if (newName && newName.trim()) {
                        managed.entity.name = newName.trim();
                        managed.modified = true;
                        nameSpan.setText(`🏰 ${managed.entity.name}`);
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

        await mkdirp(this.app, pjFactionsDir(this._currentProject));
        let createdCount = 0;
        for (const managed of toSave) {
            try {
                const facPath = pjFactionFile(this._currentProject, managed.entity.name);
                if (!this.app.vault.getAbstractFileByPath(facPath)) {
                    await this.app.vault.create(facPath, managed.entity.content);
                    createdCount++;
                }
            } catch (e) { console.warn(`创建势力 ${managed.entity.name} 失败:`, e instanceof Error ? e.message : e); }
        }

        showSuccess(`已保存 ${createdCount} 个${entityLabel}`);
        this.close();
    }
}
