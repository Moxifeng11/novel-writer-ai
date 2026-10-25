import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine, BatchEntityResult } from '../engine/ai-engine';
import { ContextManager } from '../engine/context-manager';
import { mkdirp, showSuccess, showWarning, showError, showProgress, hideProgress } from '../utils/helpers';
import { validateCharacterOutput } from '../shared/template-validator';
import { mergeFanficRequirement } from '../shared/fanfic-rules';
import { readFanficPromptBlockWithNotice } from './fanfic-prompt-notice';
import { ExistingEntityManagerModal } from './existing-entity-manager';
import { pjCharsDir, pjWorldview, pjSettingLib, pjFactionsDir, pjLocsDir, pjItemsDir, SUBDIR_CHARS } from '../shared/paths';
import { saveEntities, formatSaveOutcome } from '../shared/entity-persistence';
import { CharacterGenerator } from '../engine/ai-character-generator';
import { ENGINE_NAMES } from '../engine/engine-registry';
import { CharacterRawData as CharacterData } from '../shared/types';
import { getDegradationNotifier } from '../shared/degradation-notifier';
import { createLogger } from '../shared/logger';


const log = createLogger('GenerateCharacterModal');
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
    private _integrityFailures: string[] = [];
    private _currentProject: string = '';
    private _abortController: AbortController | null = null;

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
        // 取消正在进行的AI调用
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
            log.info('[小说工坊] 实体生成已取消');
        }
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
        titleBar.createEl('h2', { text: '👤 生成人物' });
        const manageBtn = titleBar.createEl('button', { text: '📂 管理人物', cls: 'nw-gen-modal-manage-btn' });

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
            const countInput = countRow.createEl('input', { type: 'number', value: '5', cls: 'nw-input nw-gen-modal-count-input' });
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

            // 脉冲动画进度条
            const progressBarTrack = contentEl.createDiv({ cls: 'nw-gen-modal-progress-bar' });
            const progressBarFill = progressBarTrack.createDiv({ cls: 'nw-gen-modal-progress-fill' });

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

                if (!this.plugin.hasAiCredentials) { new Notice('❌ 请先配置 API 密钥或本地模型端点', 5000); return; }

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
                const basePrompt = isEarlyStage
                    ? (prompt ? `${EARLY_STAGE_HINT}${prompt}` : EARLY_STAGE_HINT.trim())
                    : prompt;
                // 同人项目的人物必须落在原作体系内（性格/力量体系/关系不得与原作冲突），
                // 否则人物卡会成为后续 OOC 检测的错误基准
                const fanficBlock = await readFanficPromptBlockWithNotice(this.app, project);
                const effectivePrompt = mergeFanficRequirement(fanficBlock, basePrompt);

                // 创建取消控制器
                this._abortController = new AbortController();
                this._integrityFailures = [];
                const signal = this._abortController.signal;

                // 立即显示进度反馈，消除黑盒感
                generateButton.disabled = true;
                const modelName = this.plugin.settings.flashModel || this.plugin.settings.defaultModel || 'AI';
                generateButton.setText(`⏳ 正在生成 ${count} 个人物（模型：${modelName}）...`);
                progressLabel.style.display = 'block';
                progressLabel.setText(`⏳ 准备中...（模型：${modelName}）`);
                progressBarTrack.style.display = 'block';
                progressBarFill.addClass('nw-progress-anim');
                // P0-2 修复: 后台窗口 rAF 不触发会导致永久挂起，改用 setTimeout 让出执行权
                await new Promise(r => setTimeout(r, 16));

                let worldView = '';
                try {
                    const wf = this.app.vault.getAbstractFileByPath(pjWorldview(project));
                    if (wf instanceof TFile) worldView = await this.app.vault.read(wf);
                } catch (e) { log.warn('[小说工坊] 操作异常:', e instanceof Error ? e.message : e); }

                if (!worldView) { new Notice('⚠️ 未找到世界观总览，建议先生成世界观', 5000); }

                // 读取设定库
                let settingLib = '';
                try {
                    const sf = this.app.vault.getAbstractFileByPath(pjSettingLib(project));
                    if (sf instanceof TFile) {
                        settingLib = await this.app.vault.read(sf);
                        // 设定库只有注释占位符时视为空
                        if (settingLib.trim().replace(/<!--[\s\S]*?-->/g, '').trim().length === 0) {
                            settingLib = '';
                        }
                    }
                } catch (e) { log.warn('[小说工坊] 读取设定库失败:', e instanceof Error ? e.message : e); }

                // 收集已有实体摘要
                const existingEntities = await this.collectExistingEntities(project);

                // 更新进度文字为生成中
                progressLabel.setText(`⏳ AI 正在批量创作中...（模型：${modelName}）`);

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
                            } catch (e) { log.warn('[小说工坊] 读取人物文件失败:', file?.path, e instanceof Error ? e.message : e); }
                        }
                        isFirstCharacter = !hasProtagonist;
                    }
                } catch (e) { isFirstCharacter = false; }

                let result;
                try {
                    result = await this.aiEngine.generateCharacters(worldView, count, effectivePrompt, undefined, isFirstCharacter, nameList, settingLib, signal, existingEntities);
                } catch (e: any) {
                    new Notice(`❌ AI调用失败: ${e?.message || e}`, 8000);
                    log.error('[生成人物] AI异常:', e);
                    generateButton.disabled = false; generateButton.setText('🚀 批量生成人物'); progressLabel.style.display = 'none'; progressBarTrack.style.display = 'none'; progressBarFill.removeClass('nw-progress-anim');
                    return;
                }

                if (signal.aborted) { log.info('[小说工坊] 生成已取消，跳过后续处理'); return; }

                if (result.error) {
                    new Notice(`❌ 人物生成失败: ${result.error}`, 8000);
                    generateButton.disabled = false; generateButton.setText('🚀 批量生成人物'); progressLabel.style.display = 'none'; progressBarTrack.style.display = 'none'; progressBarFill.removeClass('nw-progress-anim');
                    return;
                }

                let characters = await this.parseCharacters(result.content, count, signal);
                if (signal.aborted) { log.info('[小说工坊] 生成已取消，跳过后续处理'); return; }
                const allBlocks = this.splitCharacterBlocks(result.content, count);

                const MAX_RETRIES = 2;
                for (let retry = 0; retry < MAX_RETRIES && characters.length < count; retry++) {
                    const missingCount = count - characters.length;
                    if (missingCount <= 0) break;
                    if (signal.aborted) { break; }
                    log.info(`[小说工坊] 人物补全第${retry + 1}轮：已有 ${characters.length}/${count}，还需 ${missingCount} 个`);
                    new Notice(`⏳ 正在补全 ${missingCount} 个不完整人物...`, 2000);
                    try {
                        const retryResult = await this.aiEngine.generateCharacters(
                            worldView, missingCount,
                            prompt ? `${prompt}\n\n【注意】之前生成的人物中有不完整的被丢弃，请重新生成 ${missingCount} 个全新的、完整的人物卡。确保每个字段都有内容，不要用待补充。` :
                                `请重新生成 ${missingCount} 个全新的、完整的人物卡。确保每个字段都有内容，不要用待补充。`,
                            undefined, isFirstCharacter && characters.length === 0, nameList, settingLib, signal, existingEntities
                        );
                        if (retryResult.error) break;
                        const newChars = await this.parseCharacters(retryResult.content, missingCount, signal);
                        for (const nc of newChars) {
                            if (characters.length >= count) break;
                            if (!characters.find(c => c.name === nc.name)) {
                                characters.push(nc);
                            }
                        }
                    } catch (e) { log.warn('[小说工坊] 人物补全重试失败:', e instanceof Error ? e.message : e); break; }
                }

                characters = characters.slice(0, count);

                this._pendingResults = characters.map(c => ({
                    entity: { name: c.name, content: c.rawContent },
                    deleted: false, modified: false, validated: true
                }));
                this._abortController = null;
                if (this._integrityFailures.length > 0) {
                    new Notice(
                        `⚠️ ${this._integrityFailures.length} 个人物未通过完整性校验，已丢弃（不落盘）：\n${this._integrityFailures.slice(0, 5).join('\n')}${this._integrityFailures.length > 5 ? '\n…' : ''}`,
                        12000
                    );
                }
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
                        nameSpan.setText(`👤 ${managed.entity.name}`);
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
        const outcome = await saveEntities(
            this.app,
            this._currentProject,
            'characters',
            toSave.map(managed => ({ name: managed.entity.name, content: managed.entity.content }))
        );
        const createdCount = outcome.saved.length + outcome.renamed.length;

        showSuccess(formatSaveOutcome(outcome, 'characters'));
        await this.ensureProtagonistMarked(this._currentProject);

        // 保存成功后显示引导，不立即关闭
        const { contentEl } = this;
        contentEl.empty();
        const successDiv = contentEl.createDiv({ cls: 'nw-gen-modal-success' });
        successDiv.style.cssText = 'padding:40px 20px; text-align:center;';
        successDiv.createEl('div', { text: '✅', attr: { style: 'font-size:48px; margin-bottom:16px;' } });
        successDiv.createEl('h3', { text: `已保存 ${createdCount} 个${entityLabel}`, attr: { style: 'color:var(--text-normal); margin-bottom:8px;' } });
        successDiv.createEl('p', { text: '实体已保存到磁盘，关闭窗口后将在向导中自动标记为已完成。', attr: { style: 'color:var(--text-muted); font-size:var(--nw-font-size-base, 13px);' } });
        
        const btnBar = successDiv.createDiv({ attr: { style: 'display:flex; gap:12px; justify-content:center; margin-top:24px;' } });
        const nextBtn = btnBar.createEl('button', { text: '下一步 →' });
        nextBtn.style.cssText = 'padding:8px 24px; border-radius:6px; border:none; background:var(--text-accent); color:white; cursor:pointer; font-weight:600;';
        nextBtn.onclick = () => this.close();
        const closeBtn = btnBar.createEl('button', { text: '关闭' });
        closeBtn.style.cssText = 'padding:8px 24px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-secondary); cursor:pointer;';
        closeBtn.onclick = () => this.close();
    }

    private async ensureProtagonistMarked(project: string): Promise<void> {
        try {
            const projectPath = pjCharsDir(project);
            const files = this.app.vault.getFiles().filter(f => f.path.startsWith(projectPath) && f.path.endsWith('.md'));
            if (files.length === 0) return;
            const contents = await Promise.all(
                files.map(f => this.app.vault.read(f).catch(() => ''))
            );
            const protagonistIdx = contents.findIndex(c => c.includes('身份：主角') || c.includes('身份: 主角'));
            if (protagonistIdx === -1) {
                const firstFile = files[0];
                const content = contents[0];
                const updated = content.replace(
                    /(身份[：:]\s*)([^\n]*)/,
                    '$1主角'
                );
                if (updated !== content) {
                    await this.app.vault.modify(firstFile, updated);
                    log.info('[小说工坊] 已自动标记主角:', firstFile.path);
                }
            }
        } catch (e) { log.warn('[小说工坊] 标记主角失败:', e instanceof Error ? e.message : e); }
    }

    private async collectExistingEntities(project: string): Promise<string> {
        const summaries: string[] = [];
        const dirs = [
            { path: pjCharsDir(project), label: '人物' },
            { path: pjFactionsDir(project), label: '势力' },
            { path: pjLocsDir(project), label: '地点' },
            { path: pjItemsDir(project), label: '物品功法' }
        ];
        for (const dir of dirs) {
            try {
                const files = this.app.vault.getFiles().filter(f => f.path.startsWith(dir.path) && f.path.endsWith('.md'));
                if (files.length === 0) continue;
                const contents = await Promise.all(files.map(f => this.app.vault.read(f).catch(() => '')));
                for (let i = 0; i < files.length; i++) {
                    const content = contents[i];
                    // 提取YAML frontmatter中的关键字段
                    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
                    if (fmMatch) {
                        const fm = fmMatch[1];
                        const name = fm.match(/姓名:\s*(.+)/)?.[1]?.trim() || fm.match(/名称:\s*(.+)/)?.[1]?.trim() || files[i].basename;
                        const identity = fm.match(/身份:\s*(.+)/)?.[1]?.trim() || fm.match(/类型:\s*(.+)/)?.[1]?.trim() || '';
                        const faction = fm.match(/所属势力:\s*(.+)/)?.[1]?.trim() || '';
                        const location = fm.match(/所在地点:\s*(.+)/)?.[1]?.trim() || '';
                        const summary = `【${dir.label}】${name}${identity ? `（${identity}）` : ''}${faction ? ` | 所属：${faction}` : ''}${location ? ` | 位于：${location}` : ''}`;
                        summaries.push(summary);
                    }
                }
            } catch (e) { log.warn(`[小说工坊] 收集${dir.label}摘要失败:`, e); }
        }
        return summaries.length > 0 ? summaries.join('\n') : '';
    }

    private async parseCharacters(content: string, expectedCount?: number, signal?: AbortSignal): Promise<CharacterData[]> {
        const characters: CharacterData[] = [];
        const characterBlocks = this.splitCharacterBlocks(content, expectedCount);
        for (const block of characterBlocks) {
            const trimmedBlock = block.trim();
            let validation = validateCharacterOutput(trimmedBlock);
            if (!validation.valid && validation.missingFields.length > 0 && validation.missingFields.length <= 5) {
                // 不完整实体：尝试补全而非丢弃
                const name = this.extractCharacterName(trimmedBlock);
                if (name) {
                    log.info(`[小说工坊] 角色卡 ${name} 缺失字段: ${validation.missingFields.join('、')}，尝试补全`);
                    try {
                        const generator = this.plugin.engineRegistry.get<CharacterGenerator>(ENGINE_NAMES.CHARACTER_GENERATOR);
                        const completed = await generator.completeCharacter(trimmedBlock, validation.missingFields, signal);
                        const reValidation = validateCharacterOutput(completed.trim());
                        if (reValidation.valid) {
                            characters.push({ name, rawContent: completed.trim() });
                            log.info(`[小说工坊] 角色卡 ${name} 补全成功`);
                            continue;
                        } else {
                            log.warn(`[小说工坊] 角色卡 ${name} 补全后仍不完整: ${reValidation.missingFields.join('、')}`);
                            this._integrityFailures.push(`${name}（补全后仍缺：${reValidation.missingFields.slice(0, 4).join('、')}）`);
                            new Notice(`⚠️ 角色「${name}」补全后仍不完整，已丢弃（不落盘）`, 5000);
                            getDegradationNotifier().notify({ source: 'llm', from: 'full', to: 'partial', reason: `角色「${name}」补全后仍缺失字段：${reValidation.missingFields.join('、')}`, severity: 'warning', recoverable: true });
                            continue;
                        }
                    } catch (e) {
                        log.warn(`[小说工坊] 角色卡 ${name} 补全失败:`, e instanceof Error ? e.message : e);
                        this._integrityFailures.push(`${name}（补全失败：${e instanceof Error ? e.message : String(e)}）`);
                        new Notice(`⚠️ 角色「${name}」补全失败，已丢弃（不落盘）`, 5000);
                        getDegradationNotifier().notify({ source: 'llm', from: 'full', to: 'partial', reason: `角色「${name}」补全异常，缺失字段：${validation.missingFields.join('、')}`, severity: 'warning', recoverable: true });
                        continue;
                    }
                }
                continue;
            }
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
