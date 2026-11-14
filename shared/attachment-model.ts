/**
 * attachment-model.ts — 附件模型（纯函数）
 *
 * 附件存 `<项目>/04-项目总控/附件/`，消息里以 `[附件](路径)` 引用。
 */

/** 支持的附件扩展名 */
export const ATTACHMENT_EXTENSIONS: readonly string[] = [
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.txt', '.md', '.csv', '.json', '.docx', '.xlsx',
];

/** 附件分类 */
export type AttachmentKind = 'image' | 'document' | 'text';

/**
 * 扩展名是否受支持。
 *
 * @param name - 文件名
 * @returns 支持返回 true
 */
export function isSupportedAttachment(name: string): boolean {
    const lower = String(name || '').trim().toLowerCase();
    return ATTACHMENT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * 附件分类。
 *
 * @param name - 文件名
 * @returns 分类
 */
export function attachmentKind(name: string): AttachmentKind {
    const lower = String(name || '').toLowerCase();
    if (/\.(png|jpe?g|webp|gif)$/.test(lower)) return 'image';
    if (/\.(txt|md|csv|json)$/.test(lower)) return 'text';
    return 'document';
}

/**
 * 清洗附件文件名（去非法字符、限长、保留扩展名）。
 *
 * @param name - 原始文件名
 * @param now - 时间戳（用于避免重名）
 * @returns 安全文件名
 */
export function safeAttachmentName(name: string, now: number = Date.now()): string {
    const raw = String(name || '').trim().replace(/\\/g, '/');
    const base = raw.split('/').pop() || 'file';
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
    const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'file';
    return `${now.toString(36)}-${stem}${ext}`;
}

/**
 * 附件引用 Markdown。
 *
 * @param path - 附件 vault 路径
 * @returns 引用文本
 */
export function attachmentMarkdown(path: string): string {
    return `[附件](${path})`;
}

/**
 * 从文本中解析附件引用路径。
 *
 * @param text - 消息文本
 * @returns 路径数组
 */
export function parseAttachmentRefs(text: string): string[] {
    const refs: string[] = [];
    const regex = /\[附件\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(String(text ?? ''))) !== null) {
        const path = match[1].trim();
        if (path && !refs.includes(path)) refs.push(path);
    }
    return refs;
}
