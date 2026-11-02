import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from '../engine/ai-engine';
import { showSuccess, showError } from '../utils/helpers';
import {
    pjCharsDir,
    pjPromiseLedger,
    pjVolumeOutlineDir,
    pjWorldview,
    readProjectMeta,
} from '../shared/paths';
import { parsePromiseLedger, formatOpenPromisesForPrompt } from '../engine/promise-ledger';
import { resolveTaskModelConfig } from '../shared/task-model';
import { entityDir } from '../shared/entity-reader';
import {
    buildSynopsisPrompts,
    parseSynopsisVariants,
    styleLabel,
    SYNOPSIS_STYLE_META,
    SynopsisContext,
    SynopsisLength,
    SynopsisStyle,
    SynopsisVariant,
} from '../shared/synopsis-spec';
import { SynopsisStore, SynopsisSnapshot } from '../services/synopsis-store';
import { createLogger } from '../shared/logger';

const log = createLogger('VolumeIntroModal');

interface BookSummary {
    totalChapters: string;
    totalWords: string;
    totalVolumes: string;
}

interface VolumeData {
    name: string;
    sections: Record<string, string>;
    chapters: { num: number; conflict: string }[];
}

/**
 * VolumeIntroModal 类。
 */
export class VolumeIntroModal extends Modal {
    private aiEngine: AIEngine;
    private store: SynopsisStore;
    private currentProject = '';
    private snapshot: SynopsisSnapshot | null = null;
    private editorText = '';
    private selectedVersionId = '';
    private selectedStyle: SynopsisStyle = 'hook';
    private length: SynopsisLength = 'standard';
    private generating = false;
    private draftDirty = false;
    private draftTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        app: App,
        private readonly plugin: NovelWriterPlugin,
        initialProject?: string,
    ) {
        super(app);
        this.aiEngine = plugin.aiEngine;
        this.store = new SynopsisStore(app);
        this.currentProject = initialProject || plugin.getActiveProject() || '';
    }

    /**
     * onOpen 方法。
     */
    async onOpen(): Promise<void> {
        this.modalEl.addClass('nw-scope', 'nw-modal-lg');
        this.contentEl.addClass('nw-form-stack');
        await this.render();
    }

    private async render(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '📝 全书简介生成器' });
        contentEl.createEl('p', {
            text: '多版本并存：生成后不会覆盖旧稿；选中项目会自动保存草稿，挑最有感觉的一版设为采用。',
            cls: 'setting-item-description',
        });

        const projects = await this.plugin.ctxManager.detectProjects();
        if (projects.length === 0) {
            contentEl.createEl('p', { text: '❌ 未找到项目，请先创建项目' });
            return;
        }
        if (!projects.includes(this.currentProject)) this.currentProject = projects[0];

        const projectRow = contentEl.createDiv({ cls: 'nw-flex-row-sm' });
        projectRow.createSpan({ text: '项目：' });
        const select = projectRow.createEl('select', { cls: 'nw-select' });
        for (const project of projects) {
            select.createEl('option', { value: project, text: project });
        }
        select.value = this.currentProject;
        select.onchange = () => void this.switchProject(select.value);

        if (!this.snapshot) await this.loadProject();

        const controls = contentEl.createDiv({ cls: 'nw-flex-row-sm' });
        controls.createSpan({ text: '长度：' });
        const lengthSelect = controls.createEl('select', { cls: 'nw-select' });
        lengthSelect.createEl('option', { value: 'short', text: '短版 120-180 字' });
        lengthSelect.createEl('option', { value: 'standard', text: '标准版 220-320 字' });
        lengthSelect.createEl('option', { value: 'long', text: '长版 350-500 字' });
        lengthSelect.value = this.length;
        lengthSelect.onchange = () => { this.length = lengthSelect.value as SynopsisLength; };

        const generateBtn = controls.createEl('button', {
            text: this.generating ? '⏳ 生成中...' : '✨ 生成四版简介',
            cls: 'nw-btn nw-btn-primary',
        });
        generateBtn.disabled = this.generating;
        generateBtn.onclick = () => void this.generate(generateBtn);

        this.renderVersions(contentEl);
        this.renderEditor(contentEl);
    }

    private renderVersions(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-card' });
        const versions = this.snapshot?.versions || [];
        const activeId = this.snapshot?.index.activeId || '';
        section.createEl('h3', { text: `版本（${versions.length}）` });
        if (versions.length === 0) {
            section.createEl('p', { text: '还没有版本；先生成四版或把草稿保存为新版本。' });
            return;
        }
        for (const version of versions) {
            const row = section.createDiv({ cls: 'nw-flex-row-sm' });
            const active = version.id === activeId ? '✅ ' : '';
            row.createSpan({
                text: `${active}${version.id} · ${styleLabel(version.style)} · ${version.charCount} 字 · ${new Date(version.createdAt).toLocaleString()}`,
                cls: 'nw-text-13-normal-flex',
            });
            const preview = row.createEl('button', { text: '预览', cls: 'nw-btn nw-btn-secondary' });
            preview.onclick = () => {
                this.selectedVersionId = version.id;
                this.editorText = version.text;
                this.selectedStyle = version.style;
                this.render();
            };
            const adopt = row.createEl('button', { text: '采用', cls: 'nw-btn nw-btn-secondary' });
            adopt.onclick = async () => {
                try {
                    await this.store.setActive(this.currentProject, version.id);
                    this.snapshot = await this.store.load(this.currentProject);
                    new Notice(`✅ 已采用 ${version.id}`, 4000);
                    this.render();
                } catch (e) {
                    showError(`采用失败：${e instanceof Error ? e.message : String(e)}`);
                }
            };
            const del = row.createEl('button', { text: '删除', cls: 'nw-btn nw-btn-danger' });
            del.onclick = async () => {
                if (!window.confirm(`删除版本 ${version.id}？`)) return;
                await this.store.deleteVersion(this.currentProject, version.id);
                this.snapshot = await this.store.load(this.currentProject);
                this.render();
            };
        }
    }

    private renderEditor(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-card' });
        section.createEl('h3', { text: '编辑 / 保存' });
        const row = section.createDiv({ cls: 'nw-flex-row-sm' });
        row.createSpan({ text: '风格：' });
        const styleSelect = row.createEl('select', { cls: 'nw-select' });
        for (const [style, meta] of Object.entries(SYNOPSIS_STYLE_META)) {
            styleSelect.createEl('option', { value: style, text: meta.label });
        }
        styleSelect.value = this.selectedStyle;
        styleSelect.onchange = () => { this.selectedStyle = styleSelect.value as SynopsisStyle; };

        const saveAsNew = row.createEl('button', { text: '💾 保存为新版本', cls: 'nw-btn nw-btn-primary' });
        saveAsNew.onclick = () => void this.saveAsVersion();
        const saveChanges = row.createEl('button', { text: '保存当前修改', cls: 'nw-btn nw-btn-secondary' });
        saveChanges.disabled = !this.selectedVersionId;
        saveChanges.onclick = () => void this.saveChanges();
        const adopt = row.createEl('button', { text: '设为采用', cls: 'nw-btn nw-btn-secondary' });
        adopt.disabled = !this.selectedVersionId;
        adopt.onclick = () => void this.adoptSelected();

        const editor = section.createEl('textarea', { cls: 'nw-textarea nw-u-minh-150px' });
        editor.rows = 16;
        editor.value = this.editorText;
        editor.placeholder = '生成的简介会出现在这里；也可以直接手写。';
        editor.oninput = () => {
            this.editorText = editor.value;
            this.draftDirty = true;
            this.scheduleDraftSave();
        };
        section.createEl('p', {
            text: this.draftDirty ? '草稿会自动保存到当前项目。' : '草稿已保存。',
            cls: 'setting-item-description',
        });
    }

    private async switchProject(project: string): Promise<void> {
        await this.flushDraft();
        this.currentProject = project;
        this.snapshot = null;
        this.selectedVersionId = '';
        this.editorText = '';
        await this.loadProject();
        await this.render();
    }

    private async loadProject(): Promise<void> {
        try {
            this.snapshot = await this.store.load(this.currentProject);
            const active = this.snapshot.versions.find(v => v.id === this.snapshot?.index.activeId);
            const draft = this.snapshot.draft;
            if (draft.trim()) {
                this.editorText = draft;
                this.draftDirty = false;
            } else if (this.selectedVersionId) {
                this.editorText = this.snapshot.versions.find(v => v.id === this.selectedVersionId)?.text || '';
            } else if (active) {
                this.selectedVersionId = active.id;
                this.editorText = active.text;
            } else if (this.snapshot.versions[0]) {
                this.selectedVersionId = this.snapshot.versions[0].id;
                this.editorText = this.snapshot.versions[0].text;
            } else {
                this.editorText = '';
            }
        } catch (e) {
            log.warn('[VolumeIntroModal] 加载项目简介失败:', e);
            this.snapshot = { index: { version: 1, activeId: '', items: [] }, versions: [], draft: '' };
        }
    }

    private async generate(button: HTMLButtonElement): Promise<void> {
        if (this.generating) return;
        if (!this.currentProject) {
            showError('请先选择项目');
            return;
        }
        if (!this.plugin.hasAiCredentials) {
            showError('请先配置 API 密钥或本地模型端点');
            return;
        }
        this.generating = true;
        button.disabled = true;
        button.textContent = '⏳ 生成中...';
        const notice = new Notice('⏳ 正在生成四版全书简介...', 0);
        try {
            const ctx = await this.buildContext(this.currentProject);
            const prompts = buildSynopsisPrompts(ctx, this.length);
            const config = resolveTaskModelConfig(
                this.plugin.settings,
                'quality',
                (model, endpoint) => this.plugin.resolveModelLimits(model, endpoint),
            );
            const result = await this.aiEngine.callAI(
                prompts.system,
                prompts.user,
                config.model,
                0.9,
                Math.min(4096, config.maxOutput),
                {
                    endpoint: config.endpoint,
                    apiKey: config.apiKey,
                    disableFallback: config.sourceType === 'local',
                    thinkingMode: config.thinkingMode,
                    thinkingBudget: config.thinkingBudget,
                },
            );
            if (result.error) {
                showError(`全书简介生成失败：${result.error}`);
                return;
            }
            const variants = parseSynopsisVariants(result.content);
            if (variants.length === 0) {
                showError('模型没有返回可解析的简介版本，请重试');
                return;
            }
            for (const variant of variants) {
                await this.store.saveVariant(this.currentProject, variant, { model: config.model });
            }
            await this.store.saveDraft(this.currentProject, variants[0].text);
            this.snapshot = await this.store.load(this.currentProject);
            this.editorText = variants[0].text;
            this.selectedStyle = variants[0].style;
            this.selectedVersionId = this.snapshot.versions[0]?.id || '';
            this.draftDirty = false;
            showSuccess(`已生成 ${variants.length} 版简介；挑一版设为采用`);
            await this.render();
        } catch (e) {
            log.error('[VolumeIntroModal] 生成失败:', e);
            showError(`生成失败：${e instanceof Error ? e.message : String(e)}`);
        } finally {
            notice.hide();
            this.generating = false;
        }
    }

    private async saveAsVersion(): Promise<void> {
        const text = this.editorText.trim();
        if (!text) {
            showError('简介内容为空');
            return;
        }
        const variant: SynopsisVariant = {
            style: this.selectedStyle,
            title: `${styleLabel(this.selectedStyle)}版`,
            text,
            wordCount: text.replace(/\s/g, '').length,
        };
        try {
            const meta = await this.store.saveVariant(this.currentProject, variant);
            this.snapshot = await this.store.load(this.currentProject);
            this.selectedVersionId = meta.id;
            this.draftDirty = false;
            await this.store.saveDraft(this.currentProject, text);
            new Notice(`✅ 已保存新版本 ${meta.id}`, 4000);
            await this.render();
        } catch (e) {
            showError(`保存失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async saveChanges(): Promise<void> {
        if (!this.selectedVersionId) return;
        try {
            await this.store.updateVariantText(this.currentProject, this.selectedVersionId, this.editorText);
            this.snapshot = await this.store.load(this.currentProject);
            this.draftDirty = false;
            new Notice('✅ 当前版本已更新', 4000);
            await this.render();
        } catch (e) {
            showError(`保存失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async adoptSelected(): Promise<void> {
        if (!this.selectedVersionId) return;
        try {
            await this.store.setActive(this.currentProject, this.selectedVersionId);
            this.snapshot = await this.store.load(this.currentProject);
            new Notice('✅ 已设为当前采用版本', 4000);
            await this.render();
        } catch (e) {
            showError(`采用失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private scheduleDraftSave(): void {
        if (this.draftTimer) clearTimeout(this.draftTimer);
        this.draftTimer = setTimeout(() => { void this.flushDraft(); }, 800);
    }

    private async flushDraft(): Promise<void> {
        if (this.draftTimer) {
            clearTimeout(this.draftTimer);
            this.draftTimer = null;
        }
        if (!this.draftDirty || !this.currentProject) return;
        try {
            await this.store.saveDraft(this.currentProject, this.editorText);
            this.draftDirty = false;
        } catch (e) {
            log.warn('[VolumeIntroModal] 自动保存草稿失败:', e);
        }
    }

    private async buildContext(project: string): Promise<SynopsisContext> {
        const meta = await readProjectMeta(this.app, project) || '';
        const genre = meta.match(/##\s*题材\s*\n\s*(.+)/)?.[1]?.trim() || '';
        const description = meta.match(/##\s*描述\s*\n([\s\S]*?)(?=\n## |$)/)?.[1]?.trim() || '';
        const worldview = await this.readVaultFile(pjWorldview(project), 2000);
        const characters = await this.readCharacterExcerpt(project);
        const promises = await this.readOpenPromises(project);
        const { bookSummary, volumes } = await this.readVolumes(project);
        return {
            project,
            genre,
            description,
            worldviewExcerpt: worldview,
            protagonist: characters,
            volumeSummary: this.buildFullSummary(bookSummary, volumes),
            openPromises: promises,
        };
    }

    private async readVaultFile(path: string, maxChars: number): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return '';
        try {
            return (await this.app.vault.read(file)).slice(0, maxChars);
        } catch {
            return '';
        }
    }

    private async readCharacterExcerpt(project: string): Promise<string> {
        const prefix = `${entityDir(project, 'characters')}/`;
        const files = this.app.vault.getFiles()
            .filter(file => file.path.startsWith(prefix) && file.extension === 'md')
            .slice(0, 3);
        const parts: string[] = [];
        for (const file of files) {
            try {
                const content = await this.app.vault.read(file);
                const name = content.match(/^姓名:\s*(.+)$/m)?.[1]?.trim() || file.basename;
                const motivation = content.match(/核心动机[：:]\s*(.+)/)?.[1]?.trim() || '';
                parts.push(`- ${name}${motivation ? `：${motivation}` : ''}`);
            } catch {
                // 单个人物读取失败不影响简介生成
            }
        }
        return parts.join('\n');
    }

    private async readOpenPromises(project: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(pjPromiseLedger(project));
        if (!(file instanceof TFile)) return '';
        try {
            const items = parsePromiseLedger(await this.app.vault.read(file));
            return formatOpenPromisesForPrompt(items, 999, 6);
        } catch {
            return '';
        }
    }

    private async readVolumes(project: string): Promise<{ bookSummary: BookSummary; volumes: VolumeData[] }> {
        const volumeDir = pjVolumeOutlineDir(project);
        const volumeFiles = this.app.vault.getFiles()
            .filter(f => f.path.startsWith(`${volumeDir}/`) && f.name.endsWith('_分卷大纲.md'))
            .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'));
        const parts: string[] = [];
        for (const file of volumeFiles) {
            try { parts.push(await this.app.vault.read(file)); } catch (e) { log.warn('[VolumeIntroModal] 读取失败:', file.path, e); }
        }
        const outlineContent = parts.join('\n\n');
        const bookSummary: BookSummary = { totalChapters: '', totalWords: '', totalVolumes: '' };
        for (const line of outlineContent.split('\n')) {
            const wm = line.match(/总字数目标[：:]\s*(\S+)/);
            if (wm) bookSummary.totalWords = wm[1];
            const cm = line.match(/总章节数[：:]\s*(\S+)/);
            if (cm) bookSummary.totalChapters = cm[1];
            const vm = line.match(/分卷数[：:]\s*(\S+)/);
            if (vm) bookSummary.totalVolumes = vm[1];
        }
        const volumes: VolumeData[] = [];
        let currentVol: VolumeData | null = null;
        for (const line of outlineContent.split('\n')) {
            const volMatch = line.match(/^###\s+(第\d+卷)/);
            if (volMatch) {
                if (currentVol) volumes.push(currentVol);
                currentVol = { name: volMatch[1], sections: {}, chapters: [] };
                continue;
            }
            if (!currentVol) continue;
            const keyMatch = line.match(/^-\s*\*\*(.*?)\*\*[：:]\s*(.*)/);
            if (keyMatch) {
                currentVol.sections[keyMatch[1].trim()] = keyMatch[2].trim();
                continue;
            }
            const chapMatch = line.match(/^\|\s*(\d+)\s*\|(.+)\|/);
            if (chapMatch && currentVol.sections['章节范围']) {
                currentVol.chapters.push({ num: parseInt(chapMatch[1]), conflict: chapMatch[2].trim() });
            }
        }
        if (currentVol) volumes.push(currentVol);
        return { bookSummary, volumes };
    }

    private buildFullSummary(bookSummary: BookSummary, volumes: VolumeData[]): string {
        const parts: string[] = [];
        for (const vol of volumes) {
            parts.push(`\n=== ${vol.name}：${vol.sections['卷名'] || '未命名'} ===`);
            if (vol.sections['章节范围']) parts.push(`章节：${vol.sections['章节范围']}`);
            if (vol.sections['核心剧情']) parts.push(`剧情：${vol.sections['核心剧情']}`);
            if (vol.sections['主线推进']) parts.push(`主线：${vol.sections['主线推进']}`);
            if (vol.sections['本卷高潮']) parts.push(`高潮：${vol.sections['本卷高潮']}`);
            if (vol.sections['结尾过渡']) parts.push(`结尾：${vol.sections['结尾过渡']}`);
            if (vol.chapters.length > 0) {
                const hints = [...vol.chapters.slice(0, 3), ...vol.chapters.slice(-3)].map(c => c.conflict);
                parts.push(`关键冲突示例：${hints.join(' / ')}`);
            }
        }
        if (parts.length === 0) {
            parts.push(`总字数目标：${bookSummary.totalWords || '未设定'}`);
            parts.push(`总章节数：${bookSummary.totalChapters || '未设定'}`);
            parts.push(`分卷数：${bookSummary.totalVolumes || '未设定'}`);
        }
        return parts.join('\n').slice(0, 6000);
    }

    /**
     * onClose 方法。
     */
    async onClose(): Promise<void> {
        await this.flushDraft();
        this.contentEl.empty();
    }
}