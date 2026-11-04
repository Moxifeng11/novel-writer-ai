/**
 * theme-manager.ts — 主题与布局 CSS 变量管理
 *
 * 职责：注入/更新主题 CSS 变量（暗色/亮色）、布局 CSS 变量
 * 从 main.ts 拆分而来
 */

import type { NovelWriterSettings } from '@/main';
import { derivePalette, paletteToCssVars, resolveActivePresetInput } from '@/shared/theme-colors';

/** ThemeManager 所需的最小设置接口 */
export interface ThemeSettings {
    theme: 'light' | 'dark' | 'auto';
    themeColors?: NovelWriterSettings['themeColors'];
    themePresets?: NovelWriterSettings['themePresets'];
}

/**
 * 布局尺寸设置（面板宽度等）。
 */
export interface LayoutSizeSettings {
    fwStepNav?: number;
    fwRightPanel?: number;
    coWriteLeft?: number;
    coWriteRight?: number;
    kbSidebar?: number;
    entitySide?: number;
}

/**
 * ThemeManager 注入到 documentElement 的全部布局 CSS 变量名（单一事实来源）。
 *
 * injectLayoutVariables 的 set 与 dispose 的 remove 都引用这份清单，
 * 保证「注入过什么就清理什么」严格对称，插件卸载后不残留 --nw-* 布局变量。
 */
const THEME_LAYOUT_VARS = [
    '--nw-wizard-sidebar-w',
    '--nw-entity-tree-w',
    '--nw-modal-max-w',
    '--nw-modal-max-h',
    '--nw-modal-md-w',
    '--nw-project-selector-w',
    '--nw-step-min-h',
    '--nw-scroll-max-h',
    '--nw-scroll-md-h',
    '--nw-grid-3col',
    '--nw-grid-2col-fm',
    '--nw-panel-nav',
    '--nw-panel-context',
    '--nw-panel-pad',
    '--nw-card-pad',
] as const;

/** 布局变量名 → 取值；键类型受 THEME_LAYOUT_VARS 约束，遗漏成员会在编译期报错 */
type ThemeLayoutVarMap = Record<(typeof THEME_LAYOUT_VARS)[number], string>;

/**
 * 主题管理：内置主题、配色派生与样式注入。
 */
export class ThemeManager {
    private getSettings: () => ThemeSettings;
    private getLayoutSizes?: () => LayoutSizeSettings;

    constructor(getSettings: () => ThemeSettings, getLayoutSizes?: () => LayoutSizeSettings) {
        this.getSettings = getSettings;
        this.getLayoutSizes = getLayoutSizes;
    }

    /** 注入主题 CSS 变量（暗色/亮色 + 用户自定义覆盖） */
    injectThemeVariables(): void {
        const old = document.getElementById('novel-writer-theme-vars');
        if (old) old.remove();

        const style = document.createElement('style');
        style.id = 'novel-writer-theme-vars';

        const settings = this.getSettings();
        const isDark = settings.theme === 'dark' ||
            (settings.theme === 'auto' && document.body.classList.contains('theme-dark'));

        const baseVars = isDark ? DARK_THEME_VARS : LIGHT_THEME_VARS;

        const tc = settings.themeColors || {};
        // 三层模型：基底 / 卡片 / 强调。文字按基底亮度自动派生，
        // 面板与卡片默认由基底按氛围预设派生。
        // 旧观感（文字色 / 独立面板色）不再放在 themeColors 里，而是由
        // 「旧配色」方案按 activePresetId 反查后临时叠加。
        const palette = derivePalette(
            resolveActivePresetInput(tc, settings.themePresets || []),
            {
                appBg: isDark ? '#1c1a1e' : '#f0ebe4',
                accent: '#C2410C',
            },
        );
        const overrides = paletteToCssVars(palette);
        const gradient = `--nw-accent-gradient: linear-gradient(90deg, ${palette.accent}, ${palette.accentHover});`;
        const muted = `--nw-text-accent: ${palette.accent};`;

        style.textContent = `:root { ${baseVars} ${overrides} ${gradient} ${muted} }`;
        document.head.appendChild(style);
    }

    /** 注入布局 CSS 变量（全插件生命周期可用） */
    injectLayoutVariables(): void {
        const root = document.documentElement;
        // 工作台三栏：左右宽度来自设置（可在「工作台布局」页调），中栏自适应。
        // 旧实现这里与 full-writer-view 各注入一套不同值（140/220 vs 160/240），
        // 谁后执行谁生效，导致宽度「看起来随机」。
        // 三栏工作区已改为 flex，宽度直接由两个面板变量驱动（可拖拽）
        const sizes = this.getLayoutSizes?.() ?? {};
        const left = Math.max(100, Math.min(400, sizes.fwStepNav ?? 140));
        const right = Math.max(160, Math.min(560, sizes.fwRightPanel ?? 220));
        const values: ThemeLayoutVarMap = {
            '--nw-wizard-sidebar-w': 'clamp(200px, 14vw, 240px)',
            '--nw-entity-tree-w': 'min(240px, 16vw)',
            '--nw-modal-max-w': '96vw',
            '--nw-modal-max-h': '92vh',
            '--nw-modal-md-w': 'min(1000px, 85vw)',
            '--nw-project-selector-w': 'min(900px, 80vw)',
            '--nw-step-min-h': 'max(320px, calc(100vh - 380px))',
            '--nw-scroll-max-h': 'max(400px, 50vh)',
            '--nw-scroll-md-h': 'max(240px, 30vh)',
            '--nw-grid-3col': 'minmax(120px, 160px) 1fr minmax(180px, 240px)',
            '--nw-grid-2col-fm': 'auto 1fr',
            '--nw-panel-nav': `${left}px`,
            '--nw-panel-context': `${right}px`,
            '--nw-panel-pad': '16px',
            '--nw-card-pad': '12px',
        };
        for (const name of THEME_LAYOUT_VARS) {
            root.style.setProperty(name, values[name]);
        }
    }

    /** 清理所有注入的样式 */
    cleanup(): void {
        const allStyles = document.querySelectorAll('style[id^="novel-writer-"]');
        allStyles.forEach(el => el.remove());
    }

    /**
     * 释放 ThemeManager 注入的全部 DOM 资源（满足 EngineRegistry 的 Disposable 契约）。
     *
     * - 移除注入的 style[id^="novel-writer-"] 标签（cleanup()）；
     * - 从 documentElement 逐个移除 injectLayoutVariables set 过的 --nw-* 布局变量
     *   （set 与 remove 共用 THEME_LAYOUT_VARS，保证对称）。
     *
     * 此前只有 cleanup()（生产零调用），布局变量从不移除，导致
     * EngineRegistry.disposeAll() 的 isDisposable 检查静默跳过 ThemeManager；
     * 现在插件卸载时会经由 disposeAll 自动调用本方法。
     */
    dispose(): void {
        this.cleanup();
        const root = document.documentElement;
        for (const name of THEME_LAYOUT_VARS) {
            root.style.removeProperty(name);
        }
    }
}

// ─── 主题 CSS 变量常量 ───

const DARK_THEME_VARS = `
    --nw-app-bg: #1c1a1e;
    --nw-panel-bg: #232026;
    --nw-card-bg: #252226;
    --nw-card-border: #3a3540;
    --nw-card-shadow: 0 2px 8px rgba(0,0,0,0.2);
    --nw-card-shadow-hover: 0 8px 20px rgba(0,0,0,0.35);
    --nw-card-selected-ring: 0 0 0 3px rgba(194, 65, 12, 0.35);
    --nw-text-primary: #f0ece4;
    --nw-text-secondary: #b0a8a0;
    --nw-text-muted: #7e7870;
    --nw-text-accent: #d9874f;
    --nw-text-on-accent: #1e1b1f;
    --nw-accent: #C2410C;
    --nw-accent-hover: #9A3412;
    --nw-accent-muted: rgba(194, 65, 12, 0.15);
    --nw-accent-gradient: linear-gradient(90deg, #C2410C, #D97706);
    --nw-danger: #d47878;
    --nw-danger-hover: #c06060;
    --nw-danger-bg: rgba(212,120,120,0.12);
    --nw-danger-border: rgba(212,120,120,0.3);
    --nw-success: #7aab8e;
    --nw-success-hover: #5e9a72;
    --nw-warning: #d4a76a;
    --nw-divider: #35303a;
    --nw-surface: #1e1b1f;
    --nw-genre-0-bg: rgba(184,125,110,0.18); --nw-genre-0-text: #c99080;
    --nw-genre-1-bg: rgba(155,142,196,0.18); --nw-genre-1-text: #b0a0d0;
    --nw-genre-2-bg: rgba(122,171,142,0.18); --nw-genre-2-text: #90c4a0;
    --nw-genre-3-bg: rgba(212,167,106,0.18); --nw-genre-3-text: #e0c080;
    --nw-genre-4-bg: rgba(130,160,200,0.18); --nw-genre-4-text: #a0c0e0;
    --nw-badge-bg: rgba(184,125,110,0.18);
    --nw-badge-text: #c99080;
    --nw-btn-primary-bg: #C2410C;
    --nw-btn-primary-text: #ffffff;
    --nw-btn-primary-hover-bg: #9A3412;
    --nw-btn-primary-hover-shadow: 0 4px 12px rgba(194, 65, 12, 0.35);
    --nw-btn-secondary-bg: transparent;
    --nw-btn-secondary-text: #b0a8a0;
    --nw-btn-secondary-hover-bg: rgba(194, 65, 12, 0.1);
    --nw-btn-secondary-hover-text: #d9874f;
    --nw-btn-secondary-border: #3e3845;
    --nw-radius-sm: 8px;
    --nw-radius-md: 12px;
    --nw-radius-lg: 16px;
    --nw-focus-ring: rgba(194, 65, 12, 0.3);
    --nw-input-bg: rgba(240,236,228,0.05);
`;

const LIGHT_THEME_VARS = `
    --nw-app-bg: #f0ebe4;
    --nw-panel-bg: #f7f3ee;
    --nw-card-bg: linear-gradient(160deg, #faf5f0 0%, #f5f0f5 50%, #f0f4f8 100%);
    --nw-card-border: #e0d8d0;
    --nw-card-shadow: 0 2px 8px rgba(150, 120, 100, 0.06);
    --nw-card-shadow-hover: 0 8px 20px rgba(150, 120, 100, 0.12);
    --nw-card-selected-ring: 0 0 0 3px rgba(194, 65, 12, 0.25);
    --nw-text-primary: #3d3530;
    --nw-text-secondary: #8b7e70;
    --nw-text-muted: #a09890;
    --nw-text-accent: #b8531f;
    --nw-text-on-accent: #fff;
    --nw-accent: #C2410C;
    --nw-accent-hover: #9A3412;
    --nw-accent-muted: rgba(194, 65, 12, 0.12);
    --nw-accent-gradient: linear-gradient(90deg, #C2410C, #D97706);
    --nw-danger: #c06060;
    --nw-danger-hover: #a05050;
    --nw-danger-bg: rgba(192,96,96,0.06);
    --nw-danger-border: #e0b8b8;
    --nw-success: #5e9a72;
    --nw-success-hover: #4a8058;
    --nw-warning: #d4a76a;
    --nw-divider: #e0d8d0;
    --nw-surface: #f8f3ee;
    --nw-genre-0-bg: #f0e6e0; --nw-genre-0-text: #8b5c4c;
    --nw-genre-1-bg: #ece6f0; --nw-genre-1-text: #6e5c8b;
    --nw-genre-2-bg: #dce8e0; --nw-genre-2-text: #4a6e58;
    --nw-genre-3-bg: #f5ead5; --nw-genre-3-text: #8b6c40;
    --nw-genre-4-bg: #dce4f0; --nw-genre-4-text: #4c608b;
    --nw-badge-bg: #f0e6e0;
    --nw-badge-text: #8b5c4c;
    --nw-btn-primary-bg: #C2410C;
    --nw-btn-primary-text: #ffffff;
    --nw-btn-primary-hover-bg: #9A3412;
    --nw-btn-primary-hover-shadow: 0 4px 12px rgba(194, 65, 12, 0.35);
    --nw-btn-primary-disabled-bg: rgba(194, 65, 12, 0.4);
    --nw-btn-primary-disabled-text: rgba(255, 255, 255, 0.6);
    --nw-btn-secondary-bg: transparent;
    --nw-btn-secondary-text: #8b7e70;
    --nw-btn-secondary-hover-bg: #f0e6e0;
    --nw-btn-secondary-hover-text: #8b5c4c;
    --nw-btn-secondary-border: #e0d8d0;
    --nw-radius-sm: 8px;
    --nw-radius-md: 12px;
    --nw-radius-lg: 16px;
    --nw-focus-ring: rgba(194, 65, 12, 0.2);
    --nw-input-bg: rgba(0,0,0,0.03);
`;
