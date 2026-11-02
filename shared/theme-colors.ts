/**
 * theme-colors.ts — 三层配色模型（纯函数，可测）
 *
 * 背景（2026-10-29 重构）：
 * 外观设置此前暴露 5 个彼此独立的颜色配置（底色 / 面板色 / 卡片背景色 /
 * 强调色 / 主文字色），CSS 里还多出 `--nw-surface`、`--nw-cover-bg` 两个
 * 平行背景 token，加上 `enableCustomCardBg` 开关又引入一层间接判断。
 * 结果是：用户不知道该改哪个；每次取色都触发整页重渲染；层级容易调平。
 *
 * 收敛为三层：
 *   L1 基底（base）  → --nw-app-bg，面板/表面由它按预设明度派生
 *   L2 卡片（card）  → --nw-card-bg
 *   L3 强调（accent）→ --nw-accent，文字色按对比度自动派生
 *
 * 文字不再单独配置：由基底亮度决定深浅，保证任何配色下都可读。
 */

/** 界面氛围预设：决定面板/卡片相对基底的抬起幅度 */
export type AppearancePreset = 'soft' | 'clear' | 'paper';

/**
 * 预设步骤列表结构定义。
 */
export interface PresetSteps {
    /** 面板相对基底抬起的百分比（0-100） */
    panel: number;
    /** 卡片相对基底抬起的百分比（0-100） */
    card: number;
    /** 混合用的提亮色 */
    lift: string;
}

/**
 * 预设步骤列表常量。
 */
export const PRESET_STEPS: Record<AppearancePreset, PresetSteps> = {
    soft: { panel: 8, card: 16, lift: '#ffffff' },
    clear: { panel: 14, card: 26, lift: '#ffffff' },
    paper: { panel: 6, card: 12, lift: '#fff3df' },
};

/** 三层配置输入：只保留这三个用户可调项 */
export interface ThreeLayerInput {
    /** L1 基底色；缺省由主题默认值决定 */
    base?: string;
    /** L2 卡片色；缺省按预设从基底派生 */
    card?: string;
    /** L3 强调色；缺省由主题默认值决定 */
    accent?: string;
    /** 主文字色覆盖；缺省按基底亮度自动派生 */
    text?: string;
    preset?: AppearancePreset;
    /**
     * 面板色直通值。
     *
     * 只由「旧配色」这类历史方案提供（v4→v5 迁移时冻结），
     * 普通三层配置不会传它——面板始终从基底按氛围预设派生。
     */
    legacyPanel?: string;
}

/** 派生结果：直接写入 CSS 变量 */
export interface DerivedPalette {
    appBg: string;
    panelBg: string;
    cardBg: string;
    accent: string;
    accentHover: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
}

/**
 * 规范化预设。
 * @param value - 值
  * @returns AppearancePreset 实例
 */
export function normalizePreset(value: unknown): AppearancePreset {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (text === 'clear' || text === 'paper' || text === 'soft') return text;
    return 'soft';
}

/**
 * 合法 6 位 / 3 位 hex 才允许写入 CSS 变量，避免注入无效值
 *
 * @param value - 值
  * @returns value is string 结果
 */
export function isHexColor(value: unknown): value is string {
    return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim());
}

/**
 * hex → [r,g,b]（0-255）；非法输入返回 null
 *
 * @param hex - 十六进制颜色
  * @returns [number, number, number] 结果 或 null
 */
export function hexToRgb(hex: string): [number, number, number] | null {
    if (!isHexColor(hex)) return null;
    let body = hex.trim().slice(1);
    if (body.length === 3) body = body.split('').map(ch => ch + ch).join('');
    if (body.length === 8) body = body.slice(0, 6);
    const n = parseInt(body, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * WCAG 相对亮度（0 = 全黑，1 = 全白）
 *
 * @param hex - 十六进制颜色
  * @returns 数值结果 或 null
 */
export function relativeLuminance(hex: string): number | null {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const [r, g, b] = rgb.map(channel => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 该背景是深色吗（用于决定文字取亮还是取暗）
 *
 * @param hex - 十六进制颜色
  * @returns 是否成功 或 null
 */
export function isDarkBackground(hex: string): boolean | null {
    const luminance = relativeLuminance(hex);
    if (luminance === null) return null;
    return luminance < 0.5;
}

/**
 * 按基底亮度派生一套文字色。
 * 不再让用户单独配文字色——三层模型里文字是对比度问题，不是配色问题。
 * @param baseBg - 基础背景色
  * @returns 结果
 */
export function deriveTextColors(baseBg: string): Pick<DerivedPalette, 'textPrimary' | 'textSecondary' | 'textMuted'> {
    const dark = isDarkBackground(baseBg);
    if (dark === null) {
        // 非法或渐变值：交给主题兜底变量
        return {
            textPrimary: 'var(--nw-text-primary, #f0ece4)',
            textSecondary: 'var(--nw-text-secondary, #b0a8a0)',
            textMuted: 'var(--nw-text-muted, #7e7870)',
        };
    }
    if (dark) {
        return { textPrimary: '#f0ece4', textSecondary: '#b0a8a0', textMuted: '#7e7870' };
    }
    return { textPrimary: '#3d3530', textSecondary: '#8b7e70', textMuted: '#a09890' };
}

/**
 * 强调色 hover：深色背景上提亮，浅色背景上加深
 *
 * @param accent - 强调色
 * @param baseBg - 基础背景色
 * @returns 文本结果
 */
export function deriveAccentHover(accent: string, baseBg: string): string {
    const rgb = hexToRgb(accent);
    if (!rgb) return accent;
    const dark = isDarkBackground(baseBg) === true;
    const delta = dark ? 22 : -22;
    const [r, g, b] = rgb.map(channel => Math.max(0, Math.min(255, channel + delta)));
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * 三层输入 → 可直接写入 :root 的一整套变量。
 *
 * 面板与卡片默认都用 `color-mix` 相对基底派生，因此用户只填「底色」就能
 * 得到稳定分层；填了「卡片色」才覆盖 L2。这消除了旧模型里
 * 「底色/面板色/卡片色」三个独立输入 + 一个开关的组合爆炸。
 * @param input - 输入
 * @param themeDefaults - 主题默认值
  * @returns DerivedPalette 实例
 */
export function derivePalette(
    input: ThreeLayerInput,
    themeDefaults: { appBg: string; cardBg?: string; accent: string },
): DerivedPalette {
    const preset = normalizePreset(input.preset);
    const step = PRESET_STEPS[preset];

    const appBg = isHexColor(input.base) ? input.base.trim() : themeDefaults.appBg;
    const panelBg = isHexColor(input.legacyPanel)
        ? input.legacyPanel.trim()
        : `color-mix(in srgb, ${appBg}, ${step.lift} ${step.panel}%)`;
    const cardBg = isHexColor(input.card)
        ? input.card.trim()
        : `color-mix(in srgb, ${appBg}, ${step.lift} ${step.card}%)`;
    const accent = isHexColor(input.accent) ? input.accent.trim() : themeDefaults.accent;

    const texts = isHexColor(input.text)
        ? (() => {
            // 显式文字色：仍按它自己的亮度补齐次级/弱化色
            const derived = deriveTextColors(input.text.trim());
            return { textPrimary: input.text.trim(), textSecondary: derived.textSecondary, textMuted: derived.textMuted };
        })()
        : deriveTextColors(appBg);

    return {
        appBg,
        panelBg,
        cardBg,
        accent,
        accentHover: deriveAccentHover(accent, appBg),
        ...texts,
    };
}

/**
 * 渲染成 `--nw-*: value;` 片段，供 ThemeManager 拼接
 *
 * @param palette - 配色
 * @returns 文本结果
 */
export function paletteToCssVars(palette: DerivedPalette): string {
    return [
        `--nw-app-bg: ${palette.appBg};`,
        `--nw-panel-bg: ${palette.panelBg};`,
        // --nw-surface 是面板的语义别名（33 处样式按「表面」语义引用它）。
        // 让它恒等于面板值，就不必改那 33 处，也不会出现两套背景打架。
        `--nw-surface: ${palette.panelBg};`,
        // hover 态从卡片色往强调色偏一点，替代原先直接引用 Obsidian 的背景变量
        `--nw-surface-hover: color-mix(in srgb, ${palette.panelBg}, ${palette.accent} 6%);`,
        `--nw-card-bg-hover: color-mix(in srgb, ${palette.cardBg}, ${palette.accent} 8%);`,
        `--nw-card-hover: color-mix(in srgb, ${palette.cardBg}, ${palette.accent} 8%);`,
        // 封面沿用「基底→卡片」的斜向渐变，保证与三层色一致
        `--nw-cover-bg: linear-gradient(135deg, ${palette.panelBg} 0%, ${palette.cardBg} 55%, ${palette.appBg} 100%);`,
        `--nw-card-bg: ${palette.cardBg};`,
        `--nw-accent: ${palette.accent};`,
        `--nw-accent-hover: ${palette.accentHover};`,
        // 主按钮 token 跟随强调色。静态主题里它们是硬编码 #C2410C，
        // 不覆盖的话用户改「强调色」时主按钮不会变（历史 Bug）。
        `--nw-btn-primary-bg: ${palette.accent};`,
        `--nw-btn-primary-hover-bg: ${palette.accentHover};`,
        `--nw-text-primary: ${palette.textPrimary};`,
        `--nw-text-secondary: ${palette.textSecondary};`,
        `--nw-text-muted: ${palette.textMuted};`,
    ].join(' ');
}

// ─── 主题配色方案（保存 / 切换 / 导入导出）────────────────────────

/** 一套可保存的配色方案 */
export interface ThemePreset {
    id: string;
    name: string;
    createdAt: number;
    /** 三层颜色 + 氛围 + 主题模式 */
    base?: string;
    card?: string;
    accent?: string;
    text?: string;
    preset?: AppearancePreset;
    theme?: 'auto' | 'light' | 'dark';
    /**
     * 旧版独立面板色。仅「旧配色（v4.21）」这类迁移冻结的方案会带，
     * 用户新建的三层方案永不写入。
     */
    legacyPanel?: string;
}

/** 单套方案名上限，避免把内存塞满 */
export const THEME_PRESET_NAME_MAX = 24;
/** 方案数量上限 */
export const THEME_PRESET_LIMIT = 20;
/** 单套方案体积上限（序列化字符数），用于导入校验 */
export const THEME_PRESET_BYTES_MAX = 2048;

/**
 * 清洗方案名：去空白、截断、空则给默认名
 *
 * @param raw - 原始
 * @param fallbackIndex - 回退索引
 * @returns 文本结果
 */
export function sanitizePresetName(raw: unknown, fallbackIndex = 1): string {
    const text = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (!text) return `配色方案 ${fallbackIndex}`;
    return text.length > THEME_PRESET_NAME_MAX ? text.slice(0, THEME_PRESET_NAME_MAX) : text;
}

/**
 * 校验并清洗一套方案；非法返回 null
 *
 * @param raw - 原始
  * @returns ThemePreset 或 null
 */
export function normalizeThemePreset(raw: unknown): ThemePreset | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const name = sanitizePresetName(obj.name);
    const preset: ThemePreset = {
        id: typeof obj.id === 'string' && obj.id ? obj.id : `theme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        createdAt: typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt) ? obj.createdAt : Date.now(),
    };
    if (isHexColor(obj.base)) preset.base = obj.base.trim();
    if (isHexColor(obj.card)) preset.card = obj.card.trim();
    if (isHexColor(obj.accent)) preset.accent = obj.accent.trim();
    if (isHexColor(obj.text)) preset.text = obj.text.trim();
    if (obj.preset === 'soft' || obj.preset === 'clear' || obj.preset === 'paper') preset.preset = obj.preset;
    if (obj.theme === 'auto' || obj.theme === 'light' || obj.theme === 'dark') preset.theme = obj.theme;
    // 迁移冻结的「旧配色」会带面板直通值；普通三层方案不会
    if (isHexColor(obj.legacyPanel)) preset.legacyPanel = obj.legacyPanel.trim();
    if (JSON.stringify(preset).length > THEME_PRESET_BYTES_MAX) return null;
    return preset;
}

/**
 * 从当前设置生成一套方案（用于「保存当前配色」）
 *
 * @param colors - 颜色
 * @param theme - 主题
 * @param name - 名称
 * @param existing - 已有
  * @returns ThemePreset 实例
 */
export function capturePreset(
    colors: { appBg?: string; cardBg?: string; accent?: string; textPrimary?: string; appearancePreset?: string } | undefined,
    theme: 'auto' | 'light' | 'dark',
    name: string,
    existing: readonly ThemePreset[] = [],
): ThemePreset {
    const preset: ThemePreset = {
        id: `theme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: sanitizePresetName(name, existing.length + 1),
        createdAt: Date.now(),
        preset: normalizePreset(colors?.appearancePreset),
        theme,
    };
    if (isHexColor(colors?.appBg)) preset.base = colors.appBg.trim();
    if (isHexColor(colors?.cardBg)) preset.card = colors.cardBg.trim();
    if (isHexColor(colors?.accent)) preset.accent = colors.accent.trim();
    if (isHexColor(colors?.textPrimary)) preset.text = colors.textPrimary.trim();
    return preset;
}

/**
 * 把一套方案写回设置字段。
 *
 * 只写三层 + 氛围 + 激活 id。文字色与旧面板直通值留在方案对象里，
 * 由 `resolveActivePresetInput` 在注入变量时反查叠加——如果把它们塞进
 * themeColors，三层结构就又被撑回 5 层了。
 *
 * @param preset - 预设
 * @returns 可直接写入设置的字段
 */
export function presetToSettings(preset: ThemePreset): {
    theme: 'auto' | 'light' | 'dark';
    themeColors: { appBg?: string; cardBg?: string; accent?: string; appearancePreset: AppearancePreset; activePresetId: string };
} {
    const themeColors: { appBg?: string; cardBg?: string; accent?: string; appearancePreset: AppearancePreset; activePresetId: string } = {
        appearancePreset: normalizePreset(preset.preset),
        activePresetId: preset.id,
    };
    if (preset.base) themeColors.appBg = preset.base;
    if (preset.card) themeColors.cardBg = preset.card;
    if (preset.accent) themeColors.accent = preset.accent;
    return { theme: preset.theme ?? 'auto', themeColors };
}

/**
 * 把「当前激活方案」还原成三层派生输入。
 *
 * themeColors 只保留三层 + 氛围；方案里的额外观感（文字色、旧面板直通值）
 * 不写回 themeColors（否则又变成 5 层），而是按 activePresetId 反查后
 * 临时叠加到派生输入上。
 * @param themeColors - 主题颜色
 * @param presets - 预设列表
  * @returns ThreeLayerInput 实例
 */
export function resolveActivePresetInput(
    themeColors: { appBg?: string; cardBg?: string; accent?: string; appearancePreset?: string; activePresetId?: string } | undefined,
    presets: readonly ThemePreset[] = [],
): ThreeLayerInput {
    const input: ThreeLayerInput = {
        base: themeColors?.appBg,
        card: themeColors?.cardBg,
        accent: themeColors?.accent,
        preset: normalizePreset(themeColors?.appearancePreset),
    };
    const activeId = themeColors?.activePresetId;
    if (!activeId) return input;
    const active = presets.find(item => item.id === activeId);
    if (!active) return input;
    // 方案提供、而 themeColors 没有的项才叠加，保证手动改色后以手改为准
    if (!input.text && active.text) input.text = active.text;
    if (active.legacyPanel) input.legacyPanel = active.legacyPanel;
    return input;
}

/**
 * 追加方案（同名替换、超上限淘汰最旧）
 *
 * @param list - 列表
 * @param preset - 预设
 * @returns 结果数组
 */
export function upsertPreset(list: readonly ThemePreset[], preset: ThemePreset): ThemePreset[] {
    const withoutSameName = list.filter(item => item.name !== preset.name);
    const next = [...withoutSameName, preset];
    if (next.length <= THEME_PRESET_LIMIT) return next;
    return [...next]
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(next.length - THEME_PRESET_LIMIT);
}

/**
 * 解析导入的 JSON（支持单套或数组）
 *
 * @param raw - 原始
 * @param existing - 已有
 * @returns 结果数组
 */
export function parsePresetImport(raw: string, existing: readonly ThemePreset[] = []): ThemePreset[] {
    const text = String(raw || '').trim();
    if (!text) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return [];
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    const result: ThemePreset[] = [];
    let merged = [...existing];
    for (const candidate of candidates) {
        const preset = normalizeThemePreset(candidate);
        if (!preset) continue;
        // 导入的 id 可能与本地冲突，换成本地新 id
        if (merged.some(item => item.id === preset.id)) {
            preset.id = `theme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        }
        merged = upsertPreset(merged, preset);
        result.push(preset);
    }
    return result;
}
