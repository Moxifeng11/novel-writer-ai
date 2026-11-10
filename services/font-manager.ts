/**
 * font-manager.ts — 自定义字体载入模块
 *
 * 调研结论（2026-10-28）：
 * - 格式：TTF/OTF 为原始轮廓格式（兼容性最好、体积最大）；WOFF 为第一代压缩；
 *   WOFF2 用 Brotli 压缩体积最小，Chromium/Electron（即 Obsidian）完整支持，是本地载入首选。
 *   中文字体单文件常达 5–20MB，本地直接载入全量即可；若日后需要分发，建议用
 *   fonttools（pyftsubset）做子集化后再转 WOFF2。
 * - 载入方法：CSS @font-face 适合静态打包；运行时动态载入用 **FontFace API**——
 *   `vault.readBinary` 拿 ArrayBuffer → `new FontFace(family, buffer)` → `load()` →
 *   `FontFaceSet.add()`，随后任意元素 `font-family: "<family>"` 即可生效；
 *   卸载用 `FontFaceSet.delete(font)`。
 * - 存放位置：vault 内 `元文件/字体/`（用户可直接放入字体文件，随同步保留），
 *   插件启动与手动刷新时扫描注册，清单持久化在 settings.customFonts。
 * - 系统字体无法在浏览器环境枚举：提供（a）Obsidian 主题字体 CSS 变量、
 *   （b）常见中文系统字体预设栈、（c）自定义载入字体 三类来源。
 */
import { Notice, TFile } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { createLogger } from '@/shared/logger';
import { listDocumentScopes } from '@/shared/document-scopes';

const log = createLogger('FontManager');

/** 字体文件存放目录（vault 根下） */
export const FONT_DIR = '元文件/字体';

/**
 * 支持的字体扩展名。
 */
export const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'] as const;

/**
 * 字体文件格式。
 */
export type FontFileFormat = 'truetype' | 'opentype' | 'woff' | 'woff2';

/**
 * 自定义字体条目。
 */
export interface CustomFontEntry {
    /** FontFace family 名（取文件名去扩展名） */
    family: string;
    /** vault 内绝对路径 */
    path: string;
}

const registeredFonts = new Map<string, FontFace>();

/**
 * 是否受支持的字体文件
 *
 * @param name - 名称
 * @returns 是否成功
 */
export function isSupportedFontFile(name: string): boolean {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    return (FONT_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * 按扩展名返回字体格式。
 *
 * @param name - 名称
 * @returns 格式或 null
 */
export function fontFileFormat(name: string): FontFileFormat | null {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
        case 'ttf': return 'truetype';
        case 'otf': return 'opentype';
        case 'woff': return 'woff';
        case 'woff2': return 'woff2';
        default: return null;
    }
}

/**
 * FontFace family 名：文件名去扩展名，剔除 CSS 非法字符
 *
 * @param fileName - 文件名
 * @returns 文本结果
 */
export function sanitizeFamily(fileName: string): string {
    const base = fileName.replace(/\.[^.]+$/, '').trim();
    const cleaned = base.replace(/["'\\]/g, '').replace(/\s+/g, ' ');
    return cleaned || '自定义字体';
}

/**
 * 已注册（载入成功且记录在 settings）的自定义字体 family 列表
 *
 * @param plugin - 插件实例
 * @returns 结果数组
 */
export function getCustomFontFamilies(plugin: NovelWriterPlugin): string[] {
    return (plugin.settings.customFonts || []).map(entry => entry.family);
}

/**
 * 扫描字体目录中尚未登记的字体文件
 *
 * @param plugin - 插件实例
 * @returns 结果数组
 */
export async function scanFontFolder(plugin: NovelWriterPlugin): Promise<TFile[]> {
    const folder = plugin.app.vault.getAbstractFileByPath(FONT_DIR);
    if (!(folder && 'children' in folder)) return [];
    const known = new Set((plugin.settings.customFonts || []).map(entry => entry.path));
    const files: TFile[] = [];
    const children = (folder as unknown as { children?: TFile[] }).children ?? [];
    for (const child of children) {
        if (child instanceof TFile && isSupportedFontFile(child.name) && !known.has(child.path)) {
            files.push(child);
        }
    }
    return files;
}

/**
 * 注册单个字体文件（读二进制 → FontFace → document.fonts）
 *
 * @param plugin - 插件实例
 * @param file - 文件
  * @returns 文本结果 或 null
 */
export async function registerFont(plugin: NovelWriterPlugin, file: TFile): Promise<string | null> {
    const family = sanitizeFamily(file.name);
    if (registeredFonts.has(family)) return family;
    try {
        const buffer = await plugin.app.vault.readBinary(file);
        const font = new FontFace(family, buffer);
        await font.load();
        for (const doc of listDocumentScopes()) {
            doc.fonts?.add(font);
        }
        registeredFonts.set(family, font);
        const list = plugin.settings.customFonts || [];
        if (!list.some(entry => entry.path === file.path)) {
            plugin.settings.customFonts = [...list, { family, path: file.path } as never];
            await plugin.saveSettings();
        }
        log.info(`[FontManager] 字体已注册: ${family} (${file.path})`);
        return family;
    } catch (e) {
        log.warn(`[FontManager] 字体注册失败: ${file.path}`, e);
        new Notice(`字体「${file.name}」载入失败：${e instanceof Error ? e.message : String(e)}`, 6000);
        return null;
    }
}

/**
 * 按 settings 清单注册全部自定义字体（插件启动时调用）
 *
 * @param plugin - 插件实例
 */
export async function registerAllCustomFonts(plugin: NovelWriterPlugin): Promise<void> {
    const entries = plugin.settings.customFonts || [];
    for (const entry of entries) {
        if (registeredFonts.has(entry.family)) continue;
        const file = plugin.app.vault.getAbstractFileByPath(entry.path);
        if (file instanceof TFile) {
            await registerFont(plugin, file);
        }
    }
}

/**
 * 把已注册的字体补进指定 document 的 FontFaceSet。
 *
 * M3-2：popout 第二窗口有独立的 document.fonts，主窗口注册过的 FontFace
 * 不会自动出现在新窗口里，表现为 popout 内自定义字体回落默认字体。
 * 由 main.ts 在 workspace 的 window-open 事件里调用。
 *
 * @param doc - 目标 document（popout 的 win.document）
 * @returns 本次补进的字体数量；目标没有 FontFaceSet 时返回 0
 */
export function addRegisteredFontsTo(doc: Document | null | undefined): number {
    const fonts = doc?.fonts;
    if (!fonts) return 0;
    let added = 0;
    for (const font of registeredFonts.values()) {
        fonts.add(font);
        added += 1;
    }
    return added;
}

/**
 * 注销单个 family（从各窗口 document.fonts 移除并清出 settings）
 *
 * @param plugin - 插件实例
 * @param family - 家族
 */
export async function unregisterFont(plugin: NovelWriterPlugin, family: string): Promise<void> {
    const font = registeredFonts.get(family);
    if (font) {
        for (const doc of listDocumentScopes()) {
            doc.fonts?.delete(font);
        }
        registeredFonts.delete(family);
    }
    plugin.settings.customFonts = (plugin.settings.customFonts || []).filter(entry => entry.family !== family);
    await plugin.saveSettings();
}

/**
 * 注销全部已注册的自定义字体（插件卸载时调用）
 *
 * 遍历模块级 registeredFonts 注册表，逐个从各窗口 document.fonts 移除 FontFace，
 * 最后清空注册表。与 unregisterFont 的区别：本函数只释放运行时资源，
 * 不动 settings.customFonts——卸载仅移除 FontFace，清单保留供下次启动
 * 由 registerAllCustomFonts 恢复。
 *
 * @example
 * ```ts
 * // 插件 onunload 的同步清理区调用，避免热重载后 document.fonts 残留重复字体
 * unregisterAllCustomFonts();
 * ```
 */
export function unregisterAllCustomFonts(): void {
    const count = registeredFonts.size;
    if (count === 0) return;
    const documents = listDocumentScopes();
    for (const font of registeredFonts.values()) {
        for (const doc of documents) {
            doc.fonts?.delete(font);
        }
    }
    registeredFonts.clear();
    log.info(`[FontManager] 卸载清理：已注销 ${count} 个自定义字体 FontFace`);
}

/** 系统字体预设（常见中文字体栈；浏览器无法枚举系统字体，用预设 + 主题变量） */
export const SYSTEM_FONT_PRESETS: Array<{ label: string; value: string }> = [
    { label: '跟随主题正文', value: 'var(--font-text)' },
    { label: '跟随主题界面', value: 'var(--font-interface)' },
    { label: '等宽字体', value: 'var(--font-monospace)' },
    { label: '微软雅黑', value: '"Microsoft YaHei", "微软雅黑", sans-serif' },
    { label: '苹方', value: '"PingFang SC", "Hiragino Sans GB", sans-serif' },
    { label: '宋体', value: 'SimSun, "Songti SC", serif' },
    { label: '楷体', value: 'KaiTi, "Kaiti SC", STKaiti, serif' },
    { label: '黑体', value: 'SimHei, "Heiti SC", sans-serif' },
    { label: '仿宋', value: 'FangSong, "Fangsong SC", STFangsong, serif' },
    { label: '思源黑体', value: '"Source Han Sans SC", "Noto Sans CJK SC", sans-serif' },
    { label: '思源宋体', value: '"Source Han Serif SC", "Noto Serif CJK SC", serif' },
];
