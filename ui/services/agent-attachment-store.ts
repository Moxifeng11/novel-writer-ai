/**
 * agent-attachment-store.ts — Agent 输入框图片附件的落盘与元数据
 *
 * 图片写到插件自己的 `.sessions/agent/attachments/<项目>/`，不进项目正文目录，
 * 也不会被文件树/搜索当成用户资料。当前只做「附件 UI + 路径引用」：
 * 模型收到的仍是文本路径，真正的多模态 content blocks 留给后续批次。
 */
import type { App } from 'obsidian';

/** 允许的图片 MIME → 扩展名 */
const IMAGE_EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

/** 单张图片上限（10MB） */
export const MAX_AGENT_IMAGE_BYTES = 10 * 1024 * 1024;

/** 附件元数据（会话日志只存路径，不存二进制） */
export interface AgentAttachment {
    path: string;
    name: string;
    mediaType: string;
    size: number;
}

/** 附件根目录（与 spill 同级，均为隐藏目录） */
export const ATTACHMENT_ROOT = '.sessions/agent/attachments';

/** 会话日志中的附件块前缀 */
export const ATTACHMENT_BLOCK_HEADER = '【图片附件】';

function slug(text: string): string {
    return String(text || '')
        .replace(/[\\/:*?"<>|#^[\]]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 60);
}

function extFor(file: File): string | null {
    const byMime = IMAGE_EXTENSIONS[String(file.type || '').toLowerCase()];
    if (byMime) return byMime;
    const name = String(file.name || '').toLowerCase();
    const match = /\.(png|jpe?g|webp|gif)$/.exec(name);
    return match ? (match[1] === 'jpeg' ? 'jpg' : match[1]) : null;
}

/**
 * 当前项目的附件目录。
 *
 * @param scope - 项目路径/ID；无项目时归入 default
 * @returns 附件目录路径
 */
export function attachmentFolderFor(scope: string): string {
    return `${ATTACHMENT_ROOT}/${slug(scope) || 'default'}`;
}

/**
 * 是否为可接收的图片。
 *
 * @param file - 浏览器 File
 * @returns 是否支持
 */
export function isSupportedImage(file: File): boolean {
    return extFor(file) !== null && file.size <= MAX_AGENT_IMAGE_BYTES;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
    const parts = folder.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!(await app.vault.adapter.exists(current))) {
            await app.vault.adapter.mkdir(current);
        }
    }
}

/**
 * 把图片保存到 `.sessions/agent/attachments`。
 *
 * @param app - Obsidian 应用
 * @param scope - 当前项目作用域
 * @param file - 图片文件
 * @returns 附件元数据
 */
export async function saveAgentAttachment(
    app: App,
    scope: string,
    file: File,
): Promise<AgentAttachment> {
    const ext = extFor(file);
    if (!ext) throw new Error('只支持 PNG/JPEG/WebP/GIF 图片');
    if (file.size > MAX_AGENT_IMAGE_BYTES) throw new Error('图片不能超过 10MB');

    const folder = attachmentFolderFor(scope);
    await ensureFolder(app, folder);
    const base = slug(String(file.name || 'image').replace(/\.[^.]+$/, '')) || 'image';
    const stamp = Date.now().toString(36);
    let path = `${folder}/${base}-${stamp}.${ext}`;
    let seq = 1;
    while (await app.vault.adapter.exists(path)) {
        path = `${folder}/${base}-${stamp}-${seq++}.${ext}`;
    }
    const buffer = await file.arrayBuffer();
    // write-entry-allow: Agent 图片附件，位于 .sessions 点目录。
    await app.vault.adapter.writeBinary(path, buffer);
    return {
        path,
        name: String(file.name || `${base}.${ext}`),
        mediaType: String(file.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`),
        size: file.size,
    };
}

/**
 * 删除附件文件（用户移除待发送图片时）。
 *
 * @param app - Obsidian 应用
 * @param path - 附件路径
 * @returns 无
 */
export async function deleteAgentAttachment(app: App, path: string): Promise<void> {
    if (!path.startsWith(`${ATTACHMENT_ROOT}/`)) return;
    try {
        if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
    } catch {
        // 删除失败不阻塞 UI；文件会随 .sessions 清理策略回收
    }
}

/**
 * 把附件列表拼成模型可读的文本块。
 *
 * @param attachments - 附件列表
 * @returns 文本块；无附件返回空串
 */
export function buildAttachmentBlock(attachments: readonly AgentAttachment[]): string {
    if (attachments.length === 0) return '';
    return [ATTACHMENT_BLOCK_HEADER, ...attachments.map(item => `- ${item.path}`)].join('\n');
}

/**
 * 从用户消息中拆出附件块，返回干净展示文本与附件路径。
 *
 * @param text - 完整消息
 * @returns 展示文本与附件信息
 */
export function splitAttachmentBlock(text: string): {
    displayText: string;
    attachments: Array<{ path: string; name: string }>;
} {
    const raw = String(text || '');
    const index = raw.indexOf(ATTACHMENT_BLOCK_HEADER);
    if (index < 0) return { displayText: raw, attachments: [] };
    const displayText = raw.slice(0, index).trimEnd();
    const block = raw.slice(index + ATTACHMENT_BLOCK_HEADER.length);
    const attachments = block
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.startsWith('- '))
        .map(line => line.slice(2).trim())
        .filter(Boolean)
        .map(path => ({ path, name: path.split('/').pop() || path }));
    return { displayText, attachments };
}
