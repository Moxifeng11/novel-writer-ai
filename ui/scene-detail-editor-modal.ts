/**
 * scene-detail-editor-modal.ts — 场景级细纲编辑器
 *
 * 功能：编辑 Scene 展开的详细内容
 * 支持：场景列表导航、各字段编辑、名场面标记、结尾钩子、保存回写
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { validateSceneExpansion } from '../engine/scene-expander';
import { createLogger } from '../shared/logger';


const log = createLogger('SceneDetailEditorModal');
/** 场景数据 */
interface SceneData {
    index: number;
    name: string;
    objective: string;
    emotionArc: string;
    conflict: string;
    sensoryHook: string;
    memoryTrigger: string;
    bodyReaction: string;
    subtext: string;
    relationshipShift: string;
    keyScene: string;
    dialogueFunction: string;
    cliffhanger: string;
    isKeyScene: boolean;
}

export class SceneDetailEditorModal extends Modal {
    private plugin: NovelWriterPlugin;
    private project: string;
    private chapNum: number;
    private scenes: SceneData[] = [];
    private currentSceneIndex: number = 0;
    private originalContent: string = '';
    private filePath: string = '';

    constructor(app: App, plugin: NovelWriterPlugin, project: string, chapNum: number, filePath?: string) {
        super(app);
        this.plugin = plugin;
        this.project = project;
        this.chapNum = chapNum;
        this.filePath = filePath || '';
    }

    async onOpen(): Promise<void> {
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-scene-editor-modal');

        contentEl.createEl('h2', { text: `🎬 场景细纲编辑器 — 第${this.chapNum}章` });

        if (this.filePath) {
            await this.loadFromFile();
        }

        if (this.scenes.length === 0) {
            contentEl.createEl('p', {
                text: '⚠️ 未找到场景数据，请先生成 Scene 展开。',
                attr: { style: 'color:var(--text-warning); padding:20px;' }
            });
            const closeBtn = contentEl.createEl('button', { text: '关闭', cls: 'nw-btn' });
            closeBtn.onclick = () => this.close();
            return;
        }

        this.injectStyles();
        this.render();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }

    private async loadFromFile(): Promise<void> {
        try {
            const file = this.app.vault.getAbstractFileByPath(this.filePath);
            if (file instanceof TFile) {
                this.originalContent = await this.app.vault.read(file);
                this.parseScenes(this.originalContent);
            }
        } catch (e) {
            log.error('[SceneEditor] 加载文件失败:', e);
        }
    }

    private parseScenes(content: string): void {
        this.scenes = [];
        const sceneRegex = /^##\s*(?:场景\s*(\d+)|scene(\d+))\s*[：:]\s*(.+)$/gim;
        const matches: { index: number; name: string; start: number }[] = [];
        let m: RegExpExecArray | null;

        while ((m = sceneRegex.exec(content)) !== null) {
            const num = parseInt(m[1] || m[2] || '0', 10);
            matches.push({
                index: num || matches.length + 1,
                name: m[3].trim(),
                start: m.index,
            });
        }

        for (let i = 0; i < matches.length; i++) {
            const start = matches[i].start;
            const end = i + 1 < matches.length ? matches[i + 1].start : content.length;
            const sceneContent = content.slice(start, end);

            const scene: SceneData = {
                index: matches[i].index,
                name: matches[i].name,
                objective: this.extractField(sceneContent, 'objective'),
                emotionArc: this.extractField(sceneContent, 'emotion_arc'),
                conflict: this.extractField(sceneContent, 'conflict'),
                sensoryHook: this.extractField(sceneContent, 'sensory_hook'),
                memoryTrigger: this.extractField(sceneContent, 'memory_trigger'),
                bodyReaction: this.extractField(sceneContent, 'body_reaction'),
                subtext: this.extractField(sceneContent, 'subtext'),
                relationshipShift: this.extractField(sceneContent, 'relationship_shift'),
                keyScene: this.extractField(sceneContent, 'key_scene'),
                dialogueFunction: this.extractField(sceneContent, 'dialogue_function'),
                cliffhanger: this.extractField(sceneContent, 'cliffhanger'),
                isKeyScene: /⭐|名场面/.test(this.extractField(sceneContent, 'key_scene')),
            };
            this.scenes.push(scene);
        }
    }

    private extractField(content: string, field: string): string {
        const regex = new RegExp(`^\\s*\\*?\\*?${field}\\s*[：:]\\s*(.+?)(?=\\n\\s*\\*?\\*?[a-z_]+\\s*[：:]|\\n##|$)`, 'im');
        const match = content.match(regex);
        return match ? match[1].trim() : '';
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-scene-editor-modal');

        contentEl.createEl('h2', { text: `🎬 场景细纲编辑器 — 第${this.chapNum}章` });

        const mainWrap = contentEl.createDiv({
            attr: { style: 'display:flex; gap:16px; margin-top:12px;' }
        });

        this.renderSceneList(mainWrap);
        this.renderSceneEditor(mainWrap);
        this.renderFooter();
    }

    private renderSceneList(container: HTMLElement): void {
        const listWrap = container.createDiv({
            attr: { style: 'width:180px; flex-shrink:0; border-right:1px solid var(--background-modifier-border); padding-right:12px;' }
        });

        listWrap.createEl('h4', {
            text: '场景列表',
            attr: { style: 'margin:0 0 8px 0; font-size:0.9em; color:var(--text-muted);' }
        });

        const list = listWrap.createDiv({
            attr: { style: 'max-height:60vh; overflow-y:auto;' }
        });

        for (let i = 0; i < this.scenes.length; i++) {
            const scene = this.scenes[i];
            const isActive = i === this.currentSceneIndex;
            const isLast = i === this.scenes.length - 1;

            const item = list.createDiv({
                attr: {
                    style: `padding:8px 10px; margin:2px 0; border-radius:6px; cursor:pointer; font-size:0.85em; ${isActive ? 'background:var(--text-accent); color:white;' : 'background:var(--background-secondary);'}`,
                    title: scene.name,
                }
            });

            const topRow = item.createDiv({ attr: { style: 'display:flex; align-items:center; gap:4px;' } });
            topRow.createSpan({ text: `场景${scene.index}`, attr: { style: 'font-weight:600;' } });
            if (scene.isKeyScene) {
                topRow.createSpan({ text: '⭐', attr: { style: 'font-size:0.8em;' } });
            }
            if (isLast && scene.cliffhanger) {
                topRow.createSpan({ text: '🪝', attr: { style: 'font-size:0.8em;' } });
            }

            const nameRow = item.createDiv({
                attr: { style: `font-size:0.8em; margin-top:2px; ${isActive ? 'color:rgba(255,255,255,0.8);' : 'color:var(--text-faint);'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;` }
            });
            nameRow.setText(scene.name || '(未命名)');

            item.addEventListener('click', () => {
                this.currentSceneIndex = i;
                this.render();
            });
        }

        // 校验信息
        const validation = validateSceneExpansion(this.originalContent);
        if (validation.warnings.length > 0 || validation.errors.length > 0) {
            const validBox = listWrap.createDiv({
                attr: { style: 'margin-top:12px; padding:8px; border-radius:6px; font-size:0.78em; background:rgba(245,158,11,0.1);' }
            });
            if (validation.errors.length > 0) {
                validBox.createSpan({ text: `❌ ${validation.errors.length} 个错误`, attr: { style: 'color:var(--text-error); font-weight:600;' } });
            }
            if (validation.warnings.length > 0) {
                validBox.createEl('br');
                validBox.createSpan({ text: `⚠️ ${validation.warnings.length} 个建议`, attr: { style: 'color:var(--text-warning);' } });
            }
        }
    }

    private renderSceneEditor(container: HTMLElement): void {
        const scene = this.scenes[this.currentSceneIndex];
        if (!scene) return;

        const editorWrap = container.createDiv({
            attr: { style: 'flex:1; min-width:0; max-height:70vh; overflow-y:auto; padding-right:4px;' }
        });

        // 场景标题
        const header = editorWrap.createDiv({
            attr: { style: 'display:flex; align-items:center; gap:8px; margin-bottom:12px;' }
        });
        header.createEl('h3', {
            text: `场景${scene.index}：${scene.name}`,
            attr: { style: 'margin:0; font-size:1.05em;' }
        });

        // 名场面切换
        const keySceneBtn = header.createEl('button', {
            text: scene.isKeyScene ? '⭐ 名场面' : '☆ 标记名场面',
            attr: {
                style: `padding:4px 10px; font-size:0.8em; border-radius:4px; cursor:pointer; border:1px solid ${scene.isKeyScene ? '#f59e0b' : 'var(--background-modifier-border)'}; background:${scene.isKeyScene ? 'rgba(245,158,11,0.1)' : 'var(--background-secondary)'};`,
            }
        });
        keySceneBtn.addEventListener('click', () => {
            scene.isKeyScene = !scene.isKeyScene;
            scene.keyScene = scene.isKeyScene ? '⭐ 名场面 — 待补充原因' : '否';
            this.render();
        });

        // 编辑字段
        this.createEditableField(editorWrap, '🎯 objective（场景目标）', 'objective', scene);
        this.createEditableField(editorWrap, '🎭 emotion_arc（情绪弧线）', 'emotionArc', scene);
        this.createEditableField(editorWrap, '⚔️ conflict（核心冲突）', 'conflict', scene);
        this.createEditableField(editorWrap, '👁️ sensory_hook（感官入口）', 'sensoryHook', scene);
        this.createEditableField(editorWrap, '💭 memory_trigger（记忆触发）', 'memoryTrigger', scene);
        this.createEditableField(editorWrap, '💓 body_reaction（身体反应）', 'bodyReaction', scene);
        this.createEditableField(editorWrap, '🤐 subtext（潜台词）', 'subtext', scene);
        this.createEditableField(editorWrap, '🔗 relationship_shift（关系变化）', 'relationshipShift', scene);
        this.createEditableField(editorWrap, '💬 dialogue_function（对话功能）', 'dialogueFunction', scene);

        // 最后一个场景：结尾钩子
        if (this.currentSceneIndex === this.scenes.length - 1) {
            this.createEditableField(editorWrap, '🪝 cliffhanger（结尾钩子）', 'cliffhanger', scene, true);
        }

        // 快速导航
        const navRow = editorWrap.createDiv({
            attr: { style: 'display:flex; justify-content:space-between; margin-top:16px; padding-top:12px; border-top:1px solid var(--background-modifier-border);' }
        });

        const prevBtn = navRow.createEl('button', {
            text: '← 上一场景',
            attr: {
                style: 'padding:6px 14px; border-radius:6px; cursor:pointer; border:1px solid var(--background-modifier-border); background:var(--background-secondary);',
                disabled: this.currentSceneIndex === 0 ? 'true' : 'false',
            }
        });
        prevBtn.addEventListener('click', () => {
            if (this.currentSceneIndex > 0) {
                this.currentSceneIndex--;
                this.render();
            }
        });

        const nextBtn = navRow.createEl('button', {
            text: '下一场景 →',
            attr: {
                style: 'padding:6px 14px; border-radius:6px; cursor:pointer; border:1px solid var(--background-modifier-border); background:var(--background-secondary);',
                disabled: this.currentSceneIndex === this.scenes.length - 1 ? 'true' : 'false',
            }
        });
        nextBtn.addEventListener('click', () => {
            if (this.currentSceneIndex < this.scenes.length - 1) {
                this.currentSceneIndex++;
                this.render();
            }
        });
    }

    private createEditableField(container: HTMLElement, label: string, fieldKey: keyof SceneData, scene: SceneData, isLarge: boolean = false): void {
        const fieldWrap = container.createDiv({
            attr: { style: 'margin-bottom:10px;' }
        });

        fieldWrap.createEl('div', {
            text: label,
            attr: { style: 'font-size:0.82em; color:var(--text-muted); margin-bottom:4px; font-weight:500;' }
        });

        const value = scene[fieldKey] as string;

        if (isLarge || value.length > 50) {
            const textarea = fieldWrap.createEl('textarea', {
                attr: {
                    style: 'width:100%; padding:6px 8px; border-radius:6px; border:1px solid var(--background-modifier-border); font-size:0.85em; resize:vertical; min-height:60px; background:var(--background-primary);',
                    value: value,
                }
            });
            textarea.value = value;
            textarea.addEventListener('input', () => {
                (scene as any)[fieldKey] = textarea.value;
            });
        } else {
            const input = fieldWrap.createEl('input', {
                attr: {
                    style: 'width:100%; padding:6px 8px; border-radius:6px; border:1px solid var(--background-modifier-border); font-size:0.85em; background:var(--background-primary);',
                    value: value,
                    type: 'text',
                }
            });
            input.addEventListener('input', () => {
                (scene as any)[fieldKey] = input.value;
                if (fieldKey === 'keyScene') {
                    scene.isKeyScene = /⭐|名场面/.test(input.value);
                }
            });
        }
    }

    private renderFooter(): void {
        const { contentEl } = this;

        const footer = contentEl.createDiv({
            attr: { style: 'display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding-top:12px; border-top:1px solid var(--background-modifier-border);' }
        });

        const infoSpan = footer.createSpan({
            text: `共 ${this.scenes.length} 个场景`,
            attr: { style: 'font-size:0.85em; color:var(--text-muted);' }
        });

        const btnWrap = footer.createDiv({ attr: { style: 'display:flex; gap:8px;' } });

        const cancelBtn = btnWrap.createEl('button', {
            text: '✕ 取消',
            attr: { style: 'padding:6px 16px; border-radius:6px; cursor:pointer; border:1px solid var(--background-modifier-border); background:var(--background-secondary);' }
        });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = btnWrap.createEl('button', {
            text: '💾 保存修改',
            attr: { style: 'padding:6px 16px; background:var(--text-accent); color:white; border:none; border-radius:6px; cursor:pointer; font-weight:600;' }
        });
        saveBtn.addEventListener('click', () => this.save());
    }

    private async save(): Promise<void> {
        try {
            let output = '';
            for (const scene of this.scenes) {
                output += `## 场景${scene.index}：${scene.name}\n`;
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
                if (scene.index === this.scenes.length) {
                    output += `cliffhanger: ${scene.cliffhanger}\n`;
                }
                output += '\n';
            }

            if (this.filePath) {
                const file = this.app.vault.getAbstractFileByPath(this.filePath);
                if (file instanceof TFile) {
                    await this.app.vault.modify(file, output);
                    this.originalContent = output;
                    new Notice('✅ 场景细纲已保存', 3000);
                    this.close();
                    return;
                }
            }

            new Notice('⚠️ 未找到保存路径', 3000);
        } catch (e) {
            log.error('[SceneEditor] 保存失败:', e);
            new Notice('❌ 保存失败: ' + (e as Error).message, 5000);
        }
    }

    private injectStyles(): void {
        const styleId = 'nw-scene-editor-styles';
        if (document.getElementById(styleId)) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .nw-scene-editor-modal {
                width: min(900px, 90vw);
            }
            .nw-scene-editor-modal textarea:focus,
            .nw-scene-editor-modal input:focus {
                outline: none;
                border-color: var(--text-accent) !important;
                box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb), 0.2);
            }
            .nw-scene-editor-modal button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
    }
}
