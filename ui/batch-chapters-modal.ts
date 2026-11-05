/**
 * @deprecated Legacy 批量写正文 Modal（命令 ID: novel-writer-batch-chapters, 显示名带"〔旧〕"）。
 *
 * 当前推荐入口：完整写作工作台（FullWriterView）+ 续写规划（ContinueChaptersModal）。
 *
 * Rev 184 改革：删除自造 prompt（含《雪中悍刀行》范文）、自造续写/修正/结算，
 * 逐章调用 `WriteChapterModal.doWriteChapter`，与工作台共享 buildChapterPrompts
 * 与 BodyWriter。章范围以「已建骨架」为准，修复新章无法被选中的问题；
 * 「findChapterFile(整卷目录)」串章隐患随自造逻辑一并移除。
 */
import { App, Modal, Notice, TFile } from 'obsidian';
import { splitTableCells } from '@/shared/chapter-table';
import { parseForeshadowRevealState } from '@/shared/foreshadow-status';
import { entityDir } from '@/shared/entity-reader';
import NovelWriterPlugin from '@/main';
import { ContextManager } from '@/engine/context-manager';
import { listChapterNumbers } from '@/engine/chapter-utils';
import { showSuccess, showError, showWarning } from '@/utils/helpers';
import {
    pjStepDir, pjControlDir, pjForeshadowDB, pjInfoDebtBoard,
    SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT,
} from '@/shared/paths';
import { WriteChapterModal } from './write-chapter-modal';
import { createLogger } from '@/shared/logger';


const log = createLogger('BatchChaptersModal');

/**
 * BatchChaptersModal 类。
 */
export class BatchChaptersModal extends Modal {
    private plugin: NovelWriterPlugin;
    private contextManager: ContextManager;
    /** A6: 关闭弹窗即取消，避免「用户已取消但仍在后台写盘」 */
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
            text: '📝 批量写正文〔旧〕',
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

        contentEl.createEl('p', {
            text: '逐章执行与工作台一致的流水线（信息规划 → 大纲摘要 → 正文 → 分析报告 → 结算 → 审查），已有完整步骤会自动跳过。完成一批后刷新信息债看板。',
            attr: { style: 'color:var(--text-muted); font-size:12px; line-height:1.6; margin:0;' },
        });

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
        const generateButton = actions.createEl('button', { text: '开始批量写正文', cls: 'nw-btn nw-btn-primary' });
        generateButton.onclick = async () => {
            const startNum = parseInt(startInput.value, 10);
            const endNum = parseInt(endInput.value, 10);
            if (!Number.isFinite(startNum) || !Number.isFinite(endNum) || startNum > endNum) {
                showError('请输入有效的起止章号');
                return;
            }
            generateButton.disabled = true;
            generateButton.setText('写作中…');
            try {
                await this.batchWrite(projectSelect.value, volSelect.value, startNum, endNum);
            } finally {
                generateButton.disabled = false;
                generateButton.setText('开始批量写正文');
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

    private async batchWrite(project: string, volume: string, startNum: number, endNum: number): Promise<void> {
        if (!this.plugin.hasAiCredentials) {
            showError('请先配置 API 密钥或本地模型端点');
            return;
        }

        const volN = parseInt(volume.match(/第(\d+)卷/)?.[1] || '0', 10);
        if (volN <= 0) {
            showError('请先选择有效的卷');
            return;
        }

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
        // 全程复用同一条常驻提示：逐章 hide + 新建会在 50/100 章时刷屏并抖动
        let mainNotice: Notice | null = new Notice(`⏳ 批量写正文: 0/${total}`, 0);

        for (const n of targetNums) {
            if (signal.aborted) break;
            const chapName = `第${n}章`;
            mainNotice?.setMessage(`⏳ 批量写作: ${chapName}（${done + failed}/${total}）`);
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
                log.warn(`${chapName} 失败:`, e);
            }
            mainNotice?.setMessage(`⏳ 批量写正文: ${done + failed}/${total}`);
        }

        mainNotice?.hide();
        mainNotice = null;
        await this.refreshInfoDebt(project);
        if (signal.aborted) {
            showWarning(`已取消批量写正文：已完成 ${done}/${total} 章，后续章节未执行`);
        } else if (failed > 0) {
            const listed = failedChapters.slice(0, 5).join('、');
            const more = failedChapters.length > 5 ? '…' : '';
            showWarning(`批量写正文完成：成功 ${done}/${total}，失败 ${failed}（${listed}${more}）`);
        } else {
            showSuccess(`批量写正文完成：${done}/${total} 章`);
        }
        this.close();
    }

    /** 批量结束后刷新信息债看板（原逻辑保留） */
    private async refreshInfoDebt(project: string): Promise<void> {
        const files = this.app.vault.getFiles().filter(f => f.path.startsWith(project + '/'));
        const charF = files.filter(f => f.path.startsWith(entityDir(project, 'characters') + '/') && f.name.endsWith('.md') && f.name !== '人物模板.md');
        const chapF = files.filter(f => f.path.includes('正文') && f.name.endsWith('.md'));

        let unrevealed = 0, revealed = 0;
        try {
            const fp = pjForeshadowDB(project);
            const ff = this.app.vault.getAbstractFileByPath(fp);
            if (ff instanceof TFile) {
                const content = await this.app.vault.read(ff);
                for (const line of content.split('\n')) {
                    if (!line.match(/^\|.*\|/)) continue;
                    const cols = splitTableCells(line);
                    if (cols.length === 0) continue;
                    if (cols[0] === '#' || cols[0].includes('---') || cols[0] === '伏笔') continue;
                    const state = parseForeshadowRevealState(cols.length >= 6 ? cols[5] : cols[1] || '');
                    if (state === 'unrevealed') unrevealed++;
                    else if (state === 'revealed') revealed++;
                }
            }
        } catch (e) { log.warn('[小说工坊] 操作失败:', e); }

        const completedChaps = new Set<string>();
        for (const f of chapF) {
            try {
                const cache = this.app.metadataCache.getFileCache(f);
                const status = cache?.frontmatter?.status;
                if (status === 'written' || status === 'settled') {
                    completedChaps.add(f.name);
                }
            } catch (e) { log.warn('[小说工坊] 操作失败:', e); }
        }

        let charOk = 0, charMiss = 0;
        for (const f of charF) {
            try {
                const c = await this.app.vault.read(f);
                if (c.match(/^---\n[\s\S]*?\n---/)?.[0].includes('当前状态:')) charOk++;
                else charMiss++;
            } catch { charMiss++; }
        }

        const debtR = Math.min(15, unrevealed);
        const debtContent = `---
tags: [看板]
---

# 📊 信息债看板

> 自动刷新时间：${new Date().toLocaleString()}

## 章节进度
- 总章节文件：${chapF.length}
- 已完成正文：${completedChaps.size}

## 伏笔态势
- 未揭示伏笔：${unrevealed} ${unrevealed > 5 ? '⚠️ 偏高' : '✅ 正常'}
- 已揭示伏笔：${revealed}

## 健康度
- 信息债等级：${'🟢'.repeat(Math.max(0, 15 - debtR))}${'🔴'.repeat(debtR)} (${debtR}/15)

## 人物卡状态
- 已填写当前状态：${charOk}
- 状态待更新：${charMiss}

## 提醒
${unrevealed > 10 ? '- ⚠️ 未揭示伏笔过多（信息债 🔴），建议优先回收' : unrevealed > 5 ? '- ⚡ 未揭示伏笔中等（信息债 🟡），注意穿插回收' : '- ✅ 伏笔生态健康'}
${charMiss > 0 ? `- ⚠️ ${charMiss}个人物未填写当前状态` : ''}
`;

        const debtP = pjInfoDebtBoard(project);
        try {
            const dir = pjControlDir(project);
            if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
            const existingDebtBoard = this.app.vault.getAbstractFileByPath(debtP);
            if (existingDebtBoard instanceof TFile) {
                await this.app.vault.modify(existingDebtBoard, debtContent);
            } else {
                await this.app.vault.create(debtP, debtContent);
            }
        } catch (e) {
            log.warn('[小说工坊] 信息债看板写入失败:', e);
            new Notice('⚠️ 信息债看板更新失败（不影响已生成的章节）', 6000);
        }
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        // A6: 关闭 ≠ 停止，必须显式取消在途 AI 调用，并让循环在下次检查时退出
        this.abortController?.abort();
        this.abortController = null;
        this.contentEl.empty();
    }
}
