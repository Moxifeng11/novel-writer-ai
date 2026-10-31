import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine, BatchEntityResult } from '../engine/ai-engine';
import { ContextManager } from '../engine/context-manager';
import { mkdirp, showSuccess, showWarning, showError, showProgress, hideProgress } from '../utils/helpers';
import { validateItemOutput } from '../shared/template-validator';
import { mergeFanficRequirement } from '../shared/fanfic-rules';
import { readFanficPromptBlockWithNotice } from './fanfic-prompt-notice';
import { ExistingEntityManagerModal } from './existing-entity-manager';
import { pjItemsDir, pjWorldview, pjSettingLib, SUBDIR_ITEMS } from '../shared/paths';
import { saveEntities, formatSaveOutcome } from '../shared/entity-persistence';
import { createLogger } from '../shared/logger';
import { nextFrame } from '../shared/yield';


const log = createLogger('GenerateItemModal');
interface ManagedEntity {
    entity: BatchEntityResult;
    deleted: boolean;
    modified: boolean;
    validated: boolean;
}

export class GenerateItemModal extends Modal {
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
            wrapper.addClass('nw-modal-form');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.addClass('nw-entity-scope');
        contentEl.addClass('nw-form-stack');

        contentEl.empty();
        this._pendingResults = [];
        this._renderInputForm();
    }

    onClose(): void {
        super.onClose();
        this.plugin._entityModalJustClosed = true;
        const callbacks = this.plugin._entityModalCloseCallbacks;
        while (callbacks.length > 0) {
            const cb = callbacks.shift();
            try { cb?.(); } catch (e) { log.warn('[小说工坊] 实体Modal关闭回调异常:', e); }
        }
    }

    private _renderInputForm(): void {
        const { contentEl } = this;
        contentEl.empty();

        const titleBar = contentEl.createDiv({ cls: 'nw-gen-modal-titlebar' });
        titleBar.createEl('h2', { text: '⚔️ 生成物品功法' });
        const manageBtn = titleBar.createEl('button', { text: '📂 管理物品功法', cls: 'nw-gen-modal-manage-btn' });

        const projectSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });

        manageBtn.onclick = () => {
            const project = projectSelect.value || this._currentProject;
            if (!project) { new Notice('⚠️ 请先选择项目', 3000); return; }
            this.close();
            new ExistingEntityManagerModal(this.app, this.plugin, project, SUBDIR_ITEMS, '⚔️ 物品功法').open();
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
                placeholder: '如：星辰剑, 九转丹, 天雷诀',
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
                text: '✍️ 提示词（描述你想要的物品/功法特点，AI 将据此生成名字和设定）',
                cls: 'nw-gen-modal-prompt-label'
            });
            const promptInput = contentEl.createEl('textarea', {
                placeholder: '例如：\n- 主角意外获得的玉佩，蕴含神秘力量\n- 反派手中的禁忌法器，可以操控人心\n- 一种稀有的修炼功法，只有特定血脉才能修炼\n- 所有物品都要符合都市悬疑风格\n\n留空则由 AI 根据世界观自由发挥',
                cls: 'nw-textarea novel-writer-textarea nw-gen-modal-prompt-textarea'
            });

            const progressLabel = contentEl.createDiv({ cls: 'nw-gen-modal-progress' });

            // 脉冲动画进度条
            const progressBarTrack = contentEl.createDiv({ cls: 'nw-gen-modal-progress-bar' });
            const progressBarFill = progressBarTrack.createDiv({ cls: 'nw-gen-modal-progress-fill' });

            const generateButton = contentEl.createEl('button', {
                text: '🚀 批量生成物品功法', cls: 'nw-btn nw-btn-primary novel-writer-primary-button'
            });

            generateButton.onclick = async () => {
                const project = projectSelect.value;
                this._currentProject = project;
                const rawNames = nameInput.value.trim();
                const nameList = rawNames ? rawNames.split(/[,，]/).map(n => n.trim()).filter(n => !!n) : [];
                const count = nameList.length > 0 ? nameList.length : (parseInt(countInput.value, 10) || 3);
                const prompt = promptInput.value.trim();

                if (!this.plugin.hasAiCredentials) { new Notice('❌ 请先配置 API 密钥或本地模型端点', 5000); return; }

                const ctx = this.plugin._pendingEntityContext;
                const isEarlyStage = ctx?.isEarlyStage && ctx.project === project;
                if (ctx) this.plugin._pendingEntityContext = null;

                const EARLY_STAGE_HINT = `【前期内容提示】
这是项目前期的核心物品/功法设定。请确保：
1. 每个物品/功法有清晰的定位和核心功能
2. 物品/功法的获取途径和使用条件要合理
3. 为后续升级和进化留出空间
4. 物品/功法的稀有度和强度要平衡
5. 与世界观和势力设定保持一致

`;
                const basePrompt = isEarlyStage
                    ? (prompt ? `${EARLY_STAGE_HINT}${prompt}` : EARLY_STAGE_HINT.trim())
                    : prompt;
                // 同人项目的物品/功法必须落在原作体系内：把原作核心设定与创作规则前置到生成要求里
                const fanficBlock = await readFanficPromptBlockWithNotice(this.app, project);
                const effectivePrompt = mergeFanficRequirement(fanficBlock, basePrompt);

                // 立即显示进度反馈，消除黑盒感
                const originalButtonText = generateButton.textContent || '🚀 批量生成物品功法';
                generateButton.disabled = true;
                const modelName = this.plugin.settings.flashModel || this.plugin.settings.defaultModel || 'AI';
                generateButton.setText(`⏳ 正在生成 ${count} 个物品/功法（模型：${modelName}）...`);
                progressLabel.style.display = 'block';
                progressLabel.setText(`⏳ 准备中...（模型：${modelName}）`);
                progressBarTrack.style.display = 'block';
                progressBarFill.addClass('nw-progress-anim');
                showProgress(`⏳ 正在生成物品功法...（模型：${modelName}）`);
                // 等一帧让进度条先渲染（后台窗口由 nextFrame 内部超时兜底，见 P0-2）
                await nextFrame();

                let wv = '';
                try { const wf = this.app.vault.getAbstractFileByPath(pjWorldview(project)); if (wf instanceof TFile) wv = await this.app.vault.read(wf); } catch (e) { log.warn("[小说工坊] 操作异常:", e instanceof Error ? e.message : e); }
                if (!wv) { new Notice('⚠️ 未找到世界观总览，建议先生成世界观', 5000); }

                // 读取设定库
                let settingLib = '';
                try {
                    const sf = this.app.vault.getAbstractFileByPath(pjSettingLib(project));
                    if (sf instanceof TFile) {
                        settingLib = await this.app.vault.read(sf);
                        if (settingLib.trim().replace(/<!--[\s\S]*?-->/g, '').trim().length === 0) {
                            settingLib = '';
                        }
                    }
                } catch (e) { log.warn('[小说工坊] 读取设定库失败:', e instanceof Error ? e.message : e); }

                // 更新进度文字为生成中
                progressLabel.setText(`⏳ AI 正在批量创作中...（模型：${modelName}）`);

                let results;
                try {
                    results = await this.aiEngine.generateItemsBatch(wv, nameList, effectivePrompt, count, '', undefined, settingLib);
                } catch (e: any) {
                    hideProgress();
                    new Notice(`❌ AI调用失败: ${e?.message || e}`, 8000);
                    log.error('[生成物品] AI异常:', e);
                    generateButton.disabled = false; generateButton.setText(originalButtonText); progressLabel.style.display = 'none'; progressBarTrack.style.display = 'none'; progressBarFill.removeClass('nw-progress-anim');
                    return;
                }
                if (results.length === 0) {
                    hideProgress();
                    new Notice('❌ 生成失败', 8000);
                    generateButton.disabled = false; generateButton.setText(originalButtonText); progressLabel.style.display = 'none'; progressBarTrack.style.display = 'none'; progressBarFill.removeClass('nw-progress-anim');
                    return;
                }

                hideProgress();
                showSuccess(`已生成 ${results.length} 个物品功法`);
                this._pendingResults = results.map(r => ({ entity: r, deleted: false, modified: false, validated: false }));
                this._renderManagementPanel('物品功法');
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
                const nameSpan = titleRow.createEl('span', { text: `⚔️ ${managed.entity.name}`, cls: 'nw-gen-modal-entity-name' });
                const renameBtn = titleRow.createEl('button', { text: '✏️ 改名', cls: 'nw-gen-modal-sm-btn' });
                renameBtn.onclick = () => {
                    const existing = card.querySelector('.rename-inline');
                    if (existing) { existing.remove(); renameBtn.setText('✏️ 改名'); return; }
                    renameBtn.setText('✏️ 收起');
                    const inline = card.createDiv({ cls: 'rename-inline' });
                    inline.style.cssText = 'display:flex; gap:6px; align-items:center; margin-top:6px;';
                    const input = inline.createEl('input', { type: 'text', value: managed.entity.name });
                    input.style.cssText = 'flex:1; font-size:var(--nw-font-size-sm, 12px); padding:4px 8px; border:1px solid var(--interactive-accent); border-radius:4px;';
                    const confirmBtn = inline.createEl('button', { text: '✅ 确认' });
                    confirmBtn.style.cssText = 'font-size:var(--nw-font-size-sm, 12px); padding:4px 8px; cursor:pointer; background:var(--interactive-accent); color:var(--text-on-accent); border:none; border-radius:4px; white-space:nowrap;';
                    confirmBtn.onclick = () => {
                        const nm = input.value;
                        if (!nm || !nm.trim()) { inline.remove(); renameBtn.setText('✏️ 改名'); return; }
                        managed.entity.name = nm.trim();
                        managed.modified = true;
                        nameSpan.setText(`⚔️ ${managed.entity.name}`);
                        inline.remove();
                        renameBtn.setText('✏️ 改名');
                    };
                    const cancelBtn = inline.createEl('button', { text: '取消' });
                    cancelBtn.style.cssText = 'font-size:var(--nw-font-size-sm, 12px); padding:4px 8px; cursor:pointer; border:1px solid var(--background-modifier-border); border-radius:4px; white-space:nowrap;';
                    cancelBtn.onclick = () => { inline.remove(); renameBtn.setText('✏️ 改名'); };
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') confirmBtn.click();
                        if (e.key === 'Escape') cancelBtn.click();
                    });
                    input.focus();
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
                    const exist = card.querySelector('.entity-editor');
                    if (exist) { exist.remove(); editBtn.setText('📝 编辑'); return; }
                    editBtn.setText('📝 收起');
                    const ed = card.createDiv({ cls: 'entity-editor' });
                    ed.style.cssText = 'margin-top:8px;';
                    const ta = ed.createEl('textarea');
                    ta.value = managed.entity.content;
                    ta.style.cssText = 'width:100%; min-height:240px; font-size:var(--nw-font-size-sm, 12px); font-family:monospace; box-sizing:border-box;';
                    const br = ed.createDiv();
                    br.style.cssText = 'display:flex; gap:6px; margin-top:6px;';
                    const sb = br.createEl('button', { text: '💾 暂存修改' });
                    sb.style.cssText = 'font-size:var(--nw-font-size-sm, 12px); padding:4px 10px; cursor:pointer;';
                    sb.onclick = () => {
                        managed.entity.content = ta.value;
                        managed.modified = true;
                        contentPreview.querySelector('pre')!.textContent = ta.value.replace(/^---[\s\S]*?---/, '').trim().slice(0, 300);
                        ed.remove();
                        editBtn.setText('📝 编辑');
                    };
                    const cb = br.createEl('button', { text: '取消' });
                    cb.style.cssText = 'font-size:var(--nw-font-size-sm, 12px); padding:4px 10px; cursor:pointer;';
                    cb.onclick = () => { ed.remove(); editBtn.setText('📝 编辑'); };
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
        saveBtn.onclick = async () => this._saveAllEntities();

        const backBtn = footer.createEl('button', {
            text: '← 返回继续生成', cls: 'nw-btn'
        });
        backBtn.onclick = () => this._renderInputForm();
    }

    private async _saveAllEntities(): Promise<void> {
        const toSave = this._pendingResults.filter(r => !r.deleted);
        if (toSave.length === 0) { new Notice('⚠️ 没有可保存的实体', 3000); return; }

        await mkdirp(this.app, pjItemsDir(this._currentProject));
        const outcome = await saveEntities(
            this.app,
            this._currentProject,
            'items',
            toSave.map(managed => ({ name: managed.entity.name, content: managed.entity.content }))
        );

        showSuccess(formatSaveOutcome(outcome, 'items'));
        this.close();
    }
}
