/**
 * Scene Outline Controller — 场景细纲面板控制器
 *
 * 功能：
 * - 左侧场景卡片列表（可拖拽排序）
 * - 右侧场景详情编辑器（Tab 分组）
 * - 场景操作：新增/删除/复制/上移/下移/拆分/合并/一键生成
 * - 自动保存（防抖 1s）
 * - 字数统计与完成度标记
 *
 * 集成方式：参考 OutlineTreeController，挂载到 FullWriterView 侧边栏
 */

import { App, TFile, Notice } from 'obsidian';
import { ExtendedSceneData, createDefaultScene, SceneStatus } from '../../shared/types';
import { pjStepDir, pjStepFile } from '../../shared/paths';
import { parseChineseNumber } from '../../engine/scene-expander';
import { createLogger } from '../../shared/logger';


const log = createLogger('SceneOutlineController');
/** 场景细纲控制器依赖 */
export interface SceneOutlineControllerDeps {
    app: App;
    getProject: () => string | undefined;
    getChapterNum: () => number;
    getVolume: () => string;
    getChapDir: () => string;
    onSceneChange?: () => void;
}

export class SceneOutlineController {
    private deps: SceneOutlineControllerDeps;
    private scenes: ExtendedSceneData[] = [];
    private currentSceneIndex: number = 0;
    private activeTab: 'basic' | 'conflict' | 'foreshadow' = 'basic';
    private originalContent: string = '';
    private saveTimer: number | null = null;
    private isDirty: boolean = false;
    private dragIndex: number | null = null;

    constructor(deps: SceneOutlineControllerDeps) {
        this.deps = deps;
    }

    get app(): App { return this.deps.app; }

    /** 主渲染入口 */
    async render(container: HTMLElement): Promise<void> {
        container.empty();
        const project = this.deps.getProject();
        const chapNum = this.deps.getChapterNum();

        if (!project || chapNum <= 0) {
            container.createDiv({
                text: '请先选择项目和章节',
                attr: { style: 'padding: 20px; color: var(--text-muted); text-align: center;' }
            });
            return;
        }

        await this.loadScenes();

        const wrap = container.createDiv({
            cls: 'nw-scene-outline-container',
            attr: { style: 'display: flex; flex-direction: column; height: 100%; min-height: 0;' }
        });

        this.renderHeader(wrap);
        this.renderMainContent(wrap);
        this.renderFooter(wrap);
        this.injectStyles();
    }

    /** 头部工具栏 */
    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv({
            attr: {
                style: 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--background-modifier-border); flex-shrink: 0;'
            }
        });

        header.createSpan({
            text: '🎬 场景细纲',
            attr: { style: 'font-weight: 600; font-size: 0.95em;' }
        });

        const btnGroup = header.createDiv({ attr: { style: 'display: flex; gap: 4px;' } });

        const addBtn = btnGroup.createEl('button', {
            text: '➕',
            attr: {
                title: '新增场景',
                style: 'padding: 2px 8px; font-size: 0.85em; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer; background: var(--background-secondary);'
            }
        });
        addBtn.onclick = () => this.addScene();

        const genBtn = btnGroup.createEl('button', {
            text: '✨',
            attr: {
                title: '一键生成场景（调用 AI）',
                style: 'padding: 2px 8px; font-size: 0.85em; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer; background: var(--background-secondary);'
            }
        });
        genBtn.onclick = () => this.generateScenes();
    }

    /** 主体内容：左列表 + 右编辑器 */
    private renderMainContent(container: HTMLElement): void {
        const main = container.createDiv({
            attr: { style: 'display: flex; flex: 1; min-height: 0; overflow: hidden;' }
        });

        this.renderSceneList(main);
        this.renderSceneEditor(main);
    }

    /** 左侧场景列表 */
    private renderSceneList(container: HTMLElement): void {
        const listWrap = container.createDiv({
            attr: {
                style: 'width: 180px; flex-shrink: 0; border-right: 1px solid var(--background-modifier-border); display: flex; flex-direction: column; min-height: 0;'
            }
        });

        const listHeader = listWrap.createDiv({
            attr: {
                style: 'padding: 8px 10px; font-size: 0.8em; color: var(--text-muted); border-bottom: 1px solid var(--background-modifier-border);'
            }
        });
        listHeader.setText(`共 ${this.scenes.length} 个场景`);

        const list = listWrap.createDiv({
            attr: { style: 'flex: 1; overflow-y: auto; padding: 4px;' }
        });

        if (this.scenes.length === 0) {
            list.createDiv({
                text: '暂无场景，点击 ➕ 添加',
                attr: { style: 'padding: 20px 10px; text-align: center; color: var(--text-faint); font-size: 0.85em;' }
            });
            return;
        }

        for (let i = 0; i < this.scenes.length; i++) {
            const scene = this.scenes[i];
            const isActive = i === this.currentSceneIndex;
            const isLast = i === this.scenes.length - 1;

            const item = list.createDiv({
                attr: {
                    draggable: 'true',
                    style: `padding: 8px 10px; margin: 2px 0; border-radius: 6px; cursor: pointer; font-size: 0.82em; ${isActive ? 'background: var(--text-accent); color: white;' : 'background: var(--background-secondary) hover: var(--background-modifier-hover);'} ${this.dragIndex === i ? 'opacity: 0.5;' : ''}`,
                    title: scene.name || '(未命名场景)',
                }
            });

            const topRow = item.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 4px;' } });

            const statusDot = topRow.createSpan({
                attr: {
                    style: `width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; ${this.getStatusColor(scene.status)}`
                }
            });

            topRow.createSpan({
                text: `场景${scene.index}`,
                attr: { style: 'font-weight: 600;' }
            });

            if (scene.isKeyScene) {
                topRow.createSpan({ text: '⭐', attr: { style: 'font-size: 0.8em;' } });
            }
            if (isLast && scene.cliffhanger) {
                topRow.createSpan({ text: '🪝', attr: { style: 'font-size: 0.8em;' } });
            }

            const nameRow = item.createDiv({
                attr: {
                    style: `font-size: 0.78em; margin-top: 3px; ${isActive ? 'color: rgba(255,255,255,0.8);' : 'color: var(--text-faint);'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`
                }
            });
            nameRow.setText(scene.name || '(未命名)');

            if (scene.emotionArc) {
                const arcRow = item.createDiv({
                    attr: {
                        style: `font-size: 0.72em; margin-top: 2px; ${isActive ? 'color: rgba(255,255,255,0.6);' : 'color: var(--text-faint);'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`
                    }
                });
                arcRow.setText(scene.emotionArc.slice(0, 20));
            }

            item.addEventListener('click', () => {
                this.currentSceneIndex = i;
                this.refreshEditor();
            });

            item.addEventListener('dragstart', (e) => {
                this.dragIndex = i;
                e.dataTransfer!.effectAllowed = 'move';
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer!.dropEffect = 'move';
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                if (this.dragIndex !== null && this.dragIndex !== i) {
                    this.moveScene(this.dragIndex, i);
                }
                this.dragIndex = null;
            });

            item.addEventListener('dragend', () => {
                this.dragIndex = null;
            });
        }
    }

    /** 状态颜色 */
    private getStatusColor(status: SceneStatus): string {
        switch (status) {
            case 'completed': return 'background: #22c55e;';
            case 'in_progress': return 'background: #f59e0b;';
            default: return 'background: var(--text-faint);';
        }
    }

    /** 右侧场景编辑器 */
    private renderSceneEditor(container: HTMLElement): void {
        const editorWrap = container.createDiv({
            cls: 'nw-scene-editor-wrap',
            attr: { style: 'flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0;' }
        });

        const scene = this.scenes[this.currentSceneIndex];
        if (!scene) {
            editorWrap.createDiv({
                text: '请选择或创建一个场景',
                attr: { style: 'padding: 40px 20px; text-align: center; color: var(--text-muted);' }
            });
            return;
        }

        this.renderEditorToolbar(editorWrap, scene);
        this.renderTabBar(editorWrap);
        this.renderTabContent(editorWrap, scene);
    }

    /** 编辑器工具栏 */
    private renderEditorToolbar(container: HTMLElement, scene: ExtendedSceneData): void {
        const toolbar = container.createDiv({
            attr: {
                style: 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--background-modifier-border); flex-shrink: 0;'
            }
        });

        const titleArea = toolbar.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 8px;' } });

        const statusSelect = titleArea.createEl('select', {
            attr: {
                style: 'padding: 2px 6px; font-size: 0.78em; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary);'
            }
        });
        const statusOptions: { value: SceneStatus; label: string }[] = [
            { value: 'not_started', label: '未开始' },
            { value: 'in_progress', label: '进行中' },
            { value: 'completed', label: '已完成' },
        ];
        statusOptions.forEach(opt => {
            const optEl = statusSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
            if (scene.status === opt.value) optEl.selected = true;
        });
        statusSelect.onchange = () => {
            scene.status = statusSelect.value as SceneStatus;
            this.markDirty();
            this.refreshList();
        };

        titleArea.createSpan({
            text: `场景${scene.index}：${scene.name || '(未命名)'}`,
            attr: { style: 'font-weight: 600; font-size: 0.9em;' }
        });

        const btnGroup = toolbar.createDiv({ attr: { style: 'display: flex; gap: 4px;' } });

        const actionBtns = [
            { icon: '⬆️', title: '上移', action: () => this.moveUp() },
            { icon: '⬇️', title: '下移', action: () => this.moveDown() },
            { icon: '📋', title: '复制', action: () => this.duplicateScene() },
            { icon: '✂️', title: '拆分', action: () => this.splitScene() },
            { icon: '🔗', title: '合并下一个', action: () => this.mergeScene() },
            { icon: '🗑️', title: '删除', action: () => this.deleteScene() },
        ];

        actionBtns.forEach(btn => {
            const el = btnGroup.createEl('button', {
                text: btn.icon,
                attr: {
                    title: btn.title,
                    style: 'padding: 2px 6px; font-size: 0.8em; border-radius: 4px; border: 1px solid var(--background-modifier-border); cursor: pointer; background: var(--background-secondary);'
                }
            });
            el.onclick = btn.action;
        });
    }

    /** Tab 切换栏 */
    private renderTabBar(container: HTMLElement): void {
        const tabBar = container.createDiv({
            attr: {
                style: 'display: flex; border-bottom: 1px solid var(--background-modifier-border); flex-shrink: 0;'
            }
        });

        const tabs: { id: 'basic' | 'conflict' | 'foreshadow'; label: string; icon: string }[] = [
            { id: 'basic', label: '基本信息', icon: '📝' },
            { id: 'conflict', label: '冲突爽点', icon: '⚔️' },
            { id: 'foreshadow', label: '伏笔信息', icon: '🔮' },
        ];

        tabs.forEach(tab => {
            const tabEl = tabBar.createDiv({
                attr: {
                    style: `padding: 8px 14px; cursor: pointer; font-size: 0.85em; border-bottom: 2px solid ${this.activeTab === tab.id ? 'var(--text-accent)' : 'transparent'}; ${this.activeTab === tab.id ? 'color: var(--text-accent); font-weight: 600;' : 'color: var(--text-muted);'}`
                }
            });
            tabEl.setText(`${tab.icon} ${tab.label}`);
            tabEl.onclick = () => {
                this.activeTab = tab.id;
                this.refreshEditor();
            };
        });
    }

    /** Tab 内容区 */
    private renderTabContent(container: HTMLElement, scene: ExtendedSceneData): void {
        const content = container.createDiv({
            attr: { style: 'flex: 1; overflow-y: auto; padding: 12px;' }
        });

        switch (this.activeTab) {
            case 'basic':
                this.renderBasicTab(content, scene);
                break;
            case 'conflict':
                this.renderConflictTab(content, scene);
                break;
            case 'foreshadow':
                this.renderForeshadowTab(content, scene);
                break;
        }
    }

    /** 基本信息 Tab */
    private renderBasicTab(container: HTMLElement, scene: ExtendedSceneData): void {
        this.createTextInput(container, '场景名称', 'name', scene);
        this.createTextArea(container, '🎯 场景目标 (objective)', 'objective', scene);
        this.createTextInput(container, '👥 出场人物', 'characters', scene);
        this.createTextInput(container, '📍 场景地点', 'location', scene);
        this.createTextInput(container, '⏱️ 时间线位置', 'timelinePosition', scene);
        this.createTextArea(container, '🎭 情绪弧线 (emotion_arc)', 'emotionArc', scene);
        this.createTextArea(container, '👁️ 感官入口 (sensory_hook)', 'sensoryHook', scene);
        this.createTextArea(container, '💭 记忆触发 (memory_trigger)', 'memoryTrigger', scene);
        this.createTextArea(container, '💓 身体反应 (body_reaction)', 'bodyReaction', scene);
        this.createTextArea(container, '🤐 潜台词 (subtext)', 'subtext', scene);
        this.createTextArea(container, '🔗 关系变化 (relationship_shift)', 'relationshipShift', scene);
        this.createTextArea(container, '💬 对话功能 (dialogue_function)', 'dialogueFunction', scene);

        const keySceneRow = container.createDiv({
            attr: { style: 'display: flex; align-items: center; gap: 8px; margin: 10px 0;' }
        });
        const keySceneCheckbox = keySceneRow.createEl('input', {
            attr: { type: 'checkbox' }
        }) as HTMLInputElement;
        keySceneCheckbox.checked = scene.isKeyScene;
        keySceneCheckbox.onchange = () => {
            scene.isKeyScene = keySceneCheckbox.checked;
            scene.keyScene = scene.isKeyScene ? '⭐ 名场面 — 待补充原因' : '否';
            this.markDirty();
            this.refreshList();
        };
        keySceneRow.createSpan({
            text: '⭐ 标记为名场面',
            attr: { style: 'font-size: 0.85em;' }
        });

        if (scene.isKeyScene) {
            this.createTextArea(container, '名场面原因 (key_scene)', 'keyScene', scene);
        }

        const isLast = this.currentSceneIndex === this.scenes.length - 1;
        if (isLast) {
            this.createTextArea(container, '🪝 结尾钩子 (cliffhanger)', 'cliffhanger', scene);
        }
    }

    /** 冲突爽点 Tab */
    private renderConflictTab(container: HTMLElement, scene: ExtendedSceneData): void {
        this.createTextArea(container, '⚔️ 核心冲突 (conflict)', 'conflict', scene);

        const typeRow = container.createDiv({
            attr: { style: 'display: flex; gap: 12px; margin: 10px 0;' }
        });

        const conflictTypeWrap = typeRow.createDiv({ attr: { style: 'flex: 1;' } });
        conflictTypeWrap.createEl('div', {
            text: '冲突类型',
            attr: { style: 'font-size: 0.82em; color: var(--text-muted); margin-bottom: 4px; font-weight: 500;' }
        });
        const conflictSelect = conflictTypeWrap.createEl('select', {
            attr: {
                style: 'width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); font-size: 0.85em; background: var(--background-primary);'
            }
        });
        const conflictOptions = [
            { value: '', label: '未分类' },
            { value: 'internal', label: '内在冲突' },
            { value: 'external', label: '外在冲突' },
            { value: 'interpersonal', label: '人际冲突' },
        ];
        conflictOptions.forEach(opt => {
            const optEl = conflictSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
            if (scene.conflictType === opt.value) optEl.selected = true;
        });
        conflictSelect.onchange = () => {
            scene.conflictType = conflictSelect.value as any;
            this.markDirty();
        };

        const pleasureWrap = typeRow.createDiv({ attr: { style: 'flex: 1;' } });
        pleasureWrap.createEl('div', {
            text: '爽点类型',
            attr: { style: 'font-size: 0.82em; color: var(--text-muted); margin-bottom: 4px; font-weight: 500;' }
        });
        const pleasureSelect = pleasureWrap.createEl('select', {
            attr: {
                style: 'width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); font-size: 0.85em; background: var(--background-primary);'
            }
        });
        const pleasureOptions = [
            { value: '', label: '未分类' },
            { value: 'face_slap', label: '打脸' },
            { value: 'level_up', label: '升级' },
            { value: 'reveal', label: '揭秘' },
            { value: 'gain', label: '收获' },
        ];
        pleasureOptions.forEach(opt => {
            const optEl = pleasureSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
            if (scene.pleasureType === opt.value) optEl.selected = true;
        });
        pleasureSelect.onchange = () => {
            scene.pleasureType = pleasureSelect.value as any;
            this.markDirty();
        };
    }

    /** 伏笔信息 Tab */
    private renderForeshadowTab(container: HTMLElement, scene: ExtendedSceneData): void {
        this.createTextArea(container, '📖 信息增量（本章新披露的设定/信息）', 'infoIncrement', scene);
        this.createTextArea(container, '🌱 伏笔埋设', 'foreshadowPlant', scene);
        this.createTextArea(container, '🎯 伏笔回收', 'foreshadowRecover', scene);

        const statsRow = container.createDiv({
            attr: {
                style: 'margin-top: 16px; padding: 12px; background: var(--background-secondary); border-radius: 8px;'
            }
        });
        statsRow.createEl('div', {
            text: '📊 场景统计',
            attr: { style: 'font-weight: 600; margin-bottom: 8px; font-size: 0.9em;' }
        });

        const wordEstimateWrap = statsRow.createDiv({
            attr: { style: 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;' }
        });
        wordEstimateWrap.createSpan({
            text: '预估字数：',
            attr: { style: 'font-size: 0.85em; color: var(--text-muted);' }
        });
        const wordInput = wordEstimateWrap.createEl('input', {
            attr: {
                type: 'number',
                value: String(scene.wordCountEstimate || 0),
                style: 'width: 80px; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--background-modifier-border); font-size: 0.85em;'
            }
        }) as HTMLInputElement;
        wordInput.onchange = () => {
            scene.wordCountEstimate = parseInt(wordInput.value) || 0;
            this.markDirty();
        };
        wordEstimateWrap.createSpan({
            text: '字',
            attr: { style: 'font-size: 0.85em; color: var(--text-muted);' }
        });
    }

    /** 创建单行文本输入 */
    private createTextInput(container: HTMLElement, label: string, fieldKey: keyof ExtendedSceneData, scene: ExtendedSceneData): void {
        const wrap = container.createDiv({ attr: { style: 'margin-bottom: 10px;' } });
        wrap.createEl('div', {
            text: label,
            attr: { style: 'font-size: 0.82em; color: var(--text-muted); margin-bottom: 4px; font-weight: 500;' }
        });
        const input = wrap.createEl('input', {
            attr: {
                type: 'text',
                value: String(scene[fieldKey] || ''),
                style: 'width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); font-size: 0.85em; background: var(--background-primary);'
            }
        }) as HTMLInputElement;
        input.addEventListener('input', () => {
            (scene as any)[fieldKey] = input.value;
            this.markDirty();
            if (fieldKey === 'name') {
                this.refreshList();
            }
            if (fieldKey === 'keyScene') {
                scene.isKeyScene = /⭐|名场面/.test(input.value);
                this.refreshList();
            }
        });
    }

    /** 创建多行文本域 */
    private createTextArea(container: HTMLElement, label: string, fieldKey: keyof ExtendedSceneData, scene: ExtendedSceneData): void {
        const wrap = container.createDiv({ attr: { style: 'margin-bottom: 10px;' } });
        wrap.createEl('div', {
            text: label,
            attr: { style: 'font-size: 0.82em; color: var(--text-muted); margin-bottom: 4px; font-weight: 500;' }
        });
        const value = String(scene[fieldKey] || '');
        const textarea = wrap.createEl('textarea', {
            attr: {
                style: 'width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); font-size: 0.85em; resize: vertical; min-height: 60px; background: var(--background-primary);',
            }
        }) as HTMLTextAreaElement;
        textarea.value = value;
        textarea.addEventListener('input', () => {
            (scene as any)[fieldKey] = textarea.value;
            this.markDirty();
        });
    }

    /** 底部状态栏 */
    private renderFooter(container: HTMLElement): void {
        const footer = container.createDiv({
            attr: {
                style: 'display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-top: 1px solid var(--background-modifier-border); font-size: 0.78em; color: var(--text-muted); flex-shrink: 0;'
            }
        });

        const totalWords = this.scenes.reduce((sum, s) => sum + (s.wordCountEstimate || 0), 0);
        const completed = this.scenes.filter(s => s.status === 'completed').length;

        footer.createSpan({ text: `预估总字数: ${totalWords} 字` });
        footer.createSpan({ text: `进度: ${completed}/${this.scenes.length}` });

        if (this.isDirty) {
            const saveIndicator = footer.createSpan({
                text: '⏳ 自动保存中...',
                attr: { style: 'color: var(--text-warning);' }
            });
        }
    }

    // ============================================================
    // 场景操作方法
    // ============================================================

    /** 新增场景 */
    private addScene(): void {
        const newIndex = this.scenes.length + 1;
        const newScene = createDefaultScene(newIndex);
        newScene.name = `新场景${newIndex}`;
        this.scenes.push(newScene);
        this.currentSceneIndex = this.scenes.length - 1;
        this.markDirty();
        this.refreshAll();
    }

    /** 删除场景 */
    private deleteScene(): void {
        if (this.scenes.length <= 1) {
            new Notice('⚠️ 至少保留一个场景', 2000);
            return;
        }
        if (!confirm(`确定删除场景${this.scenes[this.currentSceneIndex].index}吗？`)) return;

        this.scenes.splice(this.currentSceneIndex, 1);
        this.reindexScenes();
        if (this.currentSceneIndex >= this.scenes.length) {
            this.currentSceneIndex = this.scenes.length - 1;
        }
        this.markDirty();
        this.refreshAll();
    }

    /** 复制场景 */
    private duplicateScene(): void {
        const source = this.scenes[this.currentSceneIndex];
        const copy: ExtendedSceneData = JSON.parse(JSON.stringify(source));
        copy.index = this.currentSceneIndex + 2;
        copy.name = source.name + ' (副本)';
        this.scenes.splice(this.currentSceneIndex + 1, 0, copy);
        this.reindexScenes();
        this.currentSceneIndex++;
        this.markDirty();
        this.refreshAll();
    }

    /** 上移 */
    private moveUp(): void {
        if (this.currentSceneIndex <= 0) return;
        const temp = this.scenes[this.currentSceneIndex];
        this.scenes[this.currentSceneIndex] = this.scenes[this.currentSceneIndex - 1];
        this.scenes[this.currentSceneIndex - 1] = temp;
        this.reindexScenes();
        this.currentSceneIndex--;
        this.markDirty();
        this.refreshAll();
    }

    /** 下移 */
    private moveDown(): void {
        if (this.currentSceneIndex >= this.scenes.length - 1) return;
        const temp = this.scenes[this.currentSceneIndex];
        this.scenes[this.currentSceneIndex] = this.scenes[this.currentSceneIndex + 1];
        this.scenes[this.currentSceneIndex + 1] = temp;
        this.reindexScenes();
        this.currentSceneIndex++;
        this.markDirty();
        this.refreshAll();
    }

    /** 拖拽移动 */
    private moveScene(fromIdx: number, toIdx: number): void {
        const [removed] = this.scenes.splice(fromIdx, 1);
        this.scenes.splice(toIdx, 0, removed);
        this.reindexScenes();
        this.currentSceneIndex = toIdx;
        this.markDirty();
        this.refreshAll();
    }

    /** 拆分场景 */
    private splitScene(): void {
        if (this.currentSceneIndex < 0 || this.currentSceneIndex >= this.scenes.length) return;

        const source = this.scenes[this.currentSceneIndex];
        const newScene = createDefaultScene(this.currentSceneIndex + 2);
        newScene.name = source.name + ' (下)';
        newScene.characters = source.characters;
        newScene.location = source.location;

        this.scenes.splice(this.currentSceneIndex + 1, 0, newScene);
        this.reindexScenes();
        this.markDirty();
        this.refreshAll();
        new Notice('✂️ 场景已拆分，新场景已插入', 2000);
    }

    /** 合并场景（与下一个合并） */
    private mergeScene(): void {
        if (this.currentSceneIndex >= this.scenes.length - 1) {
            new Notice('⚠️ 已经是最后一个场景，无法合并', 2000);
            return;
        }

        const current = this.scenes[this.currentSceneIndex];
        const next = this.scenes[this.currentSceneIndex + 1];

        current.name = current.name + ' + ' + next.name;
        current.objective = this.mergeField(current.objective, next.objective);
        current.conflict = this.mergeField(current.conflict, next.conflict);
        current.cliffhanger = next.cliffhanger;
        current.characters = this.mergeField(current.characters, next.characters);
        current.infoIncrement = this.mergeField(current.infoIncrement, next.infoIncrement);
        current.foreshadowPlant = this.mergeField(current.foreshadowPlant, next.foreshadowPlant);
        current.foreshadowRecover = this.mergeField(current.foreshadowRecover, next.foreshadowRecover);
        current.wordCountEstimate = (current.wordCountEstimate || 0) + (next.wordCountEstimate || 0);

        this.scenes.splice(this.currentSceneIndex + 1, 1);
        this.reindexScenes();
        this.markDirty();
        this.refreshAll();
        new Notice('🔗 场景已合并', 2000);
    }

    private mergeField(a: string, b: string): string {
        if (!a && !b) return '';
        if (!a) return b;
        if (!b) return a;
        return a + '\n' + b;
    }

    /** 重新排序场景索引 */
    private reindexScenes(): void {
        this.scenes.forEach((scene, i) => {
            scene.index = i + 1;
        });
    }

    /** 一键生成场景（占位实现，实际调用 AI） */
    private generateScenes(): void {
        new Notice('✨ 场景生成功能需调用 AI 引擎，可在 Scene展开 步骤中生成', 3000);
    }

    // ============================================================
    // 数据加载与保存
    // ============================================================

    /** 加载场景数据 */
    async loadScenes(): Promise<void> {
        const project = this.deps.getProject();
        const chapNum = this.deps.getChapterNum();
        if (!project || chapNum <= 0) return;

        const volume = this.deps.getVolume();
        const volMatch = volume.match(/第(\d+)卷/);
        const volNum = volMatch ? parseInt(volMatch[1]) : 1;

        const filePath = pjStepFile(project, volNum, chapNum, 'Scene展开');
        const file = this.app.vault.getAbstractFileByPath(filePath);

        if (file instanceof TFile) {
            try {
                this.originalContent = await this.app.vault.read(file);
                this.scenes = this.parseScenes(this.originalContent);
                if (this.scenes.length > 0 && this.currentSceneIndex >= this.scenes.length) {
                    this.currentSceneIndex = 0;
                }
            } catch (e) {
                log.warn('[SceneOutline] 加载失败:', e);
                this.scenes = [];
            }
        } else {
            this.scenes = [];
            this.originalContent = '';
        }
    }

    /** 解析场景内容 */
    private parseScenes(content: string): ExtendedSceneData[] {
        const scenes: ExtendedSceneData[] = [];
        const sceneRegex = /^##\s*(?:场景\s*([一二三四五六七八九十百千万亿零〇两]+|\d+)|scene(\d+))\s*[：:]\s*(.+)$/gim;
        const matches: { index: number; name: string; start: number }[] = [];
        let m: RegExpExecArray | null;

        while ((m = sceneRegex.exec(content)) !== null) {
            let num = 0;
            if (m[1] !== undefined) {
                const cnNum = parseChineseNumber(m[1]);
                num = cnNum ?? matches.length + 1;
            } else if (m[2] !== undefined) {
                num = parseInt(m[2], 10);
            } else {
                num = matches.length + 1;
            }
            matches.push({ index: num, name: m[3].trim(), start: m.index });
        }

        for (let i = 0; i < matches.length; i++) {
            const start = matches[i].start;
            const end = i + 1 < matches.length ? matches[i + 1].start : content.length;
            const sceneContent = content.slice(start, end);

            const scene = createDefaultScene(matches[i].index);
            scene.name = matches[i].name;
            scene.objective = this.extractField(sceneContent, 'objective');
            scene.emotionArc = this.extractField(sceneContent, 'emotion_arc');
            scene.conflict = this.extractField(sceneContent, 'conflict');
            scene.sensoryHook = this.extractField(sceneContent, 'sensory_hook');
            scene.memoryTrigger = this.extractField(sceneContent, 'memory_trigger');
            scene.bodyReaction = this.extractField(sceneContent, 'body_reaction');
            scene.subtext = this.extractField(sceneContent, 'subtext');
            scene.relationshipShift = this.extractField(sceneContent, 'relationship_shift');
            scene.keyScene = this.extractField(sceneContent, 'key_scene');
            scene.dialogueFunction = this.extractField(sceneContent, 'dialogue_function');
            scene.cliffhanger = this.extractField(sceneContent, 'cliffhanger');
            scene.isKeyScene = /⭐|名场面/.test(scene.keyScene);

            scene.characters = this.extractField(sceneContent, 'characters') || this.extractField(sceneContent, '出场人物');
            scene.location = this.extractField(sceneContent, 'location') || this.extractField(sceneContent, '场景地点');
            scene.timelinePosition = this.extractField(sceneContent, 'timeline') || this.extractField(sceneContent, '时间线');

            const conflictType = this.extractField(sceneContent, 'conflict_type') || this.extractField(sceneContent, '冲突类型');
            if (conflictType.includes('内在')) scene.conflictType = 'internal';
            else if (conflictType.includes('外在')) scene.conflictType = 'external';
            else if (conflictType.includes('人际')) scene.conflictType = 'interpersonal';

            const pleasureType = this.extractField(sceneContent, 'pleasure_type') || this.extractField(sceneContent, '爽点类型');
            if (pleasureType.includes('打脸')) scene.pleasureType = 'face_slap';
            else if (pleasureType.includes('升级')) scene.pleasureType = 'level_up';
            else if (pleasureType.includes('揭秘')) scene.pleasureType = 'reveal';
            else if (pleasureType.includes('收获')) scene.pleasureType = 'gain';

            scene.infoIncrement = this.extractField(sceneContent, 'info_increment') || this.extractField(sceneContent, '信息增量');
            scene.foreshadowPlant = this.extractField(sceneContent, 'foreshadow_plant') || this.extractField(sceneContent, '伏笔埋设');
            scene.foreshadowRecover = this.extractField(sceneContent, 'foreshadow_recover') || this.extractField(sceneContent, '伏笔回收');

            const wordStr = this.extractField(sceneContent, 'word_count') || this.extractField(sceneContent, '预估字数');
            scene.wordCountEstimate = parseInt(wordStr) || 0;

            const statusStr = this.extractField(sceneContent, 'status') || this.extractField(sceneContent, '状态');
            if (statusStr.includes('完成')) scene.status = 'completed';
            else if (statusStr.includes('进行')) scene.status = 'in_progress';

            scenes.push(scene);
        }

        return scenes;
    }

    /** 提取字段值 */
    private extractField(content: string, field: string): string {
        const regex = new RegExp(`^\\s*\\*?\\*?${field}\\s*[：:]\\s*(.+?)(?=\\n\\s*\\*?\\*?[a-z_\\u4e00-\\u9fa5]+\\s*[：:]|\\n##|$)`, 'im');
        const match = content.match(regex);
        return match ? match[1].trim() : '';
    }

    /** 标记脏数据，触发防抖保存 */
    private markDirty(): void {
        this.isDirty = true;
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = window.setTimeout(() => {
            this.saveScenes();
        }, 1000);
    }

    /** 保存场景数据 */
    async saveScenes(): Promise<void> {
        const project = this.deps.getProject();
        const chapNum = this.deps.getChapterNum();
        if (!project || chapNum <= 0 || !this.isDirty) return;

        const volume = this.deps.getVolume();
        const volMatch = volume.match(/第(\d+)卷/);
        const volNum = volMatch ? parseInt(volMatch[1]) : 1;

        const filePath = pjStepFile(project, volNum, chapNum, 'Scene展开');
        const file = this.app.vault.getAbstractFileByPath(filePath);

        let output = '';
        for (const scene of this.scenes) {
            output += `## 场景${scene.index}：${scene.name || '(未命名)'}\n`;
            output += `objective: ${scene.objective}\n`;
            output += `emotion_arc: ${scene.emotionArc}\n`;
            output += `conflict: ${scene.conflict}\n`;
            output += `sensory_hook: ${scene.sensoryHook}\n`;
            output += `memory_trigger: ${scene.memoryTrigger}\n`;
            output += `body_reaction: ${scene.bodyReaction}\n`;
            output += `subtext: ${scene.subtext}\n`;
            output += `relationship_shift: ${scene.relationshipShift}\n`;
            output += `key_scene: ${scene.keyScene || (scene.isKeyScene ? '⭐ 名场面' : '否')}\n`;
            output += `dialogue_function: ${scene.dialogueFunction}\n`;

            if (scene.characters) output += `characters: ${scene.characters}\n`;
            if (scene.location) output += `location: ${scene.location}\n`;
            if (scene.timelinePosition) output += `timeline: ${scene.timelinePosition}\n`;
            if (scene.conflictType) {
                const typeMap: Record<string, string> = {
                    internal: '内在冲突',
                    external: '外在冲突',
                    interpersonal: '人际冲突',
                };
                output += `conflict_type: ${typeMap[scene.conflictType] || scene.conflictType}\n`;
            }
            if (scene.pleasureType) {
                const typeMap: Record<string, string> = {
                    face_slap: '打脸',
                    level_up: '升级',
                    reveal: '揭秘',
                    gain: '收获',
                };
                output += `pleasure_type: ${typeMap[scene.pleasureType] || scene.pleasureType}\n`;
            }
            if (scene.infoIncrement) output += `info_increment: ${scene.infoIncrement}\n`;
            if (scene.foreshadowPlant) output += `foreshadow_plant: ${scene.foreshadowPlant}\n`;
            if (scene.foreshadowRecover) output += `foreshadow_recover: ${scene.foreshadowRecover}\n`;
            if (scene.wordCountEstimate > 0) output += `word_count: ${scene.wordCountEstimate}\n`;
            if (scene.status && scene.status !== 'not_started') {
                const statusMap: Record<string, string> = {
                    not_started: '未开始',
                    in_progress: '进行中',
                    completed: '已完成',
                };
                output += `status: ${statusMap[scene.status] || scene.status}\n`;
            }

            if (scene.index === this.scenes.length) {
                output += `cliffhanger: ${scene.cliffhanger}\n`;
            }
            output += '\n';
        }

        try {
            if (file instanceof TFile) {
                await this.app.vault.modify(file, output);
            } else {
                const dir = pjStepDir(project, volNum, chapNum);
                await this.app.vault.createFolder(dir).catch(() => { });
                await this.app.vault.create(filePath, output);
            }
            this.originalContent = output;
            this.isDirty = false;
            if (this.deps.onSceneChange) {
                this.deps.onSceneChange();
            }
        } catch (e) {
            log.error('[SceneOutline] 保存失败:', e);
        }
    }

    // ============================================================
    // 刷新辅助方法
    // ============================================================

    private refreshAll(): void {
        const container = document.querySelector('.nw-scene-outline-container');
        if (container && container.parentElement) {
            this.render(container.parentElement as HTMLElement);
        }
    }

    private refreshList(): void {
        this.refreshAll();
    }

    private refreshEditor(): void {
        this.refreshAll();
    }

    /** 样式注入 */
    private injectStyles(): void {
        const styleId = 'nw-scene-outline-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .nw-scene-outline-container textarea:focus,
            .nw-scene-outline-container input:focus,
            .nw-scene-outline-container select:focus {
                outline: none;
                border-color: var(--text-accent) !important;
                box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb), 0.2);
            }
            .nw-scene-outline-container button:hover {
                background: var(--background-modifier-hover) !important;
            }
        `;
        document.head.appendChild(style);
    }
}
