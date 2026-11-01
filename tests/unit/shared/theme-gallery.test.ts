import { describe, expect, it } from 'vitest';
import {
    BUILTIN_THEMES,
    activeBuiltinTheme,
    builtinPresetId,
    galleryThemeToPreset,
    isBuiltinPresetId,
    isGalleryThemeValid,
    parseBuiltinPresetId,
} from '../../../shared/theme-gallery';
import { derivePalette, isHexColor, presetToSettings, resolveActivePresetInput } from '../../../shared/theme-colors';

describe('内置主题画廊', () => {
    it('至少提供 6 套主题，id 唯一', () => {
        expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(6);
        const ids = BUILTIN_THEMES.map(t => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('每套主题的浅/深三层都是合法 hex', () => {
        for (const theme of BUILTIN_THEMES) {
            expect(isGalleryThemeValid(theme), theme.id).toBe(true);
            for (const variant of [theme.light, theme.dark]) {
                expect(isHexColor(variant.base)).toBe(true);
                expect(isHexColor(variant.card)).toBe(true);
                expect(isHexColor(variant.accent)).toBe(true);
            }
        }
    });

    it('浅色基底亮、深色基底暗（保证主题模式与配色自洽）', () => {
        const lum = (hex: string) => {
            const body = hex.slice(1);
            const n = parseInt(body, 16);
            return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
        };
        for (const theme of BUILTIN_THEMES) {
            expect(lum(theme.light.base), `${theme.id} light`).toBeGreaterThan(0.8);
            expect(lum(theme.dark.base), `${theme.id} dark`).toBeLessThan(0.25);
        }
    });

    it('方案 id 可往返解析，且与用户方案命名空间隔离', () => {
        const id = builtinPresetId('celadon', 'dark');
        expect(id).toBe('builtin:celadon:dark');
        expect(parseBuiltinPresetId(id)).toEqual({ themeId: 'celadon', mode: 'dark' });
        expect(isBuiltinPresetId('theme-1699999999-abc')).toBe(false);
        expect(parseBuiltinPresetId('builtin:celadon:sepia')).toBeNull();
        expect(parseBuiltinPresetId('builtin:不存在:dark')).toBeNull();
        expect(parseBuiltinPresetId(undefined)).toBeNull();
    });

    it('应用后写入的 themeColors 能被三层派生直接消费', () => {
        const theme = BUILTIN_THEMES[0];
        for (const mode of ['light', 'dark'] as const) {
            const preset = galleryThemeToPreset(theme, mode);
            const { theme: themeMode, themeColors } = presetToSettings(preset);
            expect(themeMode).toBe(mode);
            expect(themeColors.activePresetId).toBe(preset.id);

            const input = resolveActivePresetInput(themeColors, []);
            const palette = derivePalette(input, { appBg: '#000000', accent: '#000000' });
            const variant = mode === 'dark' ? theme.dark : theme.light;
            expect(palette.appBg).toBe(variant.base);
            expect(palette.cardBg).toBe(variant.card);
            expect(palette.accent).toBe(variant.accent);
        }
    });

    it('activeBuiltinTheme 只认内置 id，用户方案返回 null', () => {
        expect(activeBuiltinTheme(builtinPresetId('pine', 'light'))).toEqual({ themeId: 'pine', mode: 'light' });
        expect(activeBuiltinTheme('theme-abc')).toBeNull();
        expect(activeBuiltinTheme(undefined)).toBeNull();
    });
});
