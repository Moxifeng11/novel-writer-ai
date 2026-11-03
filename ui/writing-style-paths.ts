import { App, TFile, TFolder } from 'obsidian';
import { getLegacyWritingStylePath, getWritingStylePath, SUBDIR_WORLD_ARCH } from '@/shared/paths';

/**
 * getWritingStyleCandidatePaths 函数。
 * @param project - 项目（路径或对象）
 * @returns 结果数组
 */
export function getWritingStyleCandidatePaths(project: string): string[] {
    // v4.1: 项目内文笔风格可能以「文笔风格.md」（正式名）或「文笔风格模板.md」（由 元文件 复制而来、未改名）落盘。
    // 候选顺序：正式名优先 → 01-世界架构/文笔风格模板.md → 旧根目录 文笔风格.md，确保 checker / 渲染都能识别现有文件。
    return [
        getWritingStylePath(project),
        `${project}/${SUBDIR_WORLD_ARCH}/文笔风格模板.md`,
        getLegacyWritingStylePath(project),
    ];
}

/**
 * isPlaceholderWritingStyle 函数。
 * @param content - 内容
 * @returns 是否成功
 */
export function isPlaceholderWritingStyle(content: string): boolean {
    return content.includes('> ⚠️ 填充完此文件后删除本行') ||
        content.includes('<!-- 填入一段') ||
        (content.includes('template_version: 2') && !content.includes('source: manual') && !content.includes('source: ai-generated'));
}

/**
 * findWritingStyleFile 函数。
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param opts - 选项
  * @returns TFile 或 null
 */
export async function findWritingStyleFile(app: App, project: string, opts: { allowPlaceholder?: boolean } = {}): Promise<TFile | null> {
    let placeholder: TFile | null = null;

    for (const path of getWritingStyleCandidatePaths(project)) {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) continue;

        if (opts.allowPlaceholder) return file;

        try {
            const content = await app.vault.read(file);
            if (!isPlaceholderWritingStyle(content)) return file;
            placeholder = placeholder || file;
        } catch {
            return file;
        }
    }

    return opts.allowPlaceholder ? placeholder : null;
}

/**
 * getWritingStyleWritePath 函数。
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function getWritingStyleWritePath(project: string): string {
    return getWritingStylePath(project);
}

/**
 * getWritingStyleBackupPath 函数。
 * @param project - 项目（路径或对象）
 * @param dateStr - 日期字符串
 * @returns 文本结果
 */
export function getWritingStyleBackupPath(project: string, dateStr: string): string {
    return `${project}/${SUBDIR_WORLD_ARCH}/文笔风格_备份_${dateStr}.md`;
}

/**
 * ensureWritingStyleFolder 函数。
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 */
export async function ensureWritingStyleFolder(app: App, project: string): Promise<void> {
    const folderPath = `${project}/${SUBDIR_WORLD_ARCH}`;
    const existing = app.vault.getAbstractFileByPath(folderPath);
    if (existing instanceof TFolder) return;
    if (existing) throw new Error(`文笔风格目录被文件占用：${folderPath}`);
    await app.vault.createFolder(folderPath);
}
