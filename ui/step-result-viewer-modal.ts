import { App, Modal, Notice, Platform, TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '../main';
import { parseStepFrontmatter, ParsedStepFrontmatter } from '../shared/step-frontmatter';
import { SUBDIR_STEP_ROOT } from '../shared/paths';
import { detectProjects } from '../engine/context-manager';
import type { StepStatus } from '../shared/types';

interface StepFileInfo {
    file: TFile;
    stepName: string;
    frontmatter: ParsedStepFrontmatter | null;
}

const STATUS_LABELS: Record<StepStatus | 'unknown', string> = {
    pending: '待生成',
    generated: '已生成',
    reviewed: '已审阅',
    stale: '已过期',
    unknown: '未知状态',
};

const STATUS_COLORS: Record<StepStatus | 'unknown', { bg: string; text: string }> = {
    pending: { bg: 'var(--background-modifier-border)', text: 'var(--text-muted)' },
    generated: { bg: 'rgba(34, 197, 94, 0.15)', text: 'var(--text-success, #22c55e)' },
    reviewed: { bg: 'rgba(59, 130, 246, 0.15)', text: 'var(--text-accent, #3b82f6)' },
    stale: { bg: 'rgba(249, 115, 22, 0.15)', text: 'var(--text-warning, #f97316)' },
    unknown: { bg: 'var(--background-modifier-border)', text: 'var(--text-muted)' },
};

export class StepResultViewerModal extends Modal {
    private plugin: NovelWriterPlugin;
    private projects: string[] = [];
    private volumes: string[] = [];
    private chapters: string[] = [];
    private selectedProject = '';
    private selectedVolume = '';
    private selectedChapter = '';
    private stepFiles: StepFileInfo[] = [];

    private projectSelectEl: HTMLSelectElement | null = null;
    private volumeSelectEl: HTMLSelectElement | null = null;
    private chapterSelectEl: HTMLSelectElement | null = null;
    private fileListEl: HTMLElement | null = null;
    private infoBarEl: HTMLElement | null = null;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
    }

    async onOpen(): Promise<void> {
        this.modalEl.addClass('nw-scope');

        const { contentEl } = this;
        contentEl.empty();
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        contentEl.style.height = '100%';

        const modalWrapper = contentEl.parentElement as HTMLElement | null;
        if (modalWrapper) {
            modalWrapper.style.setProperty('max-width', 'var(--nw-modal-max-w)', 'important');
            modalWrapper.style.setProperty('width', 'var(--nw-modal-max-w)', 'important');
        }
        contentEl.style.maxWidth = 'var(--nw-modal-max-w)';
        contentEl.style.maxHeight = 'var(--nw-modal-max-h)';
        contentEl.style.width = 'var(--nw-modal-max-w)';

        const header = contentEl.createDiv({
            attr: {
                style: 'padding: 14px 16px; border-bottom: 1px solid var(--background-modifier-border); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;',
            },
        });
        header.createSpan({
            text: '📋 步骤结果查看',
            attr: { style: 'font-weight: 600; font-size: 16px;' },
        });

        const selectorArea = contentEl.createDiv({
            attr: {
                style: 'padding: 12px 16px; border-bottom: 1px solid var(--background-modifier-border); display: flex; gap: 10px; flex-shrink: 0; flex-wrap: wrap;',
            },
        });

        const projectWrap = selectorArea.createDiv({ attr: { style: 'flex: 1; min-width: 140px;' } });
        projectWrap.createDiv({
            text: '项目',
            attr: { style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 4px;' },
        });
        this.projectSelectEl = projectWrap.createEl('select', {
            cls: 'nw-select',
            attr: { style: 'width: 100%;' },
        });
        this.projectSelectEl.addEventListener('change', () => {
            this.selectedProject = this.projectSelectEl!.value;
            this.loadVolumes();
        });

        const volumeWrap = selectorArea.createDiv({ attr: { style: 'flex: 1; min-width: 120px;' } });
        volumeWrap.createDiv({
            text: '卷',
            attr: { style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 4px;' },
        });
        this.volumeSelectEl = volumeWrap.createEl('select', {
            cls: 'nw-select',
            attr: { style: 'width: 100%;' },
        });
        this.volumeSelectEl.addEventListener('change', () => {
            this.selectedVolume = this.volumeSelectEl!.value;
            this.loadChapters();
        });

        const chapterWrap = selectorArea.createDiv({ attr: { style: 'flex: 1; min-width: 120px;' } });
        chapterWrap.createDiv({
            text: '章',
            attr: { style: 'font-size: 12px; color: var(--text-muted); margin-bottom: 4px;' },
        });
        this.chapterSelectEl = chapterWrap.createEl('select', {
            cls: 'nw-select',
            attr: { style: 'width: 100%;' },
        });
        this.chapterSelectEl.addEventListener('change', () => {
            this.selectedChapter = this.chapterSelectEl!.value;
            this.loadStepFiles();
        });

        const listContainer = contentEl.createDiv({
            attr: {
                style: 'flex: 1; overflow-y: auto; padding: 12px 16px; min-height: 0;',
            },
        });
        this.fileListEl = listContainer;

        this.infoBarEl = contentEl.createDiv({
            attr: {
                style: 'padding: 10px 16px; border-top: 1px solid var(--background-modifier-border); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;',
            },
        });

        await this.loadProjects();
    }

    private async loadProjects(): Promise<void> {
        this.projects = detectProjects(this.app);
        if (this.projectSelectEl) {
            this.projectSelectEl.empty();
            if (this.projects.length === 0) {
                const opt = this.projectSelectEl.createEl('option');
                opt.value = '';
                opt.text = '暂无项目';
                this.selectedProject = '';
            } else {
                for (const p of this.projects) {
                    const opt = this.projectSelectEl.createEl('option');
                    opt.value = p;
                    opt.text = p;
                }
                this.selectedProject = this.projects[0];
                this.projectSelectEl.value = this.selectedProject;
            }
        }
        await this.loadVolumes();
    }

    private async loadVolumes(): Promise<void> {
        this.volumes = [];
        if (this.selectedProject) {
            const stepRoot = `${this.selectedProject}/${SUBDIR_STEP_ROOT}`;
            const folder = this.app.vault.getAbstractFileByPath(stepRoot);
            if (folder && folder instanceof TFolder) {
                const volDirs = folder.children
                    .filter(c => c instanceof TFolder && c.name.startsWith('第') && c.name.endsWith('卷'))
                    .map(c => c.name)
                    .sort((a, b) => {
                        const aNum = parseInt(a.replace(/[^\d]/g, ''), 10) || 0;
                        const bNum = parseInt(b.replace(/[^\d]/g, ''), 10) || 0;
                        return aNum - bNum;
                    });
                this.volumes = volDirs;
            }
        }

        if (this.volumeSelectEl) {
            this.volumeSelectEl.empty();
            if (this.volumes.length === 0) {
                const opt = this.volumeSelectEl.createEl('option');
                opt.value = '';
                opt.text = '暂无卷';
                this.selectedVolume = '';
            } else {
                for (const v of this.volumes) {
                    const opt = this.volumeSelectEl.createEl('option');
                    opt.value = v;
                    opt.text = v;
                }
                this.selectedVolume = this.volumes[0];
                this.volumeSelectEl.value = this.selectedVolume;
            }
        }
        await this.loadChapters();
    }

    private async loadChapters(): Promise<void> {
        this.chapters = [];
        if (this.selectedProject && this.selectedVolume) {
            const chapDir = `${this.selectedProject}/${SUBDIR_STEP_ROOT}/${this.selectedVolume}`;
            const folder = this.app.vault.getAbstractFileByPath(chapDir);
            if (folder && folder instanceof TFolder) {
                const chapDirs = folder.children
                    .filter(c => c instanceof TFolder && c.name.startsWith('第') && c.name.endsWith('章'))
                    .map(c => c.name)
                    .sort((a, b) => {
                        const aNum = parseInt(a.replace(/[^\d]/g, ''), 10) || 0;
                        const bNum = parseInt(b.replace(/[^\d]/g, ''), 10) || 0;
                        return aNum - bNum;
                    });
                this.chapters = chapDirs;
            }
        }

        if (this.chapterSelectEl) {
            this.chapterSelectEl.empty();
            if (this.chapters.length === 0) {
                const opt = this.chapterSelectEl.createEl('option');
                opt.value = '';
                opt.text = '暂无章';
                this.selectedChapter = '';
            } else {
                for (const c of this.chapters) {
                    const opt = this.chapterSelectEl.createEl('option');
                    opt.value = c;
                    opt.text = c;
                }
                this.selectedChapter = this.chapters[0];
                this.chapterSelectEl.value = this.selectedChapter;
            }
        }
        await this.loadStepFiles();
    }

    private async loadStepFiles(): Promise<void> {
        this.stepFiles = [];
        if (!this.selectedProject || !this.selectedVolume || !this.selectedChapter) {
            this.renderFileList();
            return;
        }

        const chapDir = `${this.selectedProject}/${SUBDIR_STEP_ROOT}/${this.selectedVolume}/${this.selectedChapter}`;
        const folder = this.app.vault.getAbstractFileByPath(chapDir);
        if (!folder || !(folder instanceof TFolder)) {
            this.renderFileList();
            return;
        }

        const mdFiles = folder.children.filter(
            (c): c is TFile => c instanceof TFile && c.extension === 'md'
        );

        for (const file of mdFiles) {
            let frontmatter: ParsedStepFrontmatter | null = null;
            try {
                const content = await this.app.vault.read(file);
                frontmatter = parseStepFrontmatter(content);
            } catch {
                frontmatter = null;
            }

            const stepName = this.extractStepName(file, frontmatter);
            this.stepFiles.push({ file, stepName, frontmatter });
        }

        this.stepFiles.sort((a, b) => a.stepName.localeCompare(b.stepName, 'zh-Hans-CN'));
        this.renderFileList();
    }

    private extractStepName(file: TFile, fm: ParsedStepFrontmatter | null): string {
        const baseName = file.basename;
        const chapPrefixMatch = baseName.match(/^第\d+章[_-]*(.+)$/);
        if (chapPrefixMatch) {
            let name = chapPrefixMatch[1].trim();
            if (name.startsWith('_') || name.startsWith('-')) {
                name = name.slice(1).trim();
            }
            if (name) return name;
        }
        if (fm && fm.tags && fm.tags.length > 0) {
            const stepTag = fm.tags.find(t => t !== '步骤结果');
            if (stepTag) return stepTag;
        }
        return baseName;
    }

    private renderFileList(): void {
        if (!this.fileListEl) return;
        this.fileListEl.empty();

        if (this.stepFiles.length === 0) {
            const emptyTip = this.fileListEl.createDiv({
                attr: {
                    style: 'text-align: center; padding: 60px 20px; color: var(--text-muted); font-size: 14px;',
                },
            });
            emptyTip.createSpan({ text: '📭 暂无步骤结果文件' });
        } else {
            for (const info of this.stepFiles) {
                this.renderFileRow(info);
            }
        }

        this.updateInfoBar();
    }

    private renderFileRow(info: StepFileInfo): void {
        if (!this.fileListEl) return;

        const row = this.fileListEl.createDiv({
            attr: {
                style: 'display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 6px; cursor: pointer; margin-bottom: 6px; border: 1px solid var(--background-modifier-border); transition: background 0.15s;',
            },
        });

        row.addEventListener('mouseenter', () => {
            row.style.background = 'var(--background-modifier-hover)';
        });
        row.addEventListener('mouseleave', () => {
            row.style.background = '';
        });
        row.addEventListener('click', () => {
            this.openFile(info.file);
        });

        const nameCol = row.createDiv({
            attr: { style: 'flex: 1; min-width: 0;' },
        });
        nameCol.createDiv({
            text: info.stepName,
            attr: {
                style: 'font-weight: 500; font-size: 14px; color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
            },
        });
        nameCol.createDiv({
            text: info.file.name,
            attr: {
                style: 'font-size: 11px; color: var(--text-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
            },
        });

        const status = info.frontmatter?.step_status || 'unknown';
        const statusInfo = STATUS_COLORS[status as StepStatus | 'unknown'] || STATUS_COLORS.unknown;
        const statusLabel = STATUS_LABELS[status as StepStatus | 'unknown'] || STATUS_LABELS.unknown;

        const badge = row.createSpan({
            text: statusLabel,
            attr: {
                style: `padding: 2px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; flex-shrink: 0; background: ${statusInfo.bg}; color: ${statusInfo.text};`,
            },
        });

        const model = info.frontmatter?.step_model || '未知模型';
        const modelEl = row.createSpan({
            text: model,
            attr: {
                style: 'font-size: 12px; color: var(--text-muted); flex-shrink: 0; max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
            },
        });

        const timestamp = info.frontmatter?.step_timestamp;
        const timeStr = timestamp ? this.formatTimestamp(timestamp) : '未知时间';
        const timeEl = row.createSpan({
            text: timeStr,
            attr: {
                style: 'font-size: 11px; color: var(--text-faint, var(--text-muted)); flex-shrink: 0; white-space: nowrap;',
            },
        });
    }

    private updateInfoBar(): void {
        if (!this.infoBarEl) return;
        this.infoBarEl.empty();

        const countSpan = this.infoBarEl.createSpan({
            text: `共 ${this.stepFiles.length} 个步骤结果文件`,
            attr: { style: 'font-size: 12px; color: var(--text-muted);' },
        });

        if (this.selectedProject && this.selectedVolume && this.selectedChapter) {
            const openFolderBtn = this.infoBarEl.createEl('button', {
                text: '📂 打开文件夹',
                cls: 'nw-btn nw-btn-secondary nw-btn-sm',
            });
            openFolderBtn.addEventListener('click', () => {
                // U11（技术审计）：showInFolder 为桌面端 Electron 专属能力，
                // 移动端无系统文件管理器概念，原实现静默失败，改为明确提示
                if (Platform.isMobile) {
                    new Notice('📱 移动端不支持打开系统文件夹，请在桌面版操作');
                    return;
                }
                const chapDir = `${this.selectedProject}/${SUBDIR_STEP_ROOT}/${this.selectedVolume}/${this.selectedChapter}`;
                const folder = this.app.vault.getAbstractFileByPath(chapDir);
                if (folder) {
                    this.app.showInFolder?.(folder.path);
                }
            });
        }
    }

    private formatTimestamp(iso: string): string {
        try {
            const date = new Date(iso);
            if (isNaN(date.getTime())) return iso;
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        } catch {
            return iso;
        }
    }

    private openFile(file: TFile): void {
        this.app.workspace.openLinkText(file.path, '');
    }

    onClose(): void {
        this.projects = [];
        this.volumes = [];
        this.chapters = [];
        this.selectedProject = '';
        this.selectedVolume = '';
        this.selectedChapter = '';
        this.stepFiles = [];
        this.projectSelectEl = null;
        this.volumeSelectEl = null;
        this.chapterSelectEl = null;
        this.fileListEl = null;
        this.infoBarEl = null;
        this.contentEl.empty();
    }
}
