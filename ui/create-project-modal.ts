import { App, Modal, Notice, DataAdapter, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ContextManager } from '../engine/context-manager';
import { SUBDIR_SETTING_LIB_FILE, SUBDIR_WRITING_STYLE_FILE, SUBDIR_WORLD_ARCH, PJ_FANFIC_DIR, PJ_WORLD_ARCH_DIR, PJ_TEMPLATE_DIR, PJ_OUTLINE_DIR, pjFanficDir, pjProjectMeta } from '../shared/paths';

export class CreateProjectModal extends Modal {
    private plugin: NovelWriterPlugin;
    private adapter: DataAdapter;
    private selectedFanficSettingPath = '';
    private fanficSettingsOutsideClickHandler?: (ev: MouseEvent) => void;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.adapter = app.vault.adapter;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // ═══ v3.4.8: Modal 居中对齐修复 ═══
        // 向上两级：确保 .modal-container 的 flex 居中生效
        const wrapper = contentEl.parentElement as HTMLElement;   // .modal
        const container = wrapper?.parentElement as HTMLElement;  // .modal-container
        if (container) {
            container.style.setProperty('display', 'flex', 'important');
            container.style.setProperty('align-items', 'center', 'important');
            container.style.setProperty('justify-content', 'center', 'important');
        }
        // .modal: 限制最大宽度 + 水平居中
        if (wrapper) {
            wrapper.style.setProperty('max-width', 'min(580px, 90vw)', 'important');
            wrapper.style.setProperty('margin', '0 auto', 'important');
        }
        // .modal-content: 防止内容溢出
        contentEl.style.maxWidth = 'min(580px, 90vw)';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.style.setProperty('padding', '20px 24px', 'important');

        contentEl.empty();
        contentEl.createEl('h2', { text: '📁 新建项目' });

        const projectNameInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: '请输入项目名称（中文小说名）',
            cls: 'nw-input novel-writer-input'
        });

        const genreTags = ['玄幻', '仙侠', '都市', '科幻', '悬疑', '历史', '言情', '奇幻', '武侠', '末世'];
        const tagContainer = contentEl.createEl('div', { cls: 'novel-writer-tag-container' });
        tagContainer.createEl('p', { text: '快捷标签（点击选择）：' });

        const genreInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: '输入题材（或点击上方标签）',
            cls: 'nw-input novel-writer-input'
        });

        genreTags.forEach(genre => {
            const tag = tagContainer.createEl('button', { text: genre, cls: 'novel-writer-tag-button' });
            tag.onclick = () => {
                genreInput.value = genre;
                genreInput.focus();
            };
        });

        // Project type selector
        const typeContainer = contentEl.createDiv({ cls: 'novel-writer-create-type-container' });
        typeContainer.createEl('label', { text: '项目类型', cls: 'novel-writer-create-label' });
        const typeRow = typeContainer.createDiv({ cls: 'novel-writer-genre-grid' });

        let projectType: 'original' | 'fanfic' = 'original';

        const originalBtn = typeRow.createEl('button', { text: '🎨 原创', cls: `novel-writer-genre-btn${projectType === 'original' ? ' selected' : ''}` });
        const fanficBtn = typeRow.createEl('button', { text: '📖 同人', cls: 'novel-writer-genre-btn' });

        // Fanfic fields (hidden for original)
        const fanficFields = contentEl.createDiv({ cls: 'novel-writer-create-fanfic-fields' });
        fanficFields.style.display = 'none';
        fanficFields.style.marginTop = '12px';

        // Source work name
        const sourceContainer = fanficFields.createDiv();
        sourceContainer.createEl('label', { text: '原作名称', cls: 'novel-writer-create-label' });
        const sourceInput = sourceContainer.createEl('input', { type: 'text', cls: 'nw-input novel-writer-create-input' });

        // Source worldview summary
        const sourceWorldContainer = fanficFields.createDiv();
        sourceWorldContainer.style.marginTop = '8px';
        sourceWorldContainer.createEl('label', { text: '原作世界观简述（可选，辅助AI理解）', cls: 'novel-writer-create-label' });
        const sourceWorldInput = sourceWorldContainer.createEl('textarea', { cls: 'nw-textarea novel-writer-create-textarea' });
        sourceWorldInput.style.height = '80px';

        // Fanfic settings library selector
        const settingsLibContainer = fanficFields.createDiv();
        settingsLibContainer.style.marginTop = '12px';
        settingsLibContainer.createEl('label', { text: '从设定库导入（可选）', cls: 'novel-writer-create-label' });

        const settingsSelector = settingsLibContainer.createDiv({ cls: 'novel-writer-fanfic-selector' });
        const settingsTrigger = settingsSelector.createEl('button', {
            text: '选择设定库',
            cls: 'nw-btn nw-btn-secondary novel-writer-fanfic-selector-trigger'
        });
        settingsTrigger.type = 'button';
        const settingsValue = settingsSelector.createDiv({ cls: 'novel-writer-fanfic-selector-value' });
        settingsValue.setText('当前：手动输入');
        const settingsList = settingsSelector.createDiv({ cls: 'novel-writer-fanfic-selector-list' });
        settingsList.style.display = 'none';

        const setSettingsListOpen = (open: boolean) => {
            settingsList.style.display = open ? 'block' : 'none';
        };

        const settingEntries: Array<{ path: string; name: string }> = [];

        const applySetting = async (selectedPath: string, selectedName: string) => {
            this.selectedFanficSettingPath = selectedPath;
            settingsTrigger.setText(selectedName || '手动输入');
            if (!selectedPath) {
                settingsValue.setText('当前：手动输入');
                sourceWorldInput.disabled = false;
                sourceWorldInput.value = '';
                return;
            }

            settingsValue.setText(`当前：${selectedName}`);
            try {
                const file = this.app.vault.getAbstractFileByPath(selectedPath);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    const fmMatch = content.match(/^---\n([\s\S]*?)---/);
                    if (fmMatch) {
                        const fmText = fmMatch[1];
                        const nameMatch = fmText.match(/作品名称:\s*(.+)/);
                        if (nameMatch) sourceInput.value = nameMatch[1].trim();
                        sourceWorldInput.value = `已从设定库导入：${selectedName}\n请查看 ${file.path} 获取完整设定`;
                        sourceWorldInput.disabled = true;
                    }
                }
            } catch (e) {
                console.warn('Failed to load fanfic settings:', e);
            }
        };

        const addSettingOption = (text: string, path: string, name: string) => {
            const item = settingsList.createEl('button', {
                text,
                cls: 'novel-writer-fanfic-selector-item'
            });
            item.type = 'button';
            item.onclick = async () => {
                await applySetting(path, name);
                setSettingsListOpen(false);
            };
        };

        const loadSettingsLib = async () => {
            try {
                const fanficDir = `${PJ_FANFIC_DIR}`;
                const files = this.app.vault.getFiles().filter(f =>
                    f.path.startsWith(fanficDir) &&
                    f.name.endsWith('.md') &&
                    !f.name.includes('模板')
                );
                settingEntries.length = 0;
                for (const file of files) {
                    settingEntries.push({ path: file.path, name: file.name.replace('.md', '') });
                }
                settingsList.empty();
                settingsList.createEl('div', { text: '选择设定库条目', cls: 'novel-writer-fanfic-selector-hint' });
                addSettingOption('手动输入', '', '手动输入');
                for (const entry of settingEntries) {
                    addSettingOption(entry.name, entry.path, entry.name);
                }
            } catch (e) {
                console.warn('Failed to load fanfic settings lib:', e);
            }
        };

        settingsTrigger.onclick = (ev) => {
            ev.preventDefault();
            setSettingsListOpen(settingsList.style.display === 'none');
        };

        this.fanficSettingsOutsideClickHandler = (ev: MouseEvent) => {
            const target = ev.target as Node;
            if (!settingsSelector.contains(target)) {
                setSettingsListOpen(false);
            }
        };
        document.addEventListener('click', this.fanficSettingsOutsideClickHandler);

        loadSettingsLib();

        // Toggle handlers
        originalBtn.addEventListener('click', () => {
            projectType = 'original';
            originalBtn.classList.add('selected');
            fanficBtn.classList.remove('selected');
            // Hide fanfic fields
            fanficFields.style.display = 'none';
        });

        fanficBtn.addEventListener('click', () => {
            projectType = 'fanfic';
            fanficBtn.classList.add('selected');
            originalBtn.classList.remove('selected');
            // Show fanfic fields
            fanficFields.style.display = 'block';
        });

        const descriptionInput = contentEl.createEl('textarea', {
            placeholder: '项目描述（可选）',
            cls: 'nw-input novel-writer-input nw-textarea novel-writer-textarea'
        });

        const createButton = contentEl.createEl('button', { text: '创建项目', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        createButton.onclick = async () => {
            const projectName = projectNameInput.value.trim();
            const genre = genreInput.value.trim();

            if (!projectName) {
                new Notice('❌ 请输入项目名称', 3000);
                return;
            }

            if (!genre) {
                new Notice('❌ 请输入或选择题材', 3000);
                return;
            }

            if (!/^[\u4e00-\u9fa5a-zA-Z0-9_\-]+$/.test(projectName)) {
                new Notice('❌ 项目名只能包含中文、字母、数字、下划线、连字符（不含空格、标点）', 6000);
                return;
            }

            try {
                await this.createProject(projectName, genre, descriptionInput.value.trim(), projectType, sourceInput.value.trim(), sourceWorldInput.value.trim());
            } catch (e) {
                const errMsg = e instanceof Error ? e.message : String(e);
                console.error('[小说工坊] 创建项目失败:', e);
                new Notice(`❌ 创建项目失败: ${errMsg}`, 8000);
            }
        };
    }

    private async createProject(projectName: string, genre: string, description: string, projectType: 'original' | 'fanfic', sourceWork: string, sourceWorldview: string): Promise<void> {
        const exists = await this.adapter.exists(projectName);
        if (exists) {
            const overwrite = confirm(`「${projectName}」已存在，覆盖？`);
            if (!overwrite) return;

            const removeDir = async (dirPath: string) => {
                const list = await this.adapter.list(dirPath);
                for (const f of list.files) await this.adapter.remove(f);
                for (const d of list.folders) await removeDir(d);
                await this.adapter.rmdir(dirPath, true);
            };
            try { await removeDir(projectName); } catch (e) { console.warn('[小说工坊] 操作失败:', e); }
            await new Promise(r => setTimeout(r, 300));
        }

        const notice = new Notice(`正在创建项目「${projectName}」...`, 0);

        const shouldCopyTemplatePath = (path: string): boolean => {
            if (path.startsWith(`${PJ_OUTLINE_DIR}/步骤结果`)) return false;
            if (path.startsWith(`${PJ_OUTLINE_DIR}/正文`)) return false;
            if (projectType === 'original' && path.startsWith(PJ_FANFIC_DIR)) return false;
            if (projectType === 'fanfic' && new RegExp(`^${PJ_FANFIC_DIR.replace(/[/\\]/g, '\\/')}/(斗罗大陆设定|哈利波特设定)\\.md$`).test(path)) return false;
            return true;
        };

        const scanDir = async (dirPath: string): Promise<{ files: string[], dirs: string[] }> => {
            const result: { files: string[]; dirs: string[] } = { files: [], dirs: [] };
            const list = await this.adapter.list(dirPath);
            for (const dir of list.folders) {
                // 跳过归档/隐藏目录：避免把 _v3_archive 等历史模板复制进新项目（模板隔离）
                const dirName = dir.substring(dir.lastIndexOf('/') + 1);
                if (dirName.startsWith('_') || dirName.startsWith('.')) continue;
                if (!shouldCopyTemplatePath(dir)) continue;
                result.dirs.push(dir);
                const sub = await scanDir(dir);
                result.files.push(...sub.files);
                result.dirs.push(...sub.dirs);
            }
            for (const file of list.files) {
                if (!shouldCopyTemplatePath(file)) continue;
                result.files.push(file);
            }
            return result;
        };

        const source = await scanDir('元文件');
        if (source.files.length === 0) {
            notice.hide();
            new Notice('❌ 未找到「元文件」下的模板文件，请确认插件安装完整或重装插件', 8000);
            return;
        }

        const dirsToCreate = new Set<string>();
        for (const f of source.files) {
            const newPath = f.replace('元文件', projectName);
            const parent = newPath.substring(0, newPath.lastIndexOf('/'));
            dirsToCreate.add(parent);
        }
        for (const d of source.dirs) {
            const newDir = d.replace('元文件', projectName);
            dirsToCreate.add(newDir);
        }

        const sortedDirs = [...dirsToCreate].sort((a, b) => a.split('/').length - b.split('/').length);
        for (const dir of sortedDirs) {
            try {
                if (!(await this.adapter.exists(dir))) {
                    await this.adapter.mkdir(dir);
                }
            } catch (e) {
                console.warn('创建目录失败:', dir, e);
            }
        }

        let count = 0;
        for (const srcPath of source.files) {
            const destPath = srcPath.replace('元文件', projectName);
            try {
                const content = await this.adapter.read(srcPath);
                await this.adapter.write(destPath, content);
                count++;
            } catch (fileErr) {
                console.warn(`复制失败: ${srcPath}`, fileErr);
            }
        }

        // v4.1: 设定库 / 文笔风格落盘于 01-世界架构/。
        // 元文件 的真实模板位置：文笔风格模板 在 01-世界架构/，设定库无独立模板（由 AI 在向导中生成）。
        // 整树复制已可能把「文笔风格模板.md」带入项目，这里用多候选源补齐正式命名文件，且任一形态已存在即跳过，避免重复。
        const rootCopies: Array<{ srcs: string[]; dst: string; existing: string[] }> = [
            {
                srcs: [
                    `${PJ_TEMPLATE_DIR}/设定库模板.md`,
                    `${PJ_WORLD_ARCH_DIR}/设定库模板.md`,
                    `${PJ_WORLD_ARCH_DIR}/设定库.md`,
                ],
                dst: `${projectName}/${SUBDIR_SETTING_LIB_FILE}`,
                existing: [
                    `${projectName}/${SUBDIR_SETTING_LIB_FILE}`,
                    `${projectName}/${SUBDIR_WORLD_ARCH}/设定库模板.md`,
                ],
            },
            {
                srcs: [
                    `${PJ_WORLD_ARCH_DIR}/文笔风格模板.md`,
                    `${PJ_TEMPLATE_DIR}/文笔风格模板.md`,
                ],
                dst: `${projectName}/${SUBDIR_WRITING_STYLE_FILE}`,
                existing: [
                    `${projectName}/${SUBDIR_WRITING_STYLE_FILE}`,
                    `${projectName}/${SUBDIR_WORLD_ARCH}/文笔风格模板.md`,
                ],
            },
        ];
        for (const { srcs, dst, existing } of rootCopies) { 
            try {
                const dstNameExists = await this.adapter.exists(dst);

                // 正式名已存在 → 跳过
                if (dstNameExists) continue;

                // 检查模板名是否已存在（排除 dst 自身）
                let templateFileExists = false;
                let templateFilePath = '';
                for (const p of existing) {
                    if (p === dst) continue;
                    if (await this.adapter.exists(p)) { 
                        templateFileExists = true;
                        templateFilePath = p;
                        break;
                    }
                }

                // 模板名存在但正式名不存在 → 从模板复制到正式名（修复 文笔风格模板.md → 文笔风格.md 的命名）
                if (templateFileExists && templateFilePath) {
                    const content = await this.adapter.read(templateFilePath);
                    await this.adapter.write(dst, content);
                    count++;
                    continue;
                }
                // 在候选源里取第一个真实存在的模板
                let srcContent: string | null = null;
                for (const s of srcs) {
                    if (await this.adapter.exists(s)) { srcContent = await this.adapter.read(s); break; }
                }
                if (srcContent === null) {
                    console.warn('[小说工坊] 跳过根级文件复制：未找到任何模板源', { dst, srcs });
                    continue;
                }
                await this.adapter.write(dst, srcContent);
                count++;
            } catch (e) { console.warn('复制根级文件失败:', dst, e); }
        }

        try {
            const projectFile = pjProjectMeta(projectName);
            let projectContent = `# ${projectName}

## 题材
${genre}

## 类型
${projectType}

${description ? `## 描述\n${description}\n\n` : ''}`;

            // Add fanfic-specific fields
            if (projectType === 'fanfic') {
                projectContent += `## 同人设定路径\n${pjFanficDir(projectName)}/${sourceWork}设定.md\n\n`;
                if (sourceWork) {
                    projectContent += `## 原作名称\n${sourceWork}\n\n`;
                }
                if (sourceWorldview) {
                    projectContent += `## 原作世界观简述\n${sourceWorldview}\n\n`;
                }
            }

            await this.adapter.write(projectFile, projectContent);
        } catch (e) { console.warn('[小说工坊] 操作失败:', e); }

        // Copy fanfic settings file if imported from library
        if (projectType === 'fanfic' && this.selectedFanficSettingPath) {
            const srcPath = this.selectedFanficSettingPath;
            const srcName = srcPath.split('/').pop() || '';
            const dstPath = `${pjFanficDir(projectName)}/${srcName}`;
            try {
                const content = await this.adapter.read(srcPath);
                // Ensure directory exists
                const dstDir = dstPath.substring(0, dstPath.lastIndexOf('/'));
                if (!(await this.adapter.exists(dstDir))) {
                    await this.adapter.mkdir(dstDir);
                }
                await this.adapter.write(dstPath, content);
                count++;
            } catch (e) {
                console.warn('Failed to copy fanfic settings:', e);
            }
        }

        notice.hide();
        new Notice(`✅ 项目「${projectName}」创建完成（${count} 个文件）`, 5000);

        // Notify FullWriterView to refresh and optionally open wizard
        this.app.workspace.trigger('novel-writer:project-created', {
            projectName,
            projectType,
        });

        // [已移除] 自动打开项目首个文件——改为由向导引导
        // const mdFiles = this.app.vault.getFiles()
        //     .filter(f => f.path.startsWith(projectName + '/') && f.path.endsWith('.md'));
        // if (mdFiles.length > 0) {
        //     const leaf = this.app.workspace.getLeaf(false);
        //     await leaf.openFile(mdFiles[0]);
        // }

        this.close();
    }

    onClose(): void {
        if (this.fanficSettingsOutsideClickHandler) {
            document.removeEventListener('click', this.fanficSettingsOutsideClickHandler);
            this.fanficSettingsOutsideClickHandler = undefined;
        }
        this.selectedFanficSettingPath = '';
        const { contentEl } = this;
        contentEl.empty();
    }
}
