import { describe, it, expect } from 'vitest';
import {
    capturePreset,
    deriveAccentHover,
    derivePalette,
    deriveTextColors,
    hexToRgb,
    isDarkBackground,
    isHexColor,
    normalizePreset,
    normalizeThemePreset,
    paletteToCssVars,
    parsePresetImport,
    presetToSettings,
    resolveActivePresetInput,
    PRESET_STEPS,
    relativeLuminance,
    sanitizePresetName,
    THEME_PRESET_BYTES_MAX,
    THEME_PRESET_LIMIT,
    THEME_PRESET_NAME_MAX,
    upsertPreset,
    type ThemePreset,
} from '../../../shared/theme-colors';

const DEFAULTS = { appBg: '#1c1a1e', accent: '#C2410C' };

describe('三层配色：颜色工具', () => {
    it('识别合法 hex（3/6/8 位），拒绝其他格式', () => {
        expect(isHexColor('#fff')).toBe(true);
        expect(isHexColor('#1c1a1e')).toBe(true);
        expect(isHexColor('#1c1a1eff')).toBe(true);
        expect(isHexColor('1c1a1e')).toBe(false);
        expect(isHexColor('#12345')).toBe(false);
        expect(isHexColor('red')).toBe(false);
        expect(isHexColor('')).toBe(false);
        expect(isHexColor(undefined)).toBe(false);
    });

    it('hex → rgb，短写与 8 位都正确展开', () => {
        expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
        expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
        expect(hexToRgb('#C2410C')).toEqual([194, 65, 12]);
        expect(hexToRgb('#1c1a1eff')).toEqual([28, 26, 30]);
        expect(hexToRgb('nope')).toBeNull();
    });

    it('相对亮度：黑 0、白 1，中间值单调', () => {
        expect(relativeLuminance('#000000')).toBe(0);
        expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
        const dark = relativeLuminance('#1c1a1e')!;
        const light = relativeLuminance('#f0ebe4')!;
        expect(dark).toBeLessThan(light);
        expect(relativeLuminance('bad')).toBeNull();
    });

    it('深色/浅色背景判定', () => {
        expect(isDarkBackground('#1c1a1e')).toBe(true);
        expect(isDarkBackground('#f0ebe4')).toBe(false);
        expect(isDarkBackground('bad')).toBeNull();
    });

    it('文字色按背景亮度自动取深/浅', () => {
        const onDark = deriveTextColors('#1c1a1e');
        expect(onDark.textPrimary).toBe('#f0ece4');
        const onLight = deriveTextColors('#f0ebe4');
        expect(onLight.textPrimary).toBe('#3d3530');
    });

    it('非法背景不抛错，回退到主题变量', () => {
        const result = deriveTextColors('linear-gradient(red, blue)');
        expect(result.textPrimary).toContain('var(--nw-text-primary');
    });

    it('强调色 hover：深色背景提亮、浅色背景加深', () => {
        const onDark = deriveAccentHover('#808080', '#1c1a1e');
        const onLight = deriveAccentHover('#808080', '#f0ebe4');
        const parse = (value: string) => Number(value.match(/\d+/g)![1]);
        expect(parse(onDark)).toBeGreaterThan(128);
        expect(parse(onLight)).toBeLessThan(128);
    });

    it('非法强调色原样返回，不产生 rgb(NaN)', () => {
        expect(deriveAccentHover('not-a-color', '#1c1a1e')).toBe('not-a-color');
    });
});

describe('三层配色：palette 派生', () => {
    it('只给基底时，面板与卡片都用 color-mix 从基底派生', () => {
        const palette = derivePalette({ base: '#101010' }, DEFAULTS);
        expect(palette.appBg).toBe('#101010');
        expect(palette.panelBg).toContain('color-mix');
        expect(palette.panelBg).toContain('#101010');
        expect(palette.cardBg).toContain('color-mix');
    });

    it('给卡片色时覆盖 L2，面板仍派生', () => {
        const palette = derivePalette({ base: '#101010', card: '#202020' }, DEFAULTS);
        expect(palette.cardBg).toBe('#202020');
        expect(palette.panelBg).toContain('color-mix');
    });

    it('缺省基底时用主题默认值', () => {
        const palette = derivePalette({}, DEFAULTS);
        expect(palette.appBg).toBe(DEFAULTS.appBg);
        expect(palette.accent).toBe(DEFAULTS.accent);
    });

    it('氛围预设改变卡片抬升幅度', () => {
        const soft = derivePalette({ base: '#101010', preset: 'soft' }, DEFAULTS);
        const clear = derivePalette({ base: '#101010', preset: 'clear' }, DEFAULTS);
        expect(soft.cardBg).toContain(`${PRESET_STEPS.soft.card}%`);
        expect(clear.cardBg).toContain(`${PRESET_STEPS.clear.card}%`);
        expect(PRESET_STEPS.clear.card).toBeGreaterThan(PRESET_STEPS.soft.card);
    });

    it('旧配色方案可通过 legacyPanel 直通面板色（仅方案层，不进 themeColors）', () => {
        const palette = derivePalette({ base: '#101010', legacyPanel: '#303030' }, DEFAULTS);
        expect(palette.panelBg).toBe('#303030');
    });

    it('非法颜色被忽略，回落到默认值', () => {
        const palette = derivePalette({ base: 'javascript:alert(1)', card: 'red', accent: '#12' }, DEFAULTS);
        expect(palette.appBg).toBe(DEFAULTS.appBg);
        expect(palette.accent).toBe(DEFAULTS.accent);
        expect(palette.cardBg).toContain('color-mix');
    });

    it('显式文字色覆盖自动派生', () => {
        const palette = derivePalette({ base: '#101010', text: '#00ff00' }, DEFAULTS);
        expect(palette.textPrimary).toBe('#00ff00');
    });

    it('paletteToCssVars 输出三层变量，并把 surface 收敛到面板', () => {
        const palette = derivePalette({ base: '#101010', card: '#202020', accent: '#ff0000' }, DEFAULTS);
        const vars = paletteToCssVars(palette);
        expect(vars).toContain('--nw-app-bg: #101010;');
        expect(vars).toContain('--nw-card-bg: #202020;');
        expect(vars).toContain('--nw-accent: #ff0000;');
        // --nw-surface 是面板的语义别名，必须与面板同值，避免两套背景打架
        expect(vars).toContain(`--nw-surface: ${palette.panelBg};`);
    });

    it('hover 与封面 token 也由三层派生，不再依赖 Obsidian 变量', () => {
        const palette = derivePalette({ base: '#101010', card: '#202020', accent: '#ff0000' }, DEFAULTS);
        const vars = paletteToCssVars(palette);
        expect(vars).toContain('--nw-surface-hover: color-mix');
        expect(vars).toContain('--nw-card-bg-hover: color-mix');
        expect(vars).toContain('--nw-cover-bg: linear-gradient');
        expect(vars).not.toContain('var(--background-');
    });

    it('normalizePreset 容错', () => {
        expect(normalizePreset('clear')).toBe('clear');
        expect(normalizePreset('PAPER')).toBe('paper');
        expect(normalizePreset('weird')).toBe('soft');
        expect(normalizePreset(undefined)).toBe('soft');
    });
});

describe('配色方案：保存与切换', () => {
    it('capturePreset 只收集合法颜色', () => {
        const preset = capturePreset(
            { appBg: '#101010', cardBg: 'invalid', accent: '#ff0000', textPrimary: '#eeeeee', appearancePreset: 'paper' },
            'dark',
            '暖夜',
        );
        expect(preset.base).toBe('#101010');
        expect(preset.card).toBeUndefined();
        expect(preset.accent).toBe('#ff0000');
        expect(preset.text).toBe('#eeeeee');
        expect(preset.preset).toBe('paper');
        expect(preset.theme).toBe('dark');
        expect(preset.name).toBe('暖夜');
    });

    it('presetToSettings 只写三层 + 氛围 + 激活 id，不复活旧字段', () => {
        const preset: ThemePreset = {
            id: 'p1', name: '冷夜', createdAt: 1,
            base: '#0a0a0a', accent: '#00aaff', preset: 'clear', theme: 'dark',
            // 方案里带文字色与旧面板直通值，也不该被写进 themeColors
            text: '#eeeeee', legacyPanel: '#202020',
        };
        const result = presetToSettings(preset);
        expect(result.theme).toBe('dark');
        expect(result.themeColors).toEqual({
            appearancePreset: 'clear',
            activePresetId: 'p1',
            appBg: '#0a0a0a',
            accent: '#00aaff',
        });
        // 关键：五层旧字段一个都不许出现
        for (const key of ['cardBg', 'panelBg', 'textPrimary', 'enableCustomCardBg']) {
            expect(key in result.themeColors).toBe(false);
        }
    });

    it('presetToSettings 对缺省氛围回落 soft', () => {
        const result = presetToSettings({ id: 'x', name: 'n', createdAt: 1, theme: 'light' });
        expect(result.themeColors.appearancePreset).toBe('soft');
    });

    it('resolveActivePresetInput：激活方案补齐文字色与面板直通值', () => {
        const presets: ThemePreset[] = [{
            id: 'legacy', name: '旧配色', createdAt: 1,
            base: '#251818', accent: '#24ffe5', preset: 'paper',
            text: '#4af28a', legacyPanel: '#110d09',
        }];
        const input = resolveActivePresetInput(
            { appBg: '#251818', accent: '#24ffe5', appearancePreset: 'paper', activePresetId: 'legacy' },
            presets,
        );
        expect(input.text).toBe('#4af28a');
        expect(input.legacyPanel).toBe('#110d09');
    });

    it('resolveActivePresetInput：手动改过三层时以手改为准', () => {
        const presets: ThemePreset[] = [{
            id: 'legacy', name: '旧配色', createdAt: 1, base: '#111111', text: '#00ff00',
        }];
        const input = resolveActivePresetInput(
            { appBg: '#999999', appearancePreset: 'soft', activePresetId: 'legacy' },
            presets,
        );
        // 基底用 themeColors 的值，方案只补它没有的文字色
        expect(input.base).toBe('#999999');
    });

    it('resolveActivePresetInput：无激活方案时只用三层', () => {
        const input = resolveActivePresetInput({ appBg: '#101010' }, []);
        expect(input.legacyPanel).toBeUndefined();
        expect(input.text).toBeUndefined();
    });

    it('方案名清洗：空白折叠、超长截断、空值给默认名', () => {
        expect(sanitizePresetName('  暖   夜  ')).toBe('暖 夜');
        expect(sanitizePresetName('')).toBe('配色方案 1');
        expect(sanitizePresetName(undefined, 3)).toBe('配色方案 3');
        const long = 'A'.repeat(100);
        expect(sanitizePresetName(long).length).toBe(THEME_PRESET_NAME_MAX);
    });

    it('upsertPreset 同名覆盖而非堆积', () => {
        const a: ThemePreset = { id: 'a', name: '同名', createdAt: 1, base: '#111111' };
        const b: ThemePreset = { id: 'b', name: '同名', createdAt: 2, base: '#222222' };
        const list = upsertPreset([a], b);
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe('b');
    });

    it('upsertPreset 超上限时淘汰最旧', () => {
        let list: ThemePreset[] = [];
        for (let i = 0; i < THEME_PRESET_LIMIT + 5; i++) {
            list = upsertPreset(list, { id: `p${i}`, name: `n${i}`, createdAt: i + 1 });
        }
        expect(list).toHaveLength(THEME_PRESET_LIMIT);
        // 最旧的几个应被淘汰
        expect(list.some(item => item.id === 'p0')).toBe(false);
        expect(list.some(item => item.id === `p${THEME_PRESET_LIMIT + 4}`)).toBe(true);
    });

    it('normalizeThemePreset 拒绝非对象；超长输入只保留白名单字段', () => {
        expect(normalizeThemePreset(null)).toBeNull();
        expect(normalizeThemePreset('string')).toBeNull();
        // 实现按白名单重建对象，因此超长附加字段不会进入结果
        const huge = { name: 'x', base: '#123456', extra: 'y'.repeat(THEME_PRESET_BYTES_MAX) };
        const preset = normalizeThemePreset(huge);
        expect(preset).not.toBeNull();
        expect(preset).not.toHaveProperty('extra');
        expect(JSON.stringify(preset).length).toBeLessThan(200);
    });

    it('normalizeThemePreset 补齐缺省 id/时间，丢弃非法颜色', () => {
        const preset = normalizeThemePreset({ name: '测试', base: '#fff', accent: 'bad' });
        expect(preset?.id).toBeTruthy();
        expect(preset?.createdAt).toBeGreaterThan(0);
        expect(preset?.base).toBe('#fff');
        expect(preset?.accent).toBeUndefined();
    });
});

describe('配色方案：导入导出', () => {
    it('导入单套对象', () => {
        const imported = parsePresetImport(JSON.stringify({ name: '单套', base: '#101010' }));
        expect(imported).toHaveLength(1);
        expect(imported[0].name).toBe('单套');
    });

    it('导入数组', () => {
        const imported = parsePresetImport(JSON.stringify([
            { name: 'A', base: '#101010' },
            { name: 'B', base: '#202020' },
        ]));
        expect(imported).toHaveLength(2);
    });

    it('非法 JSON 返回空数组而不是抛错', () => {
        expect(parsePresetImport('{not json')).toEqual([]);
        expect(parsePresetImport('')).toEqual([]);
    });

    it('数组里混入非法项时只保留合法项', () => {
        const imported = parsePresetImport(JSON.stringify([
            { name: 'ok', base: '#101010' },
            null,
            'garbage',
        ]));
        expect(imported).toHaveLength(1);
        expect(imported[0].name).toBe('ok');
    });

    it('导入的 id 与本地冲突时换新 id，不覆盖原方案', () => {
        const existing: ThemePreset[] = [{ id: 'dup', name: '本地', createdAt: 1, base: '#111111' }];
        const imported = parsePresetImport(JSON.stringify({ id: 'dup', name: '外来', base: '#222222' }), existing);
        expect(imported).toHaveLength(1);
        expect(imported[0].id).not.toBe('dup');
    });
});
