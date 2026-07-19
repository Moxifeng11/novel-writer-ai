/**
 * 封面选择子系统控制器（v3.4.6 P0 封面三层联动）
 *
 * 从 FullWriterView 外迁而来：openCoverPicker / saveCoverAndRefresh /
 * refreshCoverDisplay 三个方法，以及 _coverPickerActive 防重入状态。
 * 控制器自管内部状态，不回调 view 的 private 成员（避免 TS2341）。
 */
import { App, Notice } from 'obsidian';
import { getProjectCover } from '../project-utils';
import { createLogger } from '../../shared/logger';


const log = createLogger('CoverPickerController');
export class CoverPickerController {
    private app: App;

    // 封面选择器防重入（v3.4.7 P0-4）
    private _coverPickerActive = false;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * 打开文件选择器让用户选择封面图片（v3.4.6 P0 封面三层联动）
     */
    openCoverPicker(project: string, coverArea: HTMLElement) {
        // 防重入：避免并发触发多个文件选择器（v3.4.7 P0-4）
        if (this._coverPickerActive) {
            log.info('[小说工坊] 封面选择器已在运行，忽略重复调用');
            return;
        }
        this._coverPickerActive = true;
        const clearActive = () => { this._coverPickerActive = false; };

        const input = coverArea.createEl('input', {
            type: 'file',
            attr: { accept: 'image/png,image/jpeg,image/webp' }
        });
        input.style.display = 'none';

        // 60秒安全清理定时器（防止用户取消对话框后 input 残留）
        const cleanupTimer = setTimeout(() => {
            clearActive();
            try { if (document.body.contains(input)) input.remove(); } catch (e) {
                // P1-2: input 节点清理失败仅记录，不影响后续流程
                log.warn('[cover-picker] 60s 超时清理 input 失败:', e instanceof Error ? e.message : String(e));
            }
        }, 60000);

        input.onchange = async () => {
            clearTimeout(cleanupTimer);
            const file = input.files?.[0];
            try { input.remove(); } catch (e) {
                // P1-2: input 节点已可能在 cleanup 中移除，忽略但记录
                log.warn('[cover-picker] onchange 清理 input 失败:', e instanceof Error ? e.message : String(e));
            }
            clearActive();
            if (!file) return;
            await this.saveCoverAndRefresh(project, file, coverArea);
        };

        input.click();
    }

    /**
     * 保存封面文件到 Obsidian vault 并刷新显示（v3.4.6 P0）
     * 三层联动：数据层(folder create+file write) → 后端(adapter) → 前端(refresh display)
     */
    private async saveCoverAndRefresh(project: string, file: File, coverArea: HTMLElement) {
        const notice = new Notice('正在保存封面...', 0);
        try {
            const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
            if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
                notice.hide();
                new Notice('❌ 仅支持 PNG / JPG / WebP 格式，请重新选择', 5000);
                return;
            }

            const coverDir = `${project}/封面`;  // 无尾部斜杠（getAbstractFileByPath 对尾部斜杠敏感）
            const coverPath = `${coverDir}/cover.${ext}`;

            // 数据层：确保封面文件夹存在（三层联动 — 数据层）
            //   adapter.exists 比 vault.getAbstractFileByPath 更可靠（不区分路径格式）
            const _coverDirExists = await this.app.vault.adapter.exists(coverDir);
            if (!_coverDirExists) {
                try {
                    await this.app.vault.createFolder(coverDir);
                    log.info('[小说工坊] 创建封面目录:', coverDir);
                } catch (e: any) {
                    // 多语言兼容：Obsidian 可能返回 "Folder already exists" / "文件夹已存在" 等
                    log.warn('[小说工坊] 创建封面目录失败（将尝试继续）:', coverDir, e?.message || e);
                    // 不 rethrow — 后续 createBinary 若真的缺目录会自然失败
                }
            }

            // 数据层：删除已有封面（避免残留 png/jpg 不同后缀）
            const allFiles = this.app.vault.getFiles();
            const existingCovers = allFiles.filter(f =>
                f.path.startsWith(coverDir + '/') &&
                /^cover\.(png|jpe?g|webp)$/i.test(f.name)
            );
            for (const ef of existingCovers) {
                await this.app.vault.delete(ef);
            }

            // 后端层：读取文件内容并写入 vault
            const buf = await file.arrayBuffer();
            await this.app.vault.createBinary(coverPath, buf);

            notice.hide();
            new Notice(`✅ 封面已保存（${(buf.byteLength / 1024).toFixed(0)} KB）`, 3000);
            log.info('[小说工坊] 封面保存成功:', coverPath, `${(buf.byteLength / 1024).toFixed(0)} KB`);

            // 前端层：刷新封面显示
            this.refreshCoverDisplay(project, coverArea);
        } catch (e) {
            notice.hide();
            log.error('[小说工坊] 保存封面失败:', e);
            new Notice(`❌ 保存封面失败：${e instanceof Error ? e.message : '未知错误'}`, 5000);
        }
    }

    /**
     * 刷新封面区域显示（v3.4.6 P0）
     */
    private refreshCoverDisplay(project: string, coverArea: HTMLElement) {
        coverArea.empty();
        const coverUrl = getProjectCover(this.app, project);
        if (coverUrl) {
            coverArea.createEl('img', { attr: { src: coverUrl } });
            coverArea.setAttr('title', '点击更换封面');
        } else {
            const placeholder = coverArea.createDiv({ cls: 'novel-writer-fw-cover-placeholder' });
            placeholder.createSpan({ text: '📷', cls: 'icon' });
            placeholder.createSpan({ text: '添加封面', cls: 'text' });
            coverArea.setAttr('title', '点击添加封面');
        }
    }
}
