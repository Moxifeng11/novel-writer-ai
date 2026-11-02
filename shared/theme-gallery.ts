/**
 * theme-gallery.ts — 内置主题画廊（三层配色预设）
 *
 * 与 `theme-colors.ts` 共用同一套三层模型：
 *   L1 基底 base  → --nw-app-bg（面板/表面按氛围预设派生）
 *   L2 卡片 card  → --nw-card-bg
 *   L3 强调 accent→ --nw-accent（hover / 主按钮 token 一并派生）
 *
 * 每个主题同时提供浅色与深色两套三层值，点一下就写入 themeColors 并立即重注入
 * CSS 变量。内置主题不写进 settings.themePresets（那是用户自己存的方案），
 * 只把 activePresetId 记为 `builtin:<id>:<mode>`，因此不会占用户的方案配额。
 */

import type { AppearancePreset, ThemePreset } from './theme-colors';
import { isHexColor } from './theme-colors';

export type ThemeMode = 'light' | 'dark';

export interface GalleryVariant {
    /** L1 基底色 */
    base: string;
    /** L2 卡片色 */
    card: string;
    /** L3 强调色 */
    accent: string;
    /** 卡片/面板相对基底抬起的幅度 */
    preset: AppearancePreset;
}

export interface GalleryTheme {
    id: string;
    /** 主题名（用于按钮与提示） */
    name: string;
    /** 一句话说明配色气质 */
    description: string;
    light: GalleryVariant;
    dark: GalleryVariant;
}

/** activePresetId 前缀：内置主题不进入用户的 themePresets 列表 */
export const BUILTIN_PRESET_PREFIX = 'builtin:';

/**
 * 内置主题列表。
 *
 * 取色原则：
 * - 基底与卡片保持同一色相，只差明度（保证三层可分辨但不花）
 * - 强调色在两种模式下都满足与底色的可读对比（深色底用提亮版本）
 * - 浅色主题偏纸感（paper），深色主题一律 soft，避免深色下卡片过亮
 */
export const BUILTIN_THEMES: readonly GalleryTheme[] = [
    {
        id: 'xuanzhi',
        name: '宣纸墨',
        description: '暖白纸底 + 朱砂强调，默认观感',
        light: { base: '#F0EBE4', card: '#FAF6F0', accent: '#C2410C', preset: 'paper' },
        dark: { base: '#1C1A1E', card: '#26232A', accent: '#E8703A', preset: 'soft' },
    },
    {
        id: 'celadon',
        name: '青瓷',
        description: '青绿冷调，长时间阅读不刺眼',
        light: { base: '#EDF2EF', card: '#F7FAF8', accent: '#2F6E63', preset: 'paper' },
        dark: { base: '#16211F', card: '#1F2C29', accent: '#4FB3A2', preset: 'soft' },
    },
    {
        id: 'indigo',
        name: '靛蓝',
        description: '偏冷的靛蓝强调，适合界面密集操作',
        light: { base: '#EDF0F8', card: '#F8FAFF', accent: '#3B5BDB', preset: 'clear' },
        dark: { base: '#121620', card: '#1C2230', accent: '#7B93FF', preset: 'soft' },
    },
    {
        id: 'cinnabar',
        name: '朱砂笺',
        description: '暖红纸感，情绪浓的故事更搭',
        light: { base: '#F8EFE9', card: '#FFF9F4', accent: '#B03A2E', preset: 'paper' },
        dark: { base: '#221614', card: '#2E1F1C', accent: '#E4705C', preset: 'soft' },
    },
    {
        id: 'pine',
        name: '松烟',
        description: '灰绿低饱和，接近水墨稿纸',
        light: { base: '#F1F2EE', card: '#FBFCF8', accent: '#4F6B4A', preset: 'clear' },
        dark: { base: '#171A16', card: '#21261F', accent: '#9DB894', preset: 'soft' },
    },
    {
        id: 'midnight',
        name: '墨蓝',
        description: '近乎无彩的墨蓝，专注写作不抢注意力',
        light: { base: '#F2F2F5', card: '#FBFBFE', accent: '#4A4E69', preset: 'clear' },
        dark: { base: '#111114', card: '#1A1A20', accent: '#9A9EC4', preset: 'soft' },
    },
    {
        id: 'sand',
        name: '暖砂',
        description: '沙棕暖调，偏向纸质稿的柔和',
        light: { base: '#F7F0E4', card: '#FFFBF2', accent: '#9A6A3A', preset: 'paper' },
        dark: { base: '#201B16', card: '#2B241C', accent: '#D0A06A', preset: 'soft' },
    },
];

export function findBuiltinTheme(id: string): GalleryTheme | undefined {
    return BUILTIN_THEMES.find(theme => theme.id === id);
}

export function builtinPresetId(themeId: string, mode: ThemeMode): string {
    return `${BUILTIN_PRESET_PREFIX}${themeId}:${mode}`;
}

/**
 * 解析 activePresetId；非内置或形态不对返回 null
 *
 * @param activePresetId - 当前预设 ID
  * @returns ThemeMode } 或 null
 */
export function parseBuiltinPresetId(activePresetId: string | undefined): { themeId: string; mode: ThemeMode } | null {
    if (!activePresetId || !activePresetId.startsWith(BUILTIN_PRESET_PREFIX)) return null;
    const body = activePresetId.slice(BUILTIN_PRESET_PREFIX.length);
    const sep = body.lastIndexOf(':');
    if (sep <= 0) return null;
    const themeId = body.slice(0, sep);
    const mode = body.slice(sep + 1);
    if (mode !== 'light' && mode !== 'dark') return null;
    if (!findBuiltinTheme(themeId)) return null;
    return { themeId, mode };
}

export function isBuiltinPresetId(activePresetId: string | undefined): boolean {
    return parseBuiltinPresetId(activePresetId) !== null;
}

/**
 * 内置主题 → 可应用的方案对象。
 *
 * 复用 ThemePreset 形态，落盘路径与用户方案完全一致
 * （presetToSettings → themeColors + theme），不改注入逻辑。
 * @param theme - 主题
 * @param mode - 模式
  * @returns ThemePreset 实例
 */
export function galleryThemeToPreset(theme: GalleryTheme, mode: ThemeMode): ThemePreset {
    const variant = mode === 'dark' ? theme.dark : theme.light;
    return {
        id: builtinPresetId(theme.id, mode),
        name: `${theme.name}·${mode === 'dark' ? '深色' : '浅色'}`,
        createdAt: 0,
        base: variant.base,
        card: variant.card,
        accent: variant.accent,
        preset: variant.preset,
        theme: mode,
    };
}

/**
 * 方案是否可用：三层都必须是合法 hex，否则会写入无效 CSS 变量
 *
 * @param theme - 主题
 * @returns 是否成功
 */
export function isGalleryThemeValid(theme: GalleryTheme): boolean {
    const ok = (v: GalleryVariant) =>
        isHexColor(v.base) && isHexColor(v.card) && isHexColor(v.accent)
        && (v.preset === 'soft' || v.preset === 'clear' || v.preset === 'paper');
    return ok(theme.light) && ok(theme.dark);
}

/**
 * 当前模式下应高亮的内置主题（用于设置页按钮态）
 *
 * @param activePresetId - 当前预设 ID
  * @returns ThemeMode } 或 null
 */
export function activeBuiltinTheme(
    activePresetId: string | undefined,
): { themeId: string; mode: ThemeMode } | null {
    return parseBuiltinPresetId(activePresetId);
}
