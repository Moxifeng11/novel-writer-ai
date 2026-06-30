/**
 * P0-5: 分卷大纲树状预览控制器 — 可折叠、可编辑冲突/概览、带搜索框
 *
 * 从 FullWriterView 外迁而来：原 renderOutlineTreeView / _loadOutlineTreeData /
 * _saveOutlineChapterData 三个方法，以及 _otvData / _otvCollapsed 两个状态字段。
 * 控制器自管内部缓存，不回调 view 的 private 成员（避免 TS2341）。
 */
import { App, TFile } from 'obsidian';
import { showSuccess } from '../../utils/helpers';
import { OutlineTreeVolume, OutlineTreeChapter } from '../../shared/types';
import { pjVolumeOutlineDir, pjVolumeOutlineFile, pjBodyDir, pjStepDir } from '../../shared/paths';

export class OutlineTreeController {
    private app: App;
    private getProject: () => string | undefined;

    // 树状预览数据缓存（跨渲染保持）
    private _otvData?: { volumes: OutlineTreeVolume[] };
    private _otvCollapsed?: Set<string>;

    constructor(app: App, getProject: () => string | undefined) {
        this.app = app;
        this.getProject = getProject;
    }

    async render(area: HTMLElement): Promise<void> {
        const project = this.getProject();
        if (!project) return;

        area.empty();
        const container = area.createDiv({ cls: 'novel-writer-otv-container' });

        // 搜索框
        const searchRow = container.createDiv({ attr: { style: 'margin-bottom:10px;display:flex;gap:8px;align-items:center;' } });
        searchRow.createSpan({ text: '🔍', attr: { style: 'font-size:14px;' } });
        const searchInput = searchRow.createEl('input', {
            attr: { type: 'text', placeholder: '搜索章号或关键词...', style: 'flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);' }
        }) as HTMLInputElement;

        const treeRoot = container.createDiv({ cls: 'novel-writer-otv-tree' });

        // 状态存储（跨渲染保持）
        if (!this._otvData) this._otvData = { volumes: [] };
        if (!this._otvCollapsed) this._otvCollapsed = new Set<string>();

        // 首次或强制刷新时从磁盘加载
        if (this._otvData.volumes.length === 0) {
            await this._loadOutlineTreeData();
        }

        const renderTree = () => {
            treeRoot.empty();
            const keyword = searchInput.value.trim().toLowerCase();

            for (const vol of this._otvData!.volumes) {
                // 卷级：可折叠
                const volId = `vol-${vol.num}`;
                const volCollapsed = this._otvCollapsed!.has(volId);
                const volMatch = !keyword || vol.title.toLowerCase().includes(keyword) || String(vol.num).includes(keyword);

                const volRow = treeRoot.createDiv({ cls: 'novel-writer-otv-vol-row', attr: { style: 'display:flex;align-items:center;gap:6px;padding:6px 0;cursor:pointer;' } });
                const toggleIcon = volRow.createSpan({ text: volCollapsed ? '▶' : '▼', attr: { style: 'font-size:10px;width:16px;text-align:center;' } });
                const volTitleEl = volRow.createSpan({ text: `📘 ${vol.title}`, attr: { style: 'font-weight:bold;font-size:14px;' } });
                if (!volMatch) volRow.style.opacity = '0.4';

                volRow.onclick = () => {
                    if (this._otvCollapsed!.has(volId)) this._otvCollapsed!.delete(volId);
                    else this._otvCollapsed!.add(volId);
                    renderTree();
                };

                if (!volCollapsed) {
                    const chapContainer = treeRoot.createDiv({ attr: { style: 'padding-left:24px;' } });
                    for (const ch of vol.chapters) {
                        const chMatch = !keyword || ch.summary.toLowerCase().includes(keyword) || String(ch.num).includes(keyword);
                        if (keyword && !volMatch && !chMatch) continue;

                        const chRow = chapContainer.createDiv({ cls: 'novel-writer-otv-ch-row', attr: { style: 'padding:4px 0;' } });
                        const chHeader = chRow.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;' } });
                        chHeader.createSpan({ text: `第${ch.num}章`, attr: { style: 'font-weight:bold;color:var(--text-accent);min-width:56px;' } });

                        // 冲突字段（可编辑）
                        const conflictInput = chHeader.createEl('input', {
                            attr: { type: 'text', value: ch.conflict || '', placeholder: '核心冲突', style: 'flex:1;padding:2px 6px;font-size:12px;border-radius:3px;border:1px solid var(--background-modifier-border);' }
                        }) as HTMLInputElement;

                        // 概览字段（可编辑）
                        const summaryRow = chRow.createDiv({ attr: { style: 'margin-top:2px;margin-left:64px;' } });
                        const summaryInput = summaryRow.createEl('input', {
                            attr: { type: 'text', value: ch.summary || '', placeholder: '一句话概览...', style: 'width:100%;padding:2px 6px;font-size:12px;border-radius:3px;border:1px solid var(--background-modifier-border);' }
                        }) as HTMLInputElement;

                        // 保存按钮（每个章节一行）
                        const saveLink = chRow.createDiv({ attr: { style: 'text-align:right;margin-top:2px;' } });
                        const saveBtn = saveLink.createEl('button', {
                            text: '💾', attr: { style: 'padding:1px 8px;font-size:11px;border-radius:3px;border:1px solid var(--background-modifier-border);cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);' }
                        });
                        saveBtn.onclick = async () => {
                            const newConflict = conflictInput.value.trim();
                            const newSummary = summaryInput.value.trim();
                            ch.conflict = newConflict;
                            ch.summary = newSummary;
                            await this._saveOutlineChapterData(ch.num, newConflict, newSummary);
                            showSuccess(`第${ch.num}章 已保存`);
                        };
                    }
                }
            }
        };

        renderTree();
    }

    /** 从分卷大纲和各章大纲摘要加载树数据 */
    private async _loadOutlineTreeData(): Promise<void> {
        const project = this.getProject();
        if (!project) return;

        // v4.0：分卷大纲按卷归档，拼接所有 第N卷_分卷大纲.md 后再按 ### 第N卷 分块
        const volumeDir = pjVolumeOutlineDir(project);
        const volumeFiles = this.app.vault.getFiles()
            .filter(f => f.path.startsWith(`${volumeDir}/`) && f.name.endsWith('_分卷大纲.md'))
            .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'));
        if (volumeFiles.length === 0) {
            console.warn('[OutlineTree] 未找到分卷大纲目录:', volumeDir);
            return;
        }
        const parts: string[] = [];
        for (const f of volumeFiles) {
            try { parts.push(await this.app.vault.read(f)); } catch (e) { console.warn('[OutlineTree] 读取失败', f.path, e); }
        }
        const planContent = parts.join('\n\n');
        const volumes: OutlineTreeVolume[] = [];

        // 解析 ### 第N卷 块
        const volSections = planContent.split(/^###\s+第(\d+)卷/gm);
        for (let i = 1; i < volSections.length; i += 2) {
            const volNum = parseInt(volSections[i]);
            const volBody = volSections[i + 1] || '';

            // 提取卷名
            const titleMatch = volBody.match(/\*\*卷名\*\*[：:]\s*《?(.+?)》?/);
            const volTitle = titleMatch ? titleMatch[1].trim() : `第${volNum}卷`;

            // 提取章节范围
            const rangeMatch = volBody.match(/\*\*章节范围\*\*[：:]\s*第(\d+)章\s*[-–—]\s*第(\d+)章/);
            const startCh = rangeMatch ? parseInt(rangeMatch[1]) : 1;
            const endCh = rangeMatch ? parseInt(rangeMatch[2]) : 1;

            // 提取核心冲突表格
            const conflictMap: Map<number, string> = new Map();
            const tableRegex = /\|(\d+)\s*\|(.+?)\|/g;
            let m;
            while ((m = tableRegex.exec(volBody)) !== null) {
                const chNum = parseInt(m[1]);
                const conflict = m[2].trim();
                if (!isNaN(chNum) && conflict && conflict !== '...') {
                    conflictMap.set(chNum, conflict);
                }
            }

            const chapters: OutlineTreeChapter[] = [];
            for (let chNum = startCh; chNum <= endCh; chNum++) {
                const chapName = `第${chNum}章`;
                // 尝试读取大纲摘要
                let summary = '';
                try {
                    // v4.0：大纲摘要位于 步骤结果/第N卷/第M章/
                    const stepDir = pjStepDir(project, volNum, chNum);
                    const outlineFiles = this.app.vault.getFiles().filter(f =>
                        f.path.startsWith(`${stepDir}/`) &&
                        f.name.includes(chapName) &&
                        f.name.includes('大纲摘要')
                    );
                    if (outlineFiles.length > 0) {
                        const content = await this.app.vault.read(outlineFiles[0]);
                        // 提取全书定位或第一段非空内容作为概览
                        const locMatch = content.match(/全书定位[：:]\s*(.+)/);
                        if (locMatch) {
                            summary = locMatch[1].trim().slice(0, 50);
                        } else {
                            // 回退：取第一段非空、非标题、非表格内容
                            const lines = content.split('\n');
                            for (const line of lines) {
                                const t = line.trim();
                                if (t && !t.startsWith('#') && !t.startsWith('|') && !t.startsWith('-') && !t.startsWith('>') && t.length > 10) {
                                    summary = t.slice(0, 50);
                                    break;
                                }
                            }
                        }
                    }
                } catch { /* ignore */ }

                chapters.push({
                    num: chNum,
                    conflict: conflictMap.get(chNum) || '',
                    summary
                });
            }

            volumes.push({ num: volNum, title: volTitle, chapters });
        }

        this._otvData!.volumes = volumes;
    }

    /** 保存单章数据：冲突写回分卷大纲表格，概览写回大纲摘要 */
    private async _saveOutlineChapterData(chNum: number, conflict: string, summary: string): Promise<void> {
        const project = this.getProject();
        if (!project) return;

        // v4.0：分卷大纲按卷归档，定位章号所在卷
        const volDir = pjVolumeOutlineDir(project);
        const volumeFiles = this.app.vault.getFiles()
            .filter(f => f.path.startsWith(`${volDir}/`) && f.name.endsWith('_分卷大纲.md'));

        let targetFile: TFile | null = null;
        let targetVolN = 0;
        for (const f of volumeFiles) {
            const content = await this.app.vault.read(f);
            const rangeMatch = content.match(/\*\*章节范围\*\*[：:]\s*第(\d+)章\s*[-–—]\s*第(\d+)章/);
            if (rangeMatch) {
                const s = parseInt(rangeMatch[1]);
                const e = parseInt(rangeMatch[2]);
                if (chNum >= s && chNum <= e) {
                    targetFile = f;
                    const volMatch = f.name.match(/^第(\d+)卷/);
                    if (volMatch) targetVolN = parseInt(volMatch[1], 10);
                    break;
                }
            }
        }

        if (targetFile) {
            let content = await this.app.vault.read(targetFile);
            const tableRowRegex = new RegExp(`(\\|\\s*${chNum}\\s*\\|)\\s*(.*?)\\s*\\|`, 'g');
            content = content.replace(tableRowRegex, `$1 ${conflict} |`);
            await this.app.vault.modify(targetFile, content);
        }

        // 保存概览到该章大纲摘要
        if (summary && targetVolN > 0) {
            const stepDir = pjStepDir(project, targetVolN, chNum);
            const allFiles = this.app.vault.getFiles();
            const outlineFile = allFiles.find(f =>
                f.path.startsWith(`${stepDir}/`) &&
                f.name.includes(`第${chNum}章`) &&
                f.name.includes('大纲摘要')
            );
            if (outlineFile instanceof TFile) {
                let content = await this.app.vault.read(outlineFile);
                if (content.includes('全书定位')) {
                    content = content.replace(/全书定位[：:].*/g, `全书定位：${summary}`);
                } else {
                    content = content.replace(/^(##\s)/m, `全书定位：${summary}\n\n$1`);
                }
                await this.app.vault.modify(outlineFile, content);
            }
        }
    }
}
