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
 * 集成方式：挂载到 FullWriterView 侧边栏
 */

import { App, TFile, Notice } from 'obsidian';
import { ExtendedSceneData, createDefaultScene, SceneStatus, ConflictType, PleasureType } from '@/shared/types';
import { pjStepDir, pjStepFile } from '@/shared/paths';
import { parseSceneHeadings } from '@/engine/scene-expander';
import { createLogger } from '@/shared/logger';
import { OperationConfirmModal } from '@/ui/components/progress';
import type NovelWriterPlugin from '@/main';
import { SceneGenerator } from '@/engine/ai-scene-generator';
import { AIApiClient } from '@/engine/ai-api-client';
import { ContextManager } from '@/engine/context-manager';
import { stripFrontmatter } from '@/utils/helpers';


const log = createLogger('SceneOutlineController');

/**
 * 场景卡纯文本字段键
 *
 * 只保留类型恰为 `string` 的字段：排除 `boolean`（isKeyScene）、`number`（字数预估）
 * 与字面量联合类型（conflictType/pleasureType），使文本输入写回无需类型断言。
 */
type SceneTextFieldKey = {
    [K in keyof ExtendedSceneData]-?:
        string extends ExtendedSceneData[K]
            ? (ExtendedSceneData[K] extends string ? K : never)
            : never;
}[keyof ExtendedSceneData];
/** 场景细纲控制器依赖 */
export interface SceneOutlineControllerDeps {
    app: App;
    /** 插件实例（用于 AI 场景生成；未提供时禁用一键生成） */
    plugin?: NovelWriterPlugin;
    getProject: () => string | undefined;
    getChapterNum: () => number;
    getVolume: () => string;
    getChapDir: () => string;
    onSceneChange?: () => void;
}

/**
 * 场景大纲控制器。
 */
export class SceneOutlineController {
    private deps: SceneOutlineControllerDeps;
    private scenes: ExtendedSceneData[] = [];
    private currentSceneIndex: number = 0;
    private activeTab: 'basic' | 'conflict' | 'foreshadow' = 'basic';
    private originalContent: string = '';
    private saveTimer: number | null = null;
    private isDirty: boolean = false;
    /** 脏数据所属章节（markDirty 时捕获，防止切章后写错文件） */
    private pendingSaveTarget: { project: string; volNum: number; chapNum: number } | null = null;
    private dragIndex: number | null = null;

    constructor(deps: SceneOutlineControllerDeps) {
        this.deps = deps;
    }

    get app(): App { return this.deps.app; }

    /**
     * 主渲染入口
     *
     * @param container - 容器元素
     */
    async render(container: HTMLElement): Promise<void> {
        container.empty();
        const project = this.deps.getProject();
        const chapNum = this.deps.getChapterNum();

        if (!project || chapNum <= 0) {
            container.createDiv({
                text: '请先选择项目和章节',
                cls: 'nw-u-p-20px-2 nw-u-c-text-muted-2 nw-u-ta-center-2'
            });
            return;
        }

        await this.loadScenes();

        const wrap = container.createDiv({
            cls: "nw-scene-outline-container nw-u-d-flex-2 nw-u-fd-column-2 nw-u-h-100-2 nw-u-minh-0-2",
            attr: {}
        });

        this.renderHeader(wrap);
        this.renderMainContent(wrap);
        this.renderFooter(wrap);
    }

    /** 头部工具栏 */
    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-p-8px-12px-2 nw-u-bb-1px-solid-background-m-2 nw-u-fsh-0-2'
        });

        header.createSpan({
            text: '🎬 场景细纲',
            cls: 'nw-u-fwt-600-2 nw-u-fs-0-95em'
        });

        const btnGroup = header.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-4px-2' });

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
            cls: 'nw-u-d-flex-2 nw-u-flex-1-2 nw-u-minh-0-2 nw-u-ov-hidden-2'
        });

        this.renderSceneList(main);
        this.renderSceneEditor(main);
    }

    /** 左侧场景列表 */
    private renderSceneList(container: HTMLElement): void {
        const listWrap = container.createDiv({
            cls: 'nw-u-w-180px nw-u-fsh-0-2 nw-u-brt-1px-solid-background-m-2 nw-u-d-flex-2 nw-u-fd-column-2 nw-u-minh-0-2'
        });

        const listHeader = listWrap.createDiv({
            cls: 'nw-u-p-8px-10px-2 nw-u-fs-0-8em nw-u-c-text-muted-2 nw-u-bb-1px-solid-background-m-2'
        });
        listHeader.setText(`共 ${this.scenes.length} 个场景`);

        const list = listWrap.createDiv({
            cls: 'nw-u-flex-1-2 nw-u-ovy-auto-2 nw-u-p-4px'
        });

        if (this.scenes.length === 0) {
            list.createDiv({
                text: '暂无场景，点击 ➕ 添加',
                cls: 'nw-u-p-20px-10px nw-u-ta-center-2 nw-u-c-text-faint-2 nw-u-fs-0-85em'
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

            const topRow = item.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-4px-2' });

            const statusDot = topRow.createSpan({
                attr: {
                    style: `width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; ${this.getStatusColor(scene.status)}`
                }
            });

            topRow.createSpan({
                text: `场景${scene.index}`,
                cls: 'nw-u-fwt-600-2'
            });

            if (scene.isKeyScene) {
                topRow.createSpan({ text: '⭐', cls: 'nw-u-fs-0-8em' });
            }
            if (isLast && scene.cliffhanger) {
                topRow.createSpan({ text: '🪝', cls: 'nw-u-fs-0-8em' });
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
            cls: "nw-scene-editor-wrap nw-u-flex-1-2 nw-u-minw-0-2 nw-u-d-flex-2 nw-u-fd-column-2 nw-u-minh-0-2",
            attr: {}
        });

        const scene = this.scenes[this.currentSceneIndex];
        if (!scene) {
            editorWrap.createDiv({
                text: '请选择或创建一个场景',
                cls: 'nw-u-p-40px-20px nw-u-ta-center-2 nw-u-c-text-muted-2'
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
            cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-p-8px-12px-2 nw-u-bb-1px-solid-background-m-2 nw-u-fsh-0-2'
        });

        const titleArea = toolbar.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2' });

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
            cls: 'nw-u-fwt-600-2 nw-u-fs-0-9em'
        });

        const btnGroup = toolbar.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-4px-2' });

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
            cls: 'nw-u-d-flex-2 nw-u-bb-1px-solid-background-m-2 nw-u-fsh-0-2'
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
            cls: 'nw-u-flex-1-2 nw-u-ovy-auto-2 nw-u-p-12px-2'
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
        this.createTextInput(container, '👁️ 视角人物 (pov)', 'pov', scene);
        this.createTextInput(container, '⏰ 场景时间 (time)', 'time', scene);
        this.createTextInput(container, '📍 场景地点', 'location', scene);
        this.createTextInput(container, '👥 出场人物', 'characters', scene);
        this.createTextArea(container, '🚪 入场状态 (entry_state)', 'entryState', scene);
        this.createTextArea(container, '🎯 场景目标 (objective)', 'objective', scene);
        this.createTextArea(container, '⚡ 场景转折 (turn)', 'turn', scene);
        this.createTextArea(container, '🏁 离场状态 (exit_state)', 'exitState', scene);
        this.createTextInput(container, '⏱️ 时间线位置', 'timelinePosition', scene);
        this.createTextArea(container, '🎭 情绪弧线 (emotion_arc)', 'emotionArc', scene);
        this.createTextArea(container, '👁️ 感官入口 (sensory_hook)', 'sensoryHook', scene);
        this.createTextArea(container, '💭 记忆触发 (memory_trigger)', 'memoryTrigger', scene);
        this.createTextArea(container, '💓 身体反应 (body_reaction)', 'bodyReaction', scene);
        this.createTextArea(container, '🤐 潜台词 (subtext)', 'subtext', scene);
        this.createTextArea(container, '🔗 关系变化 (relationship_shift)', 'relationshipShift', scene);
        this.createTextArea(container, '💬 对话功能 (dialogue_function)', 'dialogueFunction', scene);
        this.createTextArea(container, '🧭 工艺备注 (craft_notes)', 'craftNotes', scene);

        const keySceneRow = container.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2 nw-u-m-10px-0'
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
            cls: 'nw-u-fs-0-85em'
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
            cls: 'nw-u-d-flex-2 nw-u-gap-12px-2 nw-u-m-10px-0'
        });

        const conflictTypeWrap = typeRow.createDiv({ cls: 'nw-u-flex-1-2' });
        conflictTypeWrap.createEl('div', {
            text: '冲突类型',
            cls: 'nw-u-fs-0-82em nw-u-c-text-muted-2 nw-u-marginbottom-4px-2 nw-u-fwt-500-2'
        });
        const conflictSelect = conflictTypeWrap.createEl('select', {
            attr: {
                style: 'width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); font-size: 0.85em; background: var(--background-primary);'
            }
        });
        const conflictOptions: { value: ConflictType; label: string }[] = [
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
            scene.conflictType = conflictSelect.value as ConflictType;
            this.markDirty();
        };

        const pleasureWrap = typeRow.createDiv({ cls: 'nw-u-flex-1-2' });
        pleasureWrap.createEl('div', {
            text: '爽点类型',
            cls: 'nw-u-fs-0-82em nw-u-c-text-muted-2 nw-u-marginbottom-4px-2 nw-u-fwt-500-2'
        });
        const pleasureSelect = pleasureWrap.createEl('select', {
            attr: {
                style: 'width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); font-size: 0.85em; background: var(--background-primary);'
            }
        });
        const pleasureOptions: { value: PleasureType; label: string }[] = [
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
            scene.pleasureType = pleasureSelect.value as PleasureType;
            this.markDirty();
        };
    }

    /** 伏笔信息 Tab */
    private renderForeshadowTab(container: HTMLElement, scene: ExtendedSceneData): void {
        this.createTextArea(container, '📖 信息增量（本章新披露的设定/信息）', 'infoIncrement', scene);
        this.createTextArea(container, '🌱 伏笔埋设', 'foreshadowPlant', scene);
        this.createTextArea(container, '🎯 伏笔回收', 'foreshadowRecover', scene);

        const statsRow = container.createDiv({
            cls: 'nw-u-margintop-16px-2 nw-u-p-12px-2 nw-u-bg-background-secondary-2 nw-u-brd-8px-2'
        });
        statsRow.createEl('div', {
            text: '📊 场景统计',
            cls: 'nw-u-fwt-600-2 nw-u-marginbottom-8px-2 nw-u-fs-0-9em'
        });

        const wordEstimateWrap = statsRow.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2 nw-u-marginbottom-6px-2'
        });
        wordEstimateWrap.createSpan({
            text: '预估字数：',
            cls: 'nw-u-fs-0-85em nw-u-c-text-muted-2'
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
            cls: 'nw-u-fs-0-85em nw-u-c-text-muted-2'
        });
    }

    /** 创建单行文本输入 */
    private createTextInput(container: HTMLElement, label: string, fieldKey: SceneTextFieldKey, scene: ExtendedSceneData): void {
        const wrap = container.createDiv({ cls: 'nw-u-marginbottom-10px-2' });
        wrap.createEl('div', {
            text: label,
            cls: 'nw-u-fs-0-82em nw-u-c-text-muted-2 nw-u-marginbottom-4px-2 nw-u-fwt-500-2'
        });
        const input = wrap.createEl('input', {
            attr: {
                type: 'text',
                value: String(scene[fieldKey] || ''),
                style: 'width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); font-size: 0.85em; background: var(--background-primary);'
            }
        }) as HTMLInputElement;
        input.addEventListener('input', () => {
            scene[fieldKey] = input.value;
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
    private createTextArea(container: HTMLElement, label: string, fieldKey: SceneTextFieldKey, scene: ExtendedSceneData): void {
        const wrap = container.createDiv({ cls: 'nw-u-marginbottom-10px-2' });
        wrap.createEl('div', {
            text: label,
            cls: 'nw-u-fs-0-82em nw-u-c-text-muted-2 nw-u-marginbottom-4px-2 nw-u-fwt-500-2'
        });
        const value = String(scene[fieldKey] || '');
        const textarea = wrap.createEl('textarea', {
            attr: {
                style: 'width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); font-size: 0.85em; resize: vertical; min-height: 60px; background: var(--background-primary);',
            }
        }) as HTMLTextAreaElement;
        textarea.value = value;
        textarea.addEventListener('input', () => {
            scene[fieldKey] = textarea.value;
            this.markDirty();
        });
    }

    /** 底部状态栏 */
    private renderFooter(container: HTMLElement): void {
        const footer = container.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-center-2 nw-u-p-8px-12px-2 nw-u-bt-1px-solid-background-m-2 nw-u-fs-0-78em nw-u-c-text-muted-2 nw-u-fsh-0-2'
        });

        const totalWords = this.scenes.reduce((sum, s) => sum + (s.wordCountEstimate || 0), 0);
        const completed = this.scenes.filter(s => s.status === 'completed').length;

        footer.createSpan({ text: `预估总字数: ${totalWords} 字` });
        footer.createSpan({ text: `进度: ${completed}/${this.scenes.length}` });

        if (this.isDirty) {
            const saveIndicator = footer.createSpan({
                text: '⏳ 自动保存中...',
                cls: 'nw-u-c-text-warning'
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
    private async deleteScene(): Promise<void> {
        if (this.scenes.length <= 1) {
            new Notice('⚠️ 至少保留一个场景', 2000);
            return;
        }
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '删除场景',
            description: `确定删除场景${this.scenes[this.currentSceneIndex].index}吗？`,
            confirmText: '确认删除',
            cancelText: '取消',
        });
        if (!confirmed) return;

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

    /** 一键生成场景：调用 AI 生成场景细纲并写入当前章节 */
    private async generateScenes(): Promise<void> {
        const plugin = this.deps.plugin;
        const project = this.deps.getProject();
        const chapNum = this.deps.getChapterNum();
        if (!plugin || !project || chapNum <= 0) {
            new Notice('⚠️ 请先选择项目和章节后再生成场景', 3000);
            return;
        }

        const volume = this.deps.getVolume();
        const volMatch = volume.match(/第(\d+)卷/);
        const volNum = volMatch ? parseInt(volMatch[1], 10) : 1;
        const chapterName = `第${chapNum}章`;

        new Notice('✨ 正在生成场景细纲...', 3000);
        try {
            const gathered = await plugin.ctxManager.gatherAll(project, chapterName);
            const data = gathered.data;
            const readStep = async (step: string): Promise<string> => {
                const file = this.app.vault.getAbstractFileByPath(pjStepFile(project, volNum, chapNum, step));
                if (!(file instanceof TFile)) return '';
                try {
                    return stripFrontmatter(await this.app.vault.read(file));
                } catch {
                    return '';
                }
            };
            const chapterSummary = await readStep('大纲摘要');
            const chapterConflict = await readStep('情节蒸馏');

            const generator = new SceneGenerator(plugin, new AIApiClient(plugin));
            const response = await generator.generateScenes({
                projectId: project,
                volumeNumber: volNum,
                chapterNumber: chapNum,
                chapterConflict: chapterConflict.slice(0, 2000),
                chapterSummary: chapterSummary.slice(0, 4000),
                worldview: data.world_view?.raw ?? '',
                characters: ContextManager.formatCharacters(data.character_state ?? []),
                locations: ContextManager.formatEntities(
                    (data.locations ?? []) as unknown as Record<string, string>[], 'location'),
                factions: ContextManager.formatEntities(
                    (data.factions ?? []) as unknown as Record<string, string>[], 'faction'),
                items: ContextManager.formatEntities(
                    (data.items ?? []) as unknown as Record<string, string>[], 'item'),
            });
            if (response.error) {
                new Notice(`❌ 场景生成失败：${response.error}`, 5000);
                return;
            }

            const generated = generator.parseScenes(response);
            if (generated.length === 0) {
                new Notice('⚠️ 未解析到有效场景，请重试', 4000);
                return;
            }

            this.scenes = generated.map((scene) => {
                const item = createDefaultScene(scene.order);
                item.name = scene.title;
                item.objective = scene.objective ?? '';
                item.emotionArc = scene.emotionArc ?? '';
                item.conflict = scene.obstacle ?? '';
                item.characters = scene.characters.join('、');
                item.location = scene.locations.join('、');
                item.infoIncrement = scene.summary;
                item.foreshadowPlant = scene.foreshadowRefs.join('、');
                item.wordCountEstimate = scene.wordCountPlan;
                item.status = scene.status;
                return item;
            });
            this.currentSceneIndex = 0;
            this.markDirty();
            await this.saveScenes();
            this.refreshAll();
            new Notice(`✨ 已生成 ${this.scenes.length} 个场景`, 3000);
        } catch (e) {
            log.warn('[SceneOutline] 场景生成失败:', e);
            new Notice(`❌ 场景生成失败：${(e as Error).message}`, 5000);
        }
    }

    // ============================================================
    // 数据加载与保存
    // ============================================================

    /** 加载场景数据 */
    async loadScenes(): Promise<void> {
        // 切章前先把上一章未落盘的编辑写回它自己的文件：
        // 定时器可能还没触发，直接清空会让这次编辑丢失；而继续等定时器则会写错章。
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (this.isDirty) {
            await this.saveScenes();
        }
        this.pendingSaveTarget = null;

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
        const headings = parseSceneHeadings(content);

        for (let i = 0; i < headings.length; i++) {
            const start = headings[i].start;
            const end = i + 1 < headings.length ? headings[i + 1].start : content.length;
            const sceneContent = content.slice(start, end);

            const scene = createDefaultScene(headings[i].index);
            scene.name = headings[i].name;
            scene.pov = this.extractField(sceneContent, 'pov') || this.extractField(sceneContent, '视角');
            scene.time = this.extractField(sceneContent, 'time') || this.extractField(sceneContent, '场景时间');
            scene.entryState = this.extractField(sceneContent, 'entry_state') || this.extractField(sceneContent, '入场状态');
            scene.turn = this.extractField(sceneContent, 'turn') || this.extractField(sceneContent, '场景转折');
            scene.exitState = this.extractField(sceneContent, 'exit_state') || this.extractField(sceneContent, '离场状态');
            scene.craftNotes = this.extractField(sceneContent, 'craft_notes') || this.extractField(sceneContent, '工艺备注');
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
        // 记下这次编辑属于哪一章：1 秒后定时器触发时用户可能已经切章，
        // 旧实现用「当前」project/chapter 拼路径，会把旧章的场景写进新章文件。
        this.pendingSaveTarget = this.resolveSaveTarget();
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            this.saveScenes();
        }, 1000);
    }

    /** 当前章节对应的保存目标（项目 + 卷号 + 章号） */
    private resolveSaveTarget(): { project: string; volNum: number; chapNum: number } | null {
        const project = this.deps.getProject();
        const chapNum = this.deps.getChapterNum();
        if (!project || chapNum <= 0) return null;
        const volume = this.deps.getVolume();
        const volMatch = volume.match(/第(\d+)卷/);
        return { project, volNum: volMatch ? parseInt(volMatch[1]) : 1, chapNum };
    }

    /**
     * 保存场景数据；返回是否真正写入
     *
     * @returns 是否成功
     */
    async saveScenes(): Promise<boolean> {
        // 优先用「编辑发生时」捕获的目标，避免切章后写进新章；手动保存时目标就是当前章
        const target = this.pendingSaveTarget ?? this.resolveSaveTarget();
        const project = target?.project ?? '';
        const chapNum = target?.chapNum ?? 0;
        if (!project || chapNum <= 0 || !this.isDirty) return false;

        // 防止解析失败时用空内容覆盖已有文件
        if (this.scenes.length === 0 && stripFrontmatter(this.originalContent).trim().length > 0) {
            this.isDirty = false;
            this.pendingSaveTarget = null;
            new Notice('⚠️ 未解析到任何场景，已阻止空内容覆盖原文件', 5000);
            return false;
        }

        const volNum = target?.volNum ?? 1;

        const filePath = pjStepFile(project, volNum, chapNum, 'Scene展开');
        const file = this.app.vault.getAbstractFileByPath(filePath);

        let output = '';
        for (const scene of this.scenes) {
            output += `## 场景${scene.index}：${scene.name || '(未命名)'}\n`;
            if (scene.pov) output += `pov: ${scene.pov}\n`;
            if (scene.time) output += `time: ${scene.time}\n`;
            if (scene.location) output += `location: ${scene.location}\n`;
            if (scene.entryState) output += `entry_state: ${scene.entryState}\n`;
            output += `objective: ${scene.objective}\n`;
            output += `conflict: ${scene.conflict}\n`;
            if (scene.turn) output += `turn: ${scene.turn}\n`;
            if (scene.exitState) output += `exit_state: ${scene.exitState}\n`;
            output += `emotion_arc: ${scene.emotionArc}\n`;
            output += `sensory_hook: ${scene.sensoryHook}\n`;
            output += `memory_trigger: ${scene.memoryTrigger}\n`;
            output += `body_reaction: ${scene.bodyReaction}\n`;
            output += `subtext: ${scene.subtext}\n`;
            output += `relationship_shift: ${scene.relationshipShift}\n`;
            output += `key_scene: ${scene.keyScene || (scene.isKeyScene ? '⭐ 名场面' : '否')}\n`;
            output += `dialogue_function: ${scene.dialogueFunction}\n`;
            if (scene.craftNotes) output += `craft_notes: ${scene.craftNotes}\n`;

            if (scene.characters) output += `characters: ${scene.characters}\n`;
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
            this.pendingSaveTarget = null;
            if (this.deps.onSceneChange) {
                this.deps.onSceneChange();
            }
            return true;
        } catch (e) {
            log.error('[SceneOutline] 保存失败:', e);
            // 保存失败保留脏标记，允许下一次编辑/手动保存重试
            new Notice('⚠️ 场景细纲自动保存失败，请手动保存重试', 4000);
            return false;
        }
    }

    /**
     * 最近一次成功写入/读取的内容（供调用方同步步骤状态）
     *
     * @returns 文本结果
     */
    getSavedContent(): string {
        return this.originalContent;
    }

    /**
     * 纯文本模式保存：原样写入，不做场景解析
     *
     * @param content - 内容
     * @returns 是否成功
     */
    async saveRawContent(content: string): Promise<boolean> {
        const project = this.deps.getProject();
        const chapNum = this.deps.getChapterNum();
        if (!project || chapNum <= 0) return false;

        if (!content.trim()) {
            new Notice('⚠️ 内容为空，已阻止覆盖原文件', 5000);
            return false;
        }

        const volume = this.deps.getVolume();
        const volMatch = volume.match(/第(\d+)卷/);
        const volNum = volMatch ? parseInt(volMatch[1]) : 1;

        const filePath = pjStepFile(project, volNum, chapNum, 'Scene展开');
        const file = this.app.vault.getAbstractFileByPath(filePath);

        try {
            if (file instanceof TFile) {
                await this.app.vault.modify(file, content);
            } else {
                const dir = pjStepDir(project, volNum, chapNum);
                await this.app.vault.createFolder(dir).catch(() => { });
                await this.app.vault.create(filePath, content);
            }
            this.originalContent = content;
            this.scenes = this.parseScenes(content);
            this.isDirty = false;
            if (this.deps.onSceneChange) {
                this.deps.onSceneChange();
            }
            return true;
        } catch (e) {
            log.error('[SceneOutline] 纯文本保存失败:', e);
            return false;
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
}
