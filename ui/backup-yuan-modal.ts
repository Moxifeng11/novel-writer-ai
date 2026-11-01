import { App, Modal, Notice } from 'obsidian';
import NovelWriterPlugin from '../main';
import { createLogger } from '../shared/logger';


const log = createLogger('BackupYuanModal');
export class BackupYuanModal extends Modal {
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
        contentEl.createEl('h2', { text: '📦 备份元文件' });

        const backupButton = contentEl.createEl('button', { text: '开始备份', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        backupButton.onclick = async () => {
            await this.backup();
        };
    }

    private async backup(): Promise<void> {
        const adapter = this.app.vault.adapter;
        const now = new Date();
        const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
        const backupName = `元文件_备份_${ts}`;

        // M3（技术审计）：持久进度通知必须持有引用并在所有出口 hide，否则永不消失
        const progressNotice = new Notice(`⏳ 正在备份元文件 → ${backupName}...`, 0);
        try {
            const scanDir = async (dir: string): Promise<{ files: string[], dirs: string[] }> => {
                const result = { files: [] as string[], dirs: [] as string[] };
                try {
                    const list = await adapter.list(dir);
                    for (const d of list.folders) {
                        result.dirs.push(d);
                        const sub = await scanDir(d);
                        result.files.push(...sub.files);
                        result.dirs.push(...sub.dirs);
                    }
                    for (const f of list.files) {
                        result.files.push(f);
                    }
                } catch (e) {
                    log.warn('扫描目录失败:', dir, e);
                }
                return result;
            };

            const src = await scanDir('元文件');
            if (src.files.length === 0) {
                new Notice('❌ 元文件为空，无法备份', 5000);
                return;
            }

            const allDirs = new Set<string>();
            for (const f of src.files) {
                const np = f.replace('元文件', backupName);
                allDirs.add(np.substring(0, np.lastIndexOf('/')));
            }
            for (const d of src.dirs) {
                allDirs.add(d.replace('元文件', backupName));
            }

            const sorted = [...allDirs].sort((a, b) => a.split('/').length - b.split('/').length);
            for (const d of sorted) {
                try {
                    if (!(await adapter.exists(d))) {
                        await adapter.mkdir(d);
                    }
                } catch (e) { log.warn('[小说工坊] 操作失败:', e); }
            }

            let count = 0;
            let failed = 0;
            for (const f of src.files) {
                try {
                    const content = await adapter.read(f);
                    await adapter.write(f.replace('元文件', backupName), content);
                    count++;
                } catch (e) {
                    failed++;
                    log.warn('备份失败:', f, e);
                }
            }

            await new Promise(r => setTimeout(r, 300));

            if (failed > 0) {
                new Notice(`⚠️ 备份不完整：${count} 个成功，${failed} 个失败（详见控制台）`, 10000);
            } else {
                new Notice(`✅ 备份完成：${backupName}（${count} 个文件）`, 6000);
            }
            this.close();
        } finally {
            progressNotice.hide();
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}