import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { CHAPTER_FILE_TYPES } from '../engine/chapter-utils';
import { pjBodyDir, pjControlDir, pjCharsDir, SUBDIR_WORLD_ARCH, SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT, pjForeshadowDB, pjTimelineBoard } from '../shared/paths';
import { mkdirp } from '../utils/helpers';
import { createLogger } from '../shared/logger';


const log = createLogger('CrossVolumeStateModal');
export class CrossVolumeStateModal extends Modal {
    private plugin: NovelWriterPlugin;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
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
        contentEl.createEl('h2', { text: '🔄 跨卷状态继承' });

        const projectSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });

        const populateProjects = async () => {
            const projects: string[] = [];
            for (const f of this.app.vault.getFiles()) {
                if (f.path.includes(`/${SUBDIR_WORLD_ARCH}/`) && !f.path.startsWith('.obsidian') && !f.path.startsWith('元文件')) {
                    const r = projectIdFromPath(f.path);
                    if (!projects.includes(r)) projects.push(r);
                }
            }

            if (!projects.length) {
                contentEl.createEl('p', { text: '❌ 未找到项目' });
                return;
            }

            projects.forEach(project => {
                projectSelect.createEl('option', { value: project, text: `📁 ${project}` });
            });

            const volSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });
            projectSelect.onchange = () => this.populateVolumes(projectSelect.value, volSelect);

            const generateButton = contentEl.createEl('button', { text: '生成状态快照', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
            generateButton.onclick = async () => {
                const project = projectSelect.value;
                const volName = volSelect.value;
                if (!project || !volName) {
                    new Notice('❌ 请选择项目和卷', 5000);
                    return;
                }
                await this.generateSnapshot(project, volName);
            };

            // 与工作台/项目页保持一致：优先当前项目，避免默认落到列表第一个
            const active = this.plugin.getActiveProject();
            const preferred = active && projects.includes(active) ? active : projects[0];
            await this.populateVolumes(preferred, volSelect);
        };

        populateProjects();
    }

    private async populateVolumes(project: string, volSelect: HTMLSelectElement): Promise<void> {
        volSelect.innerHTML = '';
        const volDirs: string[] = [];
        for (const f of this.app.vault.getFiles()) {
            // v4.0：正文位于 03-大纲与章节/正文/第N卷/，步骤结果位于 步骤结果/第N卷/
            const m = f.path.match(new RegExp(`${project}/(?:${SUBDIR_BODY_ROOT}|${SUBDIR_STEP_ROOT})/(第\\d+卷)/`));
            if (m && !volDirs.includes(m[1])) volDirs.push(m[1]);
        }
        if (!volDirs.length) {
            volSelect.createEl('option', { value: '', text: '❌ 未找到卷目录' });
            return;
        }
        volDirs.sort().forEach(vol => {
            volSelect.createEl('option', { value: vol, text: `📖 ${vol}` });
        });
    }

    private async generateSnapshot(project: string, volName: string): Promise<void> {
        // v4.0：正文位于 03-大纲与章节/正文/第N卷/
        const volN = parseInt(volName.match(/\d+/)?.[0] || '0');
        const bodyDir = pjBodyDir(project, volN);
        const chapFiles = this.app.vault.getFiles().filter(f =>
            f.path.startsWith(`${bodyDir}/`) && f.name.includes(CHAPTER_FILE_TYPES.body)
        );

        const chapNums = chapFiles.map(f => {
            const m = f.name.match(/第(\d+)章/);
            return m ? parseInt(m[1]) : 0;
        }).filter(n => n > 0).sort((a, b) => b - a);

        const lastChap = chapNums[0] || 0;

        let volumeContext = '';
        for (let n = 1; n <= lastChap; n++) {
            const cf = chapFiles.find(f => f.name.includes(`第${n}章`));
            if (cf) {
                const c = await this.app.vault.read(cf);
                volumeContext += `\n[第${n}章]${c.slice(-200)}`;
            }
        }

        let allChars = '';
        for (const f of this.app.vault.getFiles()) {
            if (f.path.startsWith(`${pjCharsDir(project)}/`) && f.name !== '人物模板.md') {
                const c = await this.app.vault.read(f);
                const fm = c.match(/^---\n([\s\S]*?)\n---/);
                if (fm) {
                    const g = (k: string) => {
                        const x = fm[1].match(new RegExp(`${k}:\\s*["']?(.+?)["']?(\n|$)`));
                        return x ? x[1].trim() : '—';
                    };
                    allChars += `\n- ${f.name.replace('.md', '')}：状态=${g('当前状态')}，动机=${g('核心动机')}，金手指=${g('金手指/特殊能力')}，身份=${g('身份')}`;
                }
            }
        }

        let unrevealed = '';
        try {
            const fp = `${pjForeshadowDB(project)}`;
            const ff = this.app.vault.getAbstractFileByPath(fp);
            if (ff instanceof TFile) {
                const fc = await this.app.vault.read(ff);
                for (const line of fc.split('\n')) {
                    if (!line.match(/^\|.*\|/)) continue;
                    const cols = line.split('|').map(s => s.trim()).filter(Boolean);
                    if (cols.length === 0) continue;
                    if (cols[0] === '#' || cols[0].includes('---') || cols[0] === '伏笔') continue;
                    const status = cols.length >= 6 ? cols[5] : cols[1] || '';
                    if (status.includes('未揭示') || status === '') {
                        const name = cols.length >= 6 ? cols[1] : cols[0];
                        unrevealed += `\n- ${name}`;
                    }
                }
            }
        } catch (e) { log.warn('[小说工坊] 操作失败:', e); }

        let timeline = '';
        try {
            const tlFile = this.app.vault.getAbstractFileByPath(`${pjTimelineBoard(project)}`);
            if (tlFile instanceof TFile) timeline = (await this.app.vault.read(tlFile)).slice(0, 1000);
        } catch (e) { log.warn('[小说工坊] 操作失败:', e); }

        // v4.0：状态快照权威位置统一到 04-项目总控/
        await mkdirp(this.app, pjControlDir(project));
        const snapshotPath = `${pjControlDir(project)}/${volName}_状态快照.md`;
        const snapshotContent = `---
tags: [状态快照]
卷: ${volName}
末章: 第${lastChap}章
---

# ${volName} 状态快照（跨卷继承用）

> 自动生成时间：${new Date().toLocaleString()}
> 生成于第${lastChap}章完成后

${lastChap > 0 ? `> 请将本快照作为下一卷第${lastChap + 1}章的写作上下文起点` : ''}

## 人物当前状态

${allChars || '（无活跃人物）'}

## 未揭示伏笔

${unrevealed || '（无活跃伏笔）'}

## 当前时间线

${timeline || '（无时间线事件）'}

---

## 本卷最大章节号

第${lastChap}章
`;

        let writeFailed = false;
        try {
            const existingSnapshot = this.app.vault.getAbstractFileByPath(snapshotPath);
            if (existingSnapshot instanceof TFile) {
                await this.app.vault.modify(existingSnapshot, snapshotContent);
            } else {
                await this.app.vault.create(snapshotPath, snapshotContent);
            }
        } catch (e) {
            writeFailed = true;
            log.warn('[小说工坊] 状态快照写入失败:', e);
            new Notice('❌ 状态快照保存失败，请检查磁盘空间', 6000);
        }

        if (!writeFailed) {
            new Notice(`✅ ${volName} 状态快照已生成`, 8000);
            const sf = this.app.vault.getAbstractFileByPath(snapshotPath);
            if (sf instanceof TFile) {
                await this.plugin.safeOpenFile(sf);
            }
        }

        this.close();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
import { projectIdFromPath } from '../shared/paths';
