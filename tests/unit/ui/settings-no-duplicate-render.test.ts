import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('规则版本：重新检查不得重复渲染模块', () => {
    it('RulesSection.render 只在传入容器上创建一次 section，并委托给 mountRulesSection', () => {
        const source = read('ui/settings/general-sections.ts');
        const fnIndex = source.indexOf('export class RulesSection');
        expect(fnIndex).toBeGreaterThan(-1);
        // 只截到 mountRulesSection 定义前，避免把挂载函数内部的 createEl 算进 render 范围
        const body = source.slice(fnIndex, source.indexOf('private async mountRulesSection(', fnIndex));

        // 只创建一个 section，且立刻交给挂载函数
        expect(body).toContain("container.createEl('section')");
        expect(body).toContain('this.mountRulesSection(section)');
        // 不得在 renderRulesSection 里直接建内容（那会绕过清空逻辑）
        expect(body).not.toContain("createEl('h3'");
    });

    it('「重新检查」只重绘本容器，不调用 renderRulesSection', () => {
        const source = read('ui/settings/general-sections.ts');
        const refreshIndex = source.indexOf("'🔄 重新检查'");
        expect(refreshIndex).toBeGreaterThan(-1);

        // 找到该按钮后面的 addEventListener 回调
        const tail = source.slice(refreshIndex, refreshIndex + 800);
        expect(tail).toContain('this.mountRulesSection(section)');
        // 回归点：旧实现调用 renderRulesSection()，每次点击追加一整块新模块
        expect(tail).not.toContain('this.renderRulesSection()');
    });

    it('mountRulesSection 开头清空容器，保证幂等', () => {
        const source = read('ui/settings/general-sections.ts');
        const fnIndex = source.indexOf('private async mountRulesSection(');
        expect(fnIndex).toBeGreaterThan(-1);
        const body = source.slice(fnIndex, fnIndex + 300);
        expect(body).toMatch(/section\.empty\(\)/);
    });

    it('整个设置页不存在「事件回调里自调用 render*Section」的写法', () => {
        const source = read('ui/settings-tab.ts');
        const lines = source.split('\n');
        const offenders: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!/addEventListener\(|\.onclick\s*=/.test(line)) continue;
            const window = lines.slice(i, i + 6).join('\n');
            const matches = window.match(/this\.(render\w+Section)\s*\(/g);
            if (matches) offenders.push(`行${i + 1}: ${matches.join(', ')}`);
        }
        expect(offenders).toEqual([]);
    });
});

describe('设置页每个 render*Section 都创建自己的根容器', () => {
    it('所有 section 渲染方法都从 tabContent 起一个 section', () => {
        const source = read('ui/settings-tab.ts');
        const lines = source.split('\n');
        const missing: string[] = [];

        let currentName: string | null = null;
        let buffer: string[] = [];
        const flush = () => {
            if (!currentName) return;
            const body = buffer.join('\n');
            if (!/this\.tabContent\.createEl\('section'\)/.test(body)) {
                missing.push(currentName);
            }
            currentName = null;
            buffer = [];
        };

        for (const line of lines) {
            const m = line.match(/^\s{4}(?:private |public )?(?:async )?(render\w+Section)\s*\(/);
            if (m) {
                flush();
                currentName = m[1];
                buffer = [line];
                continue;
            }
            // 遇到下一个同级方法边界就收尾
            if (currentName && /^\s{4}(?:private |public )?(?:async )?\w+\s*\(/.test(line)) {
                flush();
                continue;
            }
            if (currentName) buffer.push(line);
        }
        flush();

        expect(missing).toEqual([]);
    });
});

describe('外观设置：三层模型结构', () => {
    it('只暴露三层颜色控件（基底/卡片/强调），不再有独立面板色', () => {
        const source = read('ui/appearance-settings.ts');
        expect(source).toContain("'基底色'");
        expect(source).toContain("'卡片色'");
        expect(source).toContain("'强调色'");
        // 旧的独立面板色输入与卡片开关已从 UI 移除
        expect(source).not.toContain("'面板色'");
        expect(source).not.toContain("'启用自定义卡片背景'");
    });

    it('第 4 个取色器「覆盖文字色」已彻底移除', () => {
        const source = read('ui/appearance-settings.ts');
        expect(source).not.toContain('覆盖文字色');
        // 且不再从 UI 写 textPrimary —— 否则三层又被撑回四层
        expect(source).not.toMatch(/themeColors\.textPrimary\s*=/);
        expect(source).not.toMatch(/ensureThemeColors\(\)\.textPrimary\s*=/);
    });

    it('恰好 3 个 addColorPicker（严格三层）', () => {
        const source = read('ui/appearance-settings.ts');
        const pickers = source.match(/\.addColorPicker\(/g) ?? [];
        expect(pickers).toHaveLength(3);
    });

    it('预览色板是三层（基底/卡片/强调）', () => {
        const source = read('ui/appearance-settings.ts');
        expect(source).toContain("nw-theme-preview-swatch-app' }).createSpan({ text: '基底'");
        expect(source).toContain("nw-theme-preview-swatch-card' }).createSpan({ text: '卡片'");
        expect(source).toContain("nw-theme-preview-swatch-accent' }).createSpan({ text: '强调'");
    });

    it('提供配色方案的保存/应用/删除/导入/导出入口', () => {
        const source = read('ui/appearance-settings.ts');
        expect(source).toContain('保存当前配色');
        expect(source).toContain('导出');
        expect(source).toContain('导入');
        expect(source).toContain('presetToSettings');
        expect(source).toContain('capturePreset');
    });

    it('ThemeManager 走三层派生而不是手写 if 链', () => {
        const source = read('core/theme-manager.ts');
        expect(source).toContain('derivePalette');
        expect(source).toContain('paletteToCssVars');
        // 旧的四段 if 拼变量应已消失
        expect(source).not.toContain('tc.enableCustomCardBg && tc.cardBg');
    });
});
