/**
 * preview-kind.ts — 文件预览内容类型分类（纯函数，可测）
 *
 * 工作台文件预览按此分类选渲染方式：
 *   image / audio / video / markdown / text / binary
 */

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);
const TEXT_EXTENSIONS = new Set([
    'txt', 'json', 'csv', 'yml', 'yaml', 'js', 'ts', 'html', 'css',
    'xml', 'ini', 'toml', 'log', 'py', 'sh',
]);

/**
 * PreviewKind 类型定义。
 */
export type PreviewKind = 'image' | 'audio' | 'video' | 'markdown' | 'text' | 'binary';

/**
 * 按扩展名判定预览渲染方式
 *
 * @param extension - 扩展名
  * @returns PreviewKind 实例
 */
export function classifyPreviewKind(extension: string): PreviewKind {
    const ext = String(extension || '').toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
    if (TEXT_EXTENSIONS.has(ext)) return 'text';
    return 'binary';
}
