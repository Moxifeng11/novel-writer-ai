/**
 * mode-document-modal.ts — 短篇/剧本专属文档编辑
 *
 * 用于故事核、分节大纲、场景圣经、分集大纲、分镜表等模式内文档。
 * 只读写 短篇创作/ 或 剧本创作/，不触碰长篇 03-大纲与章节。
 */
import { App, Modal, Notice } from 'obsidian';
import type NovelWriterPlugin from '../main';
import type { CreationMode } from '../shared/creation-mode';
import { getCreationModeLabel } from '../shared/creation-mode';
import { modeDocPath, modeDocStarter } from '../shared/mode-content';
import { resolveProjectMode } from '../shared/project-mode';

export type ModeDocumentKind = 'storyCore' | 'outline' | 'bible' | 'storyboard';

const TITLES: Record<CreationMode, Partial<Record<ModeDocumentKind, string>>> = {
    long: {},
    short: {
        storyCore: '📖 故事核',
        outline: '📋 分节大纲',
    },
    script: {
        bible: '🎭 场景圣经',
        outline: '📋 分集大纲',
        storyboard: '🎬 分镜表',
    },
};

const DESCRIPTIONS: Record<ModeDocumentKind, string> = {
    storyCore: '锁定主角、目标、阻力、反转与情绪承诺；后续分节与正文都以此为准。',
    outline: '短篇按节、剧本按集规划：每单元写清目标、冲突、信息增量、反转与结尾钩子。',
    bible: '剧本主场景与人物调度；控制场景数量，记录光线、道具、环境声和拍摄限制。',
    storyboard: '按镜号组织画面、景别、运镜、动作、台词与音效；用于拍摄/剪辑。',
};

export class ModeDocumentModal extends Modal {
    constructor(
        app: App,
        private readonly plugin: NovelWriterPlugin,
        private readonly mode: CreationMode,
        private readonly kind: ModeDocumentKind,
        private readonly project?: string
    ) {
        super(app);
    }

    async onOpen(): Promise<void> {
        this.modalEl.addClass('nw-scope', 'nw-modal');
        this.titleEl.setText(TITLES[this.mode]?.[this.kind] || '模式文档');
        const { contentEl } = this;
        contentEl.empty();

        if (this.mode === 'long' || !this.project) {
            contentEl.createEl('p', { text: '该文档仅适用于短篇或剧本项目。' });
            return;
        }

        // 命令入口可能带着「短篇」参数落到剧本项目上；写入前必须核对项目真实模式
        const projectMode = await resolveProjectMode(this.app, this.project);
        if (projectMode !== this.mode) {
            contentEl.createEl('p', {
                text: `该项目是${getCreationModeLabel(projectMode)}项目，不能保存${getCreationModeLabel(this.mode)}文档。请从项目的「创作流程」重新进入。`,
            });
            return;
        }

        contentEl.createEl('p', {
            cls: 'nw-text-12-muted',
            text: DESCRIPTIONS[this.kind],
        });
        contentEl.createEl('p', {
            cls: 'nw-text-12-muted',
            text: `保存位置：${modeDocPath(this.project, this.mode, this.kind)}`,
        });

        const textarea = contentEl.createEl('textarea', {
            cls: 'nw-textarea nw-form-textarea nw-mode-doc-editor',
            attr: { rows: '18', placeholder: '在此填写…' },
        });
        textarea.value = modeDocStarter(this.project, this.mode, this.kind);
        void this.load(textarea);

        const footer = contentEl.createDiv({ cls: 'nw-modal-footer' });
        const cancel = footer.createEl('button', { text: '取消', cls: 'nw-btn nw-btn-secondary', attr: { type: 'button' } });
        cancel.onclick = () => this.close();
        const save = footer.createEl('button', { text: '保存', cls: 'nw-btn nw-btn-primary', attr: { type: 'button' } });
        save.onclick = () => { void this.save(textarea.value); };
    }

    private async load(textarea: HTMLTextAreaElement): Promise<void> {
        if (!this.project) return;
        try {
            const path = modeDocPath(this.project, this.mode, this.kind);
            if (await this.app.vault.adapter.exists(path)) {
                textarea.value = await this.app.vault.adapter.read(path);
            }
        } catch (e) {
            new Notice(`读取文档失败：${e instanceof Error ? e.message : String(e)}`, 5000);
        }
    }

    private async save(content: string): Promise<void> {
        if (!this.project) return;
        try {
            const path = modeDocPath(this.project, this.mode, this.kind);
            const dir = path.substring(0, path.lastIndexOf('/'));
            if (!(await this.app.vault.adapter.exists(dir))) await this.app.vault.adapter.mkdir(dir);
            await this.app.vault.adapter.write(path, content);
            new Notice('✅ 已保存', 3000);
            this.close();
        } catch (e) {
            new Notice(`保存失败：${e instanceof Error ? e.message : String(e)}`, 6000);
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
