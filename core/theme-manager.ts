/**
 * theme-manager.ts — 主题与布局 CSS 变量管理
 *
 * 职责：注入/更新主题 CSS 变量（暗色/亮色）、布局 CSS 变量
 * 从 main.ts 拆分而来
 */

import type { NovelWriterSettings } from '../main';

/** ThemeManager 所需的最小设置接口 */
export interface ThemeSettings {
    theme: 'light' | 'dark' | 'auto';
    themeColors?: NovelWriterSettings['themeColors'];
}

export class ThemeManager {
    private getSettings: () => ThemeSettings;

    constructor(getSettings: () => ThemeSettings) {
        this.getSettings = getSettings;
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

        let vars = isDark ? DARK_THEME_VARS : LIGHT_THEME_VARS;

        const tc = settings.themeColors || {};
        const preset: 'soft' | 'clear' | 'paper' = tc.appearancePreset || 'soft';

        const PRESET_STEPS: Record<'soft' | 'clear' | 'paper', { panel: number; card: number; lift: string }> = {
            soft: { panel: 8, card: 16, lift: '#ffffff' },
            clear: { panel: 14, card: 26, lift: '#ffffff' },
            paper: { panel: 6, card: 12, lift: '#fff3df' },
        };
        const step = PRESET_STEPS[preset] ?? PRESET_STEPS.soft;

        if (tc.appBg) {
            vars += `--nw-app-bg: ${tc.appBg};`;
        }
        if (tc.panelBg) {
            vars += `--nw-panel-bg: ${tc.panelBg};`;
        } else {
            vars += `--nw-panel-bg: color-mix(in srgb, var(--nw-app-bg), ${step.lift} ${step.panel}%);`;
        }
        if (tc.enableCustomCardBg && tc.cardBg) {
            vars += `--nw-card-bg: ${tc.cardBg};`;
        } else {
            vars += `--nw-card-bg: color-mix(in srgb, var(--nw-app-bg), ${step.lift} ${step.card}%);`;
        }
        if (tc.accent) {
            vars += `--nw-accent: ${tc.accent}; --nw-accent-hover: ${tc.accent}; --nw-accent-gradient: linear-gradient(90deg, ${tc.accent}, ${tc.accent});`;
        }
        if (tc.textPrimary) {
            vars += `--nw-text-primary: ${tc.textPrimary};`;
        }

        style.textContent = `:root { ${vars} }`;
        document.head.appendChild(style);
    }

    /** 注入布局 CSS 变量（全插件生命周期可用） */
    injectLayoutVariables(): void {
        const root = document.documentElement;
        root.style.setProperty('--nw-wizard-sidebar-w', 'clamp(200px, 14vw, 240px)');
        root.style.setProperty('--nw-entity-tree-w', 'min(240px, 16vw)');
        root.style.setProperty('--nw-modal-max-w', '96vw');
        root.style.setProperty('--nw-modal-max-h', '92vh');
        root.style.setProperty('--nw-modal-md-w', 'min(1000px, 85vw)');
        root.style.setProperty('--nw-project-selector-w', 'min(900px, 80vw)');
        root.style.setProperty('--nw-step-min-h', 'max(320px, calc(100vh - 380px))');
        root.style.setProperty('--nw-scroll-max-h', 'max(400px, 50vh)');
        root.style.setProperty('--nw-scroll-md-h', 'max(240px, 30vh)');
        root.style.setProperty('--nw-grid-3col', 'minmax(120px, 160px) 1fr minmax(180px, 240px)');
        root.style.setProperty('--nw-grid-2col-fm', 'auto 1fr');
        root.style.setProperty('--nw-grid-workspace', 'minmax(100px, 140px) 1fr minmax(160px, 220px)');
        root.style.setProperty('--nw-panel-pad', '16px');
        root.style.setProperty('--nw-card-pad', '12px');
    }

    /** 清理所有注入的样式 */
    cleanup(): void {
        const allStyles = document.querySelectorAll('style[id^="novel-writer-"]');
        allStyles.forEach(el => el.remove());
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
    --nw-card-selected-ring: 0 0 0 3px rgba(184,125,110,0.35);
    --nw-cover-bg: linear-gradient(135deg, #2a2030 0%, #252228 40%, #1e2530 100%);
    --nw-cover-bg-hover: brightness(1.12);
    --nw-text-primary: #f0ece4;
    --nw-text-secondary: #b0a8a0;
    --nw-text-muted: #7e7870;
    --nw-text-accent: #9b8ec4;
    --nw-text-on-accent: #1e1b1f;
    --nw-accent: #b87d6e;
    --nw-accent-hover: #c99080;
    --nw-accent-muted: rgba(184,125,110,0.15);
    --nw-accent-gradient: linear-gradient(90deg, #b87d6e, #9b8ec4);
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
    --nw-btn-primary-bg: linear-gradient(135deg, #b87d6e, #9b8ec4);
    --nw-btn-primary-text: #f0ece4;
    --nw-btn-primary-hover-shadow: 0 4px 14px rgba(184,125,110,0.35);
    --nw-btn-secondary-bg: transparent;
    --nw-btn-secondary-text: #b0a8a0;
    --nw-btn-secondary-hover-bg: rgba(155,142,196,0.1);
    --nw-btn-secondary-hover-text: #c4b8e0;
    --nw-btn-secondary-border: #3e3845;
    --nw-radius-sm: 8px;
    --nw-radius-md: 12px;
    --nw-radius-lg: 16px;
    --nw-focus-ring: rgba(184, 125, 110, 0.3);
    --nw-input-bg: rgba(240,236,228,0.05);
`;

const LIGHT_THEME_VARS = `
    --nw-app-bg: #f0ebe4;
    --nw-panel-bg: #f7f3ee;
    --nw-card-bg: linear-gradient(160deg, #faf5f0 0%, #f5f0f5 50%, #f0f4f8 100%);
    --nw-card-border: #e0d8d0;
    --nw-card-shadow: 0 2px 8px rgba(150, 120, 100, 0.06);
    --nw-card-shadow-hover: 0 8px 20px rgba(150, 120, 100, 0.12);
    --nw-card-selected-ring: 0 0 0 3px rgba(184,125,110,0.25);
    --nw-cover-bg: linear-gradient(135deg, #e8d5c8 0%, #d5d0e8 40%, #d0e8e0 100%);
    --nw-cover-bg-hover: brightness(1.05);
    --nw-text-primary: #3d3530;
    --nw-text-secondary: #8b7e70;
    --nw-text-muted: #a09890;
    --nw-text-accent: #7c6e9e;
    --nw-text-on-accent: #fff;
    --nw-accent: #b87d6e;
    --nw-accent-hover: #9e6a5c;
    --nw-accent-muted: rgba(184,125,110,0.12);
    --nw-accent-gradient: linear-gradient(90deg, #b87d6e, #9b8ec4);
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
    --nw-btn-primary-bg: linear-gradient(135deg, #b87d6e, #9b8ec4);
    --nw-btn-primary-text: #fff;
    --nw-btn-primary-hover-shadow: 0 4px 12px rgba(184,125,110,0.3);
    --nw-btn-secondary-bg: transparent;
    --nw-btn-secondary-text: #8b7e70;
    --nw-btn-secondary-hover-bg: #f0e6e0;
    --nw-btn-secondary-hover-text: #8b5c4c;
    --nw-btn-secondary-border: #e0d8d0;
    --nw-radius-sm: 8px;
    --nw-radius-md: 12px;
    --nw-radius-lg: 16px;
    --nw-focus-ring: rgba(184, 125, 110, 0.2);
    --nw-input-bg: rgba(0,0,0,0.03);
`;
