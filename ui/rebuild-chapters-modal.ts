import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ContextManager } from '../engine/context-manager';
import { AIEngine } from '../engine/ai-engine';
import { mkdirp } from '../utils/helpers';
import { TemplateService } from '../services/template-service';
import { ENGINE_NAMES } from '../engine/engine-registry';
import { getChapterFileName, CHAPTER_FILE_TYPES, normalizeChapterFiles, getChapterFile, findChapterFile } from '../engine/chapter-utils';
import { readMergedVolumeOutline } from '../utils/helpers';
import { pjBodyDir, pjBodyFile, pjStepDir, SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT, pjForeshadowDB, pjTimelineBoard } from '../shared/paths';
import { createLogger } from '../shared/logger';


const log = createLogger('RebuildChaptersModal');
export class RebuildChaptersModal extends Modal {
    private plugin: NovelWriterPlugin;
    private contextManager: ContextManager;
    private aiEngine: AIEngine;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.contextManager = plugin.ctxManager;
        this.aiEngine = plugin.aiEngine;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();
        contentEl.createEl('h2', { text: '🔧 重建章节' });

        const projectSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });
        const volSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });
        const startInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: '起始章号',
            cls: 'nw-input novel-writer-input'
        });
        const endInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: '结束章号',
            cls: 'nw-input novel-writer-input'
        });

        const populateProjects = async () => {
            const projects = await this.contextManager.detectProjects();
            if (projects.length === 0) {
                contentEl.createEl('p', { text: '❌ 未找到项目，请先创建新项目' });
                return;
            }

            projects.forEach(project => {
                projectSelect.createEl('option', { value: project, text: project });
            });

            await this.populateVolumes(projectSelect.value, volSelect);

            projectSelect.onchange = async () => {
                await this.populateVolumes(projectSelect.value, volSelect);
            };

            const rebuildButton = contentEl.createEl('button', { text: '开始重建', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
            rebuildButton.onclick = async () => {
                const project = projectSelect.value;
                const volume = volSelect.value;
                const startNum = parseInt(startInput.value);
                const endNum = parseInt(endInput.value);

                if (!startNum || !endNum || startNum > endNum) {
                    new Notice('❌ 请输入有效的起止章号', 5000);
                    return;
                }

                await this.rebuild(project, volume, startNum, endNum);
            };
        };

        populateProjects();
    }

    private async populateVolumes(project: string, selectEl: HTMLSelectElement): Promise<void> {
        selectEl.innerHTML = '';
        const volDirs: string[] = [];
        for (const f of this.app.vault.getFiles()) {
            // v4.0：卷目录位于 正文/ 与 步骤结果/ 之下
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
        } else {
            volDirs.forEach(vol => {
                selectEl.createEl('option', { value: vol, text: vol });
            });
        }
    }

    private async rebuild(project: string, volume: string, startNum: number, endNum: number): Promise<void> {
        // v4.0：合并读取 分卷大纲/第N卷_分卷大纲.md（兼容旧单文件）
        const plan = await readMergedVolumeOutline(this.app, project);
        if (!plan || plan.trim().length === 0) {
            new Notice('❌ 未找到分卷大纲', 5000);
            return;
        }

        const rows = this.parseChapRows(plan, volume);
        const volN = parseInt(volume.match(/\d+/)?.[0] || '0');
        const total = endNum - startNum + 1;

        const confirm = window.confirm(`将重建第${startNum}-${endNum}章（共${total}章）。\n✅ 保留已有正文、分析报告等内容\n🔄 仅重建缺失的信息规划/大纲摘要骨架\n确认？`);
        if (!confirm) return;

        let mainNotice = new Notice(`⏳ 正在重建章节: 0/${total}`, 0);

        try {
            const chapNames = Array.from({ length: total }, (_, i) => `第${startNum + i}章`);
            const fp = `${pjForeshadowDB(project)}`;
            const ff = this.app.vault.getAbstractFileByPath(fp);
            if (ff instanceof TFile) {
                let fc = await this.app.vault.read(ff);
                const before = fc;
                fc = fc.split('\n').filter(l => {
                    if (!l.match(/^\|.*\|/)) return true;
                    const cols = l.split('|').map(s => s.trim());
                    if (cols.length < 2) return true;
                    if (cols[0] === '#' || cols[0].includes('---') || cols[0] === '伏笔') return true;
                    if (cols.length >= 4 && chapNames.includes(cols[3].trim())) return false;
                    return true;
                }).join('\n');
                if (fc !== before) await this.app.vault.modify(ff, fc);
            }

            const tp = `${pjTimelineBoard(project)}`;
            const tf = this.app.vault.getAbstractFileByPath(tp);
            if (tf instanceof TFile) {
                let tc = await this.app.vault.read(tf);
                const before = tc;
                tc = tc.split('\n').filter(l => {
                    if (!l.match(/^\|.*\|/)) return true;
                    const cols = l.split('|').map(s => s.trim());
                    if (cols.length < 2) return true;
                    if (cols[0] === '#' || cols[0].includes('---') || cols[0] === '时间') return true;
                    if (cols.length >= 2 && chapNames.includes(cols[1].trim())) return false;
                    return true;
                }).join('\n');
                if (tc !== before) await this.app.vault.modify(tf, tc);
            }
        } catch (e) { log.warn('清理伏笔/时间线失败:', e); }

        const templateService = this.plugin.engineRegistry.get<TemplateService>(ENGINE_NAMES.TEMPLATE_SERVICE);

        let done = 0;
        let preserved = 0;
        // U7（技术审计）：批量单项失败此前仅写日志用户不可见，收集失败清单供结束汇总
        const failures: string[] = [];
        for (let n = startNum; n <= endNum; n++) {
            const chapName = `第${n}章`;
            const bodyDir = pjBodyDir(project, volN);
            const stepDir = pjStepDir(project, volN, n);

            const vars = {
                project,
                volume,
                chapterName: chapName,
                chapterNumber: n,
            };

            mainNotice.hide();
            mainNotice = new Notice(`⏳ 正在重建: ${chapName}（${done}/${total}）`, 0);

            try {
                await mkdirp(this.app, bodyDir);
                await mkdirp(this.app, stepDir);

                const stepFolder = this.app.vault.getAbstractFileByPath(stepDir);
                if (stepFolder instanceof TFolder) {
                    await normalizeChapterFiles(this.app, stepFolder, chapName);
                }

                const row = rows?.find(r => r.num === n);

                const bodyFile = findChapterFile(this.app.vault.getFiles(), bodyDir, CHAPTER_FILE_TYPES.body, this.app) || null;
                let bodyExists = false;
                if (bodyFile) {
                    const bodyContent = await this.app.vault.read(bodyFile);
                    const bodyBody = bodyContent.replace(/^---[\s\S]*?---/, '').trim();
                    const hasWrittenStatus = bodyContent.includes('status: 已完稿') || bodyContent.includes('status: written') || bodyContent.includes('status: settled');
                    if (hasWrittenStatus) {
                        bodyExists = true;
                        preserved++;
                    } else if (bodyBody.length > 500) {
                        bodyExists = true;
                        preserved++;
                        // 有实质内容但无完稿标记 → 设 draft 状态（协同写作逻辑一致）
                        await this.app.fileManager.processFrontMatter(bodyFile, (fm) => {
                            if (!fm['status'] || fm['status'] === 'pending' || fm['status'] === 'draft') {
                                fm['status'] = 'draft';
                            }
                        });
                    }
                }
                if (!bodyExists) {
                    const bodyContent = await templateService.getBodyTemplate(vars);
                    const bodyPath = pjBodyFile(project, volN, n);
                    if (!this.app.vault.getAbstractFileByPath(bodyPath)) {
                        await this.app.vault.create(bodyPath, bodyContent);
                    }
                }

                const stepFolderForInfo = stepFolder instanceof TFolder ? stepFolder : null;
                const infoFile = stepFolderForInfo ? getChapterFile(stepFolderForInfo, CHAPTER_FILE_TYPES.infoPlan) : null;
                let infoExists = false;
                if (infoFile) {
                    const infoContent = await this.app.vault.read(infoFile);
                    const infoBody = infoContent.replace(/^---[\s\S]*?---/, '').trim();
                    if (infoBody.length > 150) infoExists = true;
                }
                if (!infoExists) {
                    const infoContent = await templateService.getInfoPlanTemplate(vars);
                    const infoPath = `${stepDir}/${getChapterFileName(chapName, CHAPTER_FILE_TYPES.infoPlan)}`;
                    const existingInfo = this.app.vault.getAbstractFileByPath(infoPath);
                    if (existingInfo instanceof TFile) {
                        await this.app.vault.modify(existingInfo, infoContent);
                    } else if (!existingInfo) {
                        await this.app.vault.create(infoPath, infoContent);
                    }
                }

                const outlineFile = stepFolderForInfo ? getChapterFile(stepFolderForInfo, CHAPTER_FILE_TYPES.outline) : null;
                let outlineExists = false;
                if (outlineFile) {
                    const outlineContent = await this.app.vault.read(outlineFile);
                    const outlineBody = outlineContent.replace(/^---[\s\S]*?---/, '').trim();
                    const isSkeleton = outlineBody.includes('（待 auto_writer') || outlineBody.includes('（待定）') || outlineBody.length < 100;
                    if (!isSkeleton) outlineExists = true;
                }
                if (!outlineExists) {
                    let outlineContent = await templateService.getOutlineTemplate(vars);
                    if (row?.conflict) {
                        outlineContent = outlineContent.replace('> 钩子内容：', `> 核心冲突：${row.conflict}\n\n> 钩子内容：`);
                    }
                    const outlinePath = `${stepDir}/${getChapterFileName(chapName, CHAPTER_FILE_TYPES.outline)}`;
                    const existingOutline = this.app.vault.getAbstractFileByPath(outlinePath);
                    if (existingOutline instanceof TFile) {
                        await this.app.vault.modify(existingOutline, outlineContent);
                    } else if (!existingOutline) {
                        await this.app.vault.create(outlinePath, outlineContent);
                    }
                }

                done++;
                new Notice(`✅ ${chapName}完成（${done}/${total}）${bodyExists ? '〔正文已保留〕' : ''}`, 5000);
            } catch (e) {
                log.warn('重建失败:', chapName, e);
                failures.push(chapName);
            }
        }

        mainNotice.hide();
        // U7：失败项汇总反馈（截取前 5 个避免 Notice 过长，完整原因见控制台日志）
        if (failures.length > 0) {
            new Notice(`⚠️ 重建完成：成功 ${done}/${total} 章，失败 ${failures.length} 章（${failures.slice(0, 5).join('、')}${failures.length > 5 ? ' 等' : ''}），原因详见控制台`, 10000);
        } else {
            new Notice(`✅ 重建完成：${done}/${total} 章${preserved > 0 ? `（保留 ${preserved} 章已有正文）` : ''}`, 8000);
        }
        this.close();
    }

    private parseChapRows(plan: string, volName: string): { num: number; name: string; conflict: string }[] | null {
        const vs = plan.match(new RegExp(`### ${volName}[\\s\\S]*?(?=### 第\\d+卷|$)`))?.[0] || '';
        const rows: { num: number; name: string; conflict: string }[] = [];
        const lines = vs.split('\n');
        let inTable = false;

        for (const l of lines) {
            if (l.trim() === '| 章号 | 核心冲突 |') {
                inTable = true;
                continue;
            }
            if (inTable && l.match(/^\|.*\|/)) {
                if (l.includes('---')) continue;
                const c = l.split('|').map(s => s.trim()).filter(Boolean);
                if (c.length >= 1 && (c[0] === '...' || c[0] === '…')) continue;
                if (c.length >= 1 && /^\d+$/.test(c[0])) {
                    rows.push({ num: parseInt(c[0]), name: '', conflict: (c.length >= 2 ? c[1] : '') || '' });
                }
            }
            if (inTable && l.startsWith('#')) break;
        }

        return rows.length ? rows : null;
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
