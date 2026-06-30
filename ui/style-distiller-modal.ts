import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from '../engine/ai-engine';
import { ensureWritingStyleFolder, findWritingStyleFile, getWritingStyleBackupPath, getWritingStyleWritePath } from './writing-style-paths';

export class StyleDistillerModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.style.setProperty('max-width', 'min(620px, 90vw)', 'important');
            wrapper.style.setProperty('width', 'min(620px, 90vw)', 'important');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.maxWidth = 'min(620px, 90vw)';
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');

        contentEl.empty();
        contentEl.createEl('h2', { text: '🎨 文笔风格蒸馏' });

        contentEl.createEl('p', { text: '输入小说名，AI自动分析其文笔风格特征' });

        const input = contentEl.createEl('input', {
            type: 'text',
            placeholder: '输入小说名（可加作者名，如「斩神·三九音域」）',
            cls: 'nw-input novel-writer-input'
        });

        const distillButton = contentEl.createEl('button', { text: '开始分析', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        distillButton.onclick = async () => {
            const novelName = input.value.trim();
            if (!novelName) {
                new Notice('❌ 请输入小说名', 5000);
                return;
            }
            await this.distillStyle(novelName);
        };
    }

    private async distillStyle(novelName: string): Promise<void> {
        if (!this.plugin.settings.apiKey) {
            new Notice('❌ 请先配置API密钥', 5000);
            return;
        }

        const genNotice = new Notice(`⏳ 正在分析《${novelName}》的文笔风格...`, 0);

        const result = await this.aiEngine.analyzeStyle(novelName);

        genNotice.hide();

        if (result.error) {
            new Notice(`❌ API调用失败: ${result.error}`, 8000);
            return;
        }

        const styleContent = `---
tags: [文笔风格]
source: ai-generated
来源: ${novelName}
蒸馏时间: ${new Date().toLocaleString()}
---

# 文笔风格：${novelName}

> 从《${novelName}》蒸馏的文笔风格特征。
> 蒸馏工具：小说工坊 AI 文笔风格蒸馏

---

${result.content}

---

> 💡 此文件由 AI 文笔风格蒸馏生成。写作脚本会自动加载其中的风格要求到 AI System Prompt。
> 可根据需要修改、增删内容。
`;

        // 检测当前活动项目
        const activeProject = this.getActiveProject();

        if (activeProject) {
            // 有活跃项目，询问写入目标
            await this.showSaveTargetModal(novelName, styleContent, activeProject);
        } else {
            // 无活跃项目，直接存入文笔风格库
            await this.saveToStyleLib(novelName, styleContent);
            this.close();
        }
    }

    /** 从当前活动文件检测项目名 */
    private getActiveProject(): string | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return null;
        const project = activeFile.path.split('/')[0];
        // 排除系统目录
        if (project === '元文件' || project === '文笔风格库' || project.startsWith('.')) return null;
        // 确认是项目目录。`.project` 点文件不入 vault 索引，改用被索引的项目文件夹判定。
        const folder = this.app.vault.getAbstractFileByPath(project);
        return folder instanceof TFolder ? project : null;
    }

    /** 显示保存目标选择弹窗 */
    private async showSaveTargetModal(novelName: string, styleContent: string, activeProject: string): Promise<void> {
        const modal = new Modal(this.app);
        modal.titleEl.setText('💾 保存文笔风格');

        const content = modal.contentEl.createDiv({ attr: { style: 'padding: 20px;' } });
        content.createEl('p', {
            text: `文笔风格分析完成！当前项目：「${activeProject}」`,
            attr: { style: 'font-size: 1em; font-weight: 600; margin-bottom: 12px;' }
        });
        content.createEl('p', {
            text: '请选择保存位置：',
            attr: { style: 'margin-bottom: 16px;' }
        });

        const btnRow = content.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 8px;' } });

        const projectBtn = btnRow.createEl('button', {
            text: `📁 写入当前项目（${getWritingStyleWritePath(activeProject)}）`,
            attr: { style: 'padding: 10px 16px; background: var(--nw-btn-primary-bg, #7c3aed); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 0.9em;' }
        });
        projectBtn.onclick = async () => {
            modal.close();
            await this.saveToProject(activeProject, styleContent);
            this.close();
        };

        const libBtn = btnRow.createEl('button', {
            text: '📚 存入文笔风格库',
            attr: { style: 'padding: 10px 16px; background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 8px; cursor: pointer; font-size: 0.9em;' }
        });
        libBtn.onclick = async () => {
            modal.close();
            await this.saveToStyleLib(novelName, styleContent);
            this.close();
        };

        modal.open();
    }

    /** 写入当前项目的文笔风格.md（自动备份旧文件） */
    private async saveToProject(projectName: string, styleContent: string): Promise<void> {
        const wsPath = getWritingStyleWritePath(projectName);
        try {
            await ensureWritingStyleFolder(this.app, projectName);

            // 如果已有文笔风格文件，先备份（兼容新旧路径）
            const existingFile = await findWritingStyleFile(this.app, projectName, { allowPlaceholder: true });
            if (existingFile) {
                const dateStr = new Date().toISOString().slice(0, 10);
                const backupPath = getWritingStyleBackupPath(projectName, dateStr);
                // 如果当天已有备份，覆盖它
                const bakFile = this.app.vault.getAbstractFileByPath(backupPath);
                if (bakFile) {
                    await this.app.vault.delete(bakFile);
                }
                // 复制旧文件为备份
                const oldContent = await this.app.vault.read(existingFile as TFile);
                await this.app.vault.create(backupPath, oldContent);

                // 优先写入标准路径；如果旧文件在旧路径，不修改它而是在标准路径创建新文件
                if (existingFile.path === wsPath) {
                    await this.app.vault.modify(existingFile as TFile, styleContent);
                } else {
                    await this.app.vault.create(wsPath, styleContent);
                    new Notice(`✅ 已迁移文笔风格到标准路径`, 3000);
                }
            } else {
                await this.app.vault.create(wsPath, styleContent);
            }

            new Notice(`✅ 文笔风格已写入「${projectName}」`, 5000);

            // 打开文笔风格文件
            const wsFile = this.app.vault.getAbstractFileByPath(wsPath);
            if (wsFile) {
                await this.plugin.safeOpenFile(wsFile as TFile);
            }
        } catch (e) {
            new Notice(`❌ 写入项目失败: ${(e as Error).message}`, 5000);
        }
    }

    /** 存入文笔风格库 */
    private async saveToStyleLib(novelName: string, styleContent: string): Promise<void> {
        const safeName = novelName.replace(/[<>:"/\\|?*\s]/g, '_').slice(0, 60);
        const fileName = `${safeName}.md`;
        const styleDir = '文笔风格库';
        const filePath = `${styleDir}/${fileName}`;

        try {
            if (!this.app.vault.getAbstractFileByPath(styleDir)) {
                await this.app.vault.createFolder(styleDir);
            }

            const existingFile = this.app.vault.getAbstractFileByPath(filePath);
            if (existingFile instanceof TFile) {
                await this.app.vault.modify(existingFile, styleContent);
            } else {
                await this.app.vault.create(filePath, styleContent);
            }
        } catch (e) {
            new Notice(`❌ 保存失败: ${(e as Error).message}`, 5000);
            return;
        }

        const savedFile = this.app.vault.getAbstractFileByPath(filePath);
        if (savedFile instanceof TFile) {
            await this.plugin.safeOpenFile(savedFile);
        }

        new Notice(`✅ 文笔风格已存入文笔风格库 → ${fileName}`, 6000);
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
