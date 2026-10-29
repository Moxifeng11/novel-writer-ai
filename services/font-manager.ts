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
 *   `document.fonts.add()`，随后任意元素 `font-family: "<family>"` 即可生效；
 *   卸载用 `document.fonts.delete(font)`。
 * - 存放位置：vault 内 `元文件/字体/`（用户可直接放入字体文件，随同步保留），
 *   插件启动与手动刷新时扫描注册，清单持久化在 settings.customFonts。
 * - 系统字体无法在浏览器环境枚举：提供（a）Obsidian 主题字体 CSS 变量、
 *   （b）常见中文系统字体预设栈、（c）自定义载入字体 三类来源。
 */
import { Notice, TFile } from 'obsidian';
import type NovelWriterPlugin from '../main';
import { createLogger } from '../shared/logger';

const log = createLogger('FontManager');

/** 字体文件存放目录（vault 根下） */
export const FONT_DIR = '元文件/字体';

export const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'] as const;

export type FontFileFormat = 'truetype' | 'opentype' | 'woff' | 'woff2';

export interface CustomFontEntry {
    /** FontFace family 名（取文件名去扩展名） */
    family: string;
    /** vault 内绝对路径 */
    path: string;
}

const registeredFonts = new Map<string, FontFace>();

/** 是否受支持的字体文件 */
export function isSupportedFontFile(name: string): boolean {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    return (FONT_EXTENSIONS as readonly string[]).includes(ext);
}

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

/** FontFace family 名：文件名去扩展名，剔除 CSS 非法字符 */
export function sanitizeFamily(fileName: string): string {
    const base = fileName.replace(/\.[^.]+$/, '').trim();
    const cleaned = base.replace(/["'\\]/g, '').replace(/\s+/g, ' ');
    return cleaned || '自定义字体';
}

/** 已注册（载入成功且记录在 settings）的自定义字体 family 列表 */
export function getCustomFontFamilies(plugin: NovelWriterPlugin): string[] {
    return (plugin.settings.customFonts || []).map(entry => entry.family);
}

/** 扫描字体目录中尚未登记的字体文件 */
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

/** 注册单个字体文件（读二进制 → FontFace → document.fonts） */
export async function registerFont(plugin: NovelWriterPlugin, file: TFile): Promise<string | null> {
    const family = sanitizeFamily(file.name);
    if (registeredFonts.has(family)) return family;
    try {
        const buffer = await plugin.app.vault.readBinary(file);
        const font = new FontFace(family, buffer);
        await font.load();
        document.fonts.add(font);
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

/** 按 settings 清单注册全部自定义字体（插件启动时调用） */
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

/** 注销单个 family（从 document.fonts 移除并清出 settings） */
export async function unregisterFont(plugin: NovelWriterPlugin, family: string): Promise<void> {
    const font = registeredFonts.get(family);
    if (font) {
        document.fonts.delete(font);
        registeredFonts.delete(family);
    }
    plugin.settings.customFonts = (plugin.settings.customFonts || []).filter(entry => entry.family !== family);
    await plugin.saveSettings();
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
