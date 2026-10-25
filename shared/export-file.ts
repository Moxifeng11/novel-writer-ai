/**
 * export-file.ts — 统一的「导出文件」入口（v6.3 跨端加固）
 *
 * 桌面端：沿用 blob + `<a download>` 下载（与改造前逐字一致的行为）。
 * 移动端：`<a download>` 无下载器、blob URL 不可用，改为把内容写入 vault 根下的
 *        「导出文件」目录，并在提示中给出实际路径。
 *
 * 统一入口的目的：此前 7 处导出各自复制同一段 blob 代码，移动端全部静默失效。
 */
import type { App } from 'obsidian';
import { Notice, TFile } from 'obsidian';
import { createLogger } from './logger';

const log = createLogger('ExportFile');

/** 移动端回退写入的目录（放在 vault 根下，便于用户找到） */
export const EXPORT_FALLBACK_DIR = '导出文件';

/** 与 kbBookDir 一致的非法字符净化，避免文件名破坏路径 */
function sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_');
}

export interface ExportFileOptions {
    /** MIME 类型，默认 text/plain;charset=utf-8 */
    mime?: string;
    /** 桌面端成功后的提示文案；移动端会用实际落点路径代替 */
    successMessage?: string;
    /**
     * 强制写入 vault 的「导出文件」目录。
     * 用于对“一定能拿到文件”要求高于下载体验的场景（如诊断包）。
     */
    preferVault?: boolean;
}

export interface ExportFileResult {
    ok: boolean;
    mode: 'download' | 'vault';
    path?: string;
    error?: string;
}

/**
 * 导出文本内容到用户可获取的位置（桌面=下载，移动=写入 vault）。
 */
export async function exportTextFile(
    app: App,
    filename: string,
    content: string,
    options?: ExportFileOptions
): Promise<ExportFileResult> {
    const safeName = sanitizeFileName(filename);

    // Obsidian 的 `App.isMobile` 在运行时可用，但仓库内置的 obsidian 类型定义未声明该属性，
    // 故此处做窄化断言（同时兼容测试环境下 App mock 无该字段的情形）。
    const isMobile = (app as unknown as { isMobile?: boolean })?.isMobile === true;

    if (isMobile || options?.preferVault === true) {
        try {
            if (!(await app.vault.adapter.exists(EXPORT_FALLBACK_DIR))) {
                await app.vault.adapter.mkdir(EXPORT_FALLBACK_DIR);
            }
            const path = `${EXPORT_FALLBACK_DIR}/${safeName}`;
            const existing = app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) {
                await app.vault.modify(existing, content);
            } else {
                await app.vault.create(path, content);
            }
            new Notice(`✅ 已导出到「${path}」`, 5000);
            return { ok: true, mode: 'vault', path };
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            log.warn('[小说工坊] 移动端导出失败:', message);
            new Notice(`❌ 导出失败：${message}`, 5000);
            return { ok: false, mode: 'vault', error: message };
        }
    }

    const blob = new Blob([content], { type: options?.mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Electron/Chromium 的下载是异步启动的：立即 revoke 会取消尚未开始的下载。
    // 延迟释放，确保下载已接管 blob。
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (options?.successMessage) {
        new Notice(options.successMessage, 5000);
    }
    return { ok: true, mode: 'download' };
}
