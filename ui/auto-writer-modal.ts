/**
 * @deprecated Legacy 自动写作器 Modal（命令 ID: novel-writer-auto-writer, 显示名带"〔旧〕"）。
 *
 * 当前推荐入口：完整写作工作台（FullWriterView，含批量与自动模式）。
 *
 * Rev 184 改革：不再自造 prompt / 上下文装配，逐章调用
 * `WriteChapterModal.doWriteChapter`（= 工作台同款 buildChapterPrompts + BodyWriter）。
 * 章范围以「已建骨架」为准，不再只取已有正文，否则新章永远无法被选中。
 */
import { App, Modal, Notice } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ContextManager } from '../engine/context-manager';
import { listChapterNumbers } from '../engine/chapter-utils';
import { showSuccess, showError } from '../utils/helpers';
import { pjStepDir, SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT } from '../shared/paths';
import { WriteChapterModal } from './write-chapter-modal';
import { createLogger } from '../shared/logger';


const log = createLogger('AutoWriterModal');

/**
 * AutoWriterModal 类。
 */
export class AutoWriterModal extends Modal {
    private plugin: NovelWriterPlugin;
    private contextManager: ContextManager;
    private abortController: AbortController | null = null;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.contextManager = plugin.ctxManager;
    }

    /**
     * onOpen 方法。
     */
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
        contentEl.empty();
        contentEl.addClass('nw-form-stack');

        contentEl.createEl('h2', {
            text: '🤖 自动写作器〔旧〕',
            attr: { style: 'margin:0; font-size:18px;' },
        });

        const grid = contentEl.createDiv({ cls: 'nw-form-grid' });

        const projectWrap = grid.createDiv({ cls: 'nw-form-field' });
        projectWrap.createEl('label', { text: '项目', cls: 'nw-form-label' });
        const projectSelect = projectWrap.createEl('select', { cls: 'nw-select' });

        const volWrap = grid.createDiv({ cls: 'nw-form-field' });
        volWrap.createEl('label', { text: '卷', cls: 'nw-form-label' });
        const volSelect = volWrap.createEl('select', { cls: 'nw-select' });

        const startWrap = grid.createDiv({ cls: 'nw-form-field' });
        startWrap.createEl('label', { text: '起始章号', cls: 'nw-form-label' });
        const startInput = startWrap.createEl('input', { type: 'text', cls: 'nw-input', attr: { inputmode: 'numeric' } });

        const endWrap = grid.createDiv({ cls: 'nw-form-field' });
        endWrap.createEl('label', { text: '结束章号', cls: 'nw-form-label' });
        const endInput = endWrap.createEl('input', { type: 'text', cls: 'nw-input', attr: { inputmode: 'numeric' } });

        const rangeHint = contentEl.createDiv({ cls: 'nw-form-hint' });

        const populateProjects = async () => {
            const projects = await this.contextManager.detectProjects();
            if (projects.length === 0) {
                contentEl.createEl('p', { text: '❌ 未找到项目，请先创建新项目', cls: 'nw-text-error' });
                return;
            }

            for (const project of projects) {
                projectSelect.createEl('option', { value: project, text: project });
            }
            const preferred = this.plugin.getActiveProject();
            if (preferred && projects.includes(preferred)) projectSelect.value = preferred;

            await this.populateVolumes(projectSelect.value, volSelect);
            await this.populateChapterRange(projectSelect.value, volSelect.value, startInput, endInput, rangeHint);

            projectSelect.onchange = async () => {
                await this.populateVolumes(projectSelect.value, volSelect);
                await this.populateChapterRange(projectSelect.value, volSelect.value, startInput, endInput, rangeHint);
            };
            volSelect.onchange = async () => {
                await this.populateChapterRange(projectSelect.value, volSelect.value, startInput, endInput, rangeHint);
            };
        };

        const actions = contentEl.createDiv({ cls: 'nw-form-actions' });
        const cancelBtn = actions.createEl('button', { text: '取消', cls: 'nw-btn' });
        cancelBtn.onclick = () => this.close();
        const startButton = actions.createEl('button', { text: '开始自动写作', cls: 'nw-btn nw-btn-primary' });
        startButton.onclick = async () => {
            const startNum = parseInt(startInput.value, 10);
            const endNum = parseInt(endInput.value, 10);
            if (!Number.isFinite(startNum) || !Number.isFinite(endNum) || startNum > endNum) {
                showError('请输入有效的起止章号');
                return;
            }
            startButton.disabled = true;
            startButton.setText('写作中…');
            try {
                await this.runAutoWriter(projectSelect.value, volSelect.value, startNum, endNum);
            } finally {
                startButton.disabled = false;
                startButton.setText('开始自动写作');
            }
        };

        void populateProjects();
    }

    private async populateVolumes(project: string, selectEl: HTMLSelectElement): Promise<void> {
        selectEl.empty();
        const volDirs: string[] = [];
        for (const f of this.app.vault.getFiles()) {
            const m = f.path.match(new RegExp(`${project}/(?:${SUBDIR_BODY_ROOT}|${SUBDIR_STEP_ROOT})/(第\\d+卷)/`));
            if (m && !volDirs.includes(m[1])) volDirs.push(m[1]);
        }
        volDirs.sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)?.[0] || '0');
            const numB = parseInt(b.match(/\d+/)?.[0] || '0');
            return numA - numB;
        });
        if (volDirs.length === 0) {
            selectEl.createEl('option', { value: '', text: '未找到卷目录' });
            return;
        }
        for (const vol of volDirs) selectEl.createEl('option', { value: vol, text: vol });
    }

    private async populateChapterRange(
        project: string,
        volume: string,
        startInput: HTMLInputElement,
        endInput: HTMLInputElement,
        hintEl: HTMLElement,
    ): Promise<void> {
        const volN = parseInt(volume.match(/第(\d+)卷/)?.[1] || '0', 10);
        const chapters = volN > 0 ? listChapterNumbers(this.app, project, volN) : [];
        if (chapters.length > 0) {
            startInput.value = String(chapters[0]);
            endInput.value = String(chapters[chapters.length - 1]);
            hintEl.setText(`本卷已建 ${chapters.length} 章骨架（${chapters[0]}–${chapters[chapters.length - 1]}）`);
        } else {
            startInput.value = '';
            endInput.value = '';
            hintEl.setText('本卷尚未建章骨架，请先使用「批量建章」');
        }
    }

    private async runAutoWriter(project: string, volume: string, startNum: number, endNum: number): Promise<void> {
        if (!this.plugin.hasAiCredentials) {
            showError('请先配置 API 密钥或本地模型端点');
            return;
        }

        const volN = parseInt(volume.match(/第(\d+)卷/)?.[1] || '0', 10);
        if (volN <= 0) {
            showError('请先选择有效的卷');
            return;
        }

        // Rev 184：以「已建骨架」为准（步骤目录 ∪ 正文文件），不再只取已有正文
        const all = listChapterNumbers(this.app, project, volN);
        const targetNums = all.filter(n => n >= startNum && n <= endNum);
        if (targetNums.length === 0) {
            showError('区间内没有章节骨架：请先用「批量建章」创建章节');
            return;
        }

        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const total = targetNums.length;
        let done = 0;
        let failed = 0;
        const failedChapters: string[] = [];
        // 单条常驻提示复用到底：逐章新建 Notice 在整卷写作时会堆叠刷屏
        let notice: Notice | null = new Notice(`⏳ 自动写作: 0/${total}`, 0);

        for (const n of targetNums) {
            if (signal.aborted) break;
            const chapName = `第${n}章`;
            notice?.setMessage(`⏳ 自动写作: ${chapName}（${done + failed}/${total}）`);
            try {
                await WriteChapterModal.doWriteChapter(
                    this.app, this.plugin, this.plugin.aiEngine, this.plugin.reviewAgent,
                    project, volume, chapName, n, pjStepDir(project, volN, n), false, { signal }
                );
                if (signal.aborted) break;
                done++;
            } catch (e) {
                failed++;
                failedChapters.push(chapName);
                log.warn(`[AutoWriter] ${chapName} 失败`, e);
            }
            notice?.setMessage(`⏳ 自动写作: ${done + failed}/${total}`);
        }

        notice?.hide();
        notice = null;
        if (signal.aborted) {
            showSuccess(`已停止自动写作：完成 ${done}/${total} 章（失败 ${failed}）`);
        } else if (failed > 0) {
            const listed = failedChapters.slice(0, 5).join('、');
            const more = failedChapters.length > 5 ? '…' : '';
            showSuccess(`自动写作完成：成功 ${done}/${total}，失败 ${failed}（${listed}${more}）`);
        } else {
            showSuccess(`自动写作完成：${done}/${total} 章`);
        }
        this.close();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        // 关闭 ≠ 停止：必须显式中止在途 AI 调用，已完成章节保留
        this.abortController?.abort();
        this.abortController = null;
        this.contentEl.empty();
    }
}
