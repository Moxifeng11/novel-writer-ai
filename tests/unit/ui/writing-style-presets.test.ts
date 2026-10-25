import { describe, it, expect } from 'vitest';
import { App, TFile } from 'obsidian';
import { parseStylePreset, saveStylePreset, STYLE_PRESET_DIR, type StylePresetDraft } from '../../../ui/writing-style-presets';

const STYLE_RAW = `---
name: 测试风格
order: 3
description: 用于测试的预设
---

## 零、参考样本

### 战斗/冲突场景样本
样本 A

### 日常/对话场景样本
样本 B

## 一、叙事视角
第三人称限知。

## 二、文笔特征

### 总体风格
简洁克制。

### 句式特征
短句为主。

### 用语习惯
现代白话。

## 三、对话风格
对话推动剧情。

## 四、描写风格
描写从简。

## 五、叙事节奏
快节奏。

## 六、情感表达方式
克制。

## 七、禁用/慎用
禁用套话。

## 八、参考作品
参考成熟商业网文。

## 九、番茄小说格式要求
每段一次回车。
`;

describe('parseStylePreset（文笔风格预设解析）', () => {
    it('解析 frontmatter、顶层章节与文笔特征子章节', () => {
        const preset = parseStylePreset('02-测试风格', STYLE_RAW);

        expect(preset.id).toBe('02-测试风格');
        expect(preset.name).toBe('测试风格');
        expect(preset.description).toBe('用于测试的预设');
        expect(preset.order).toBe(3);

        expect(preset.sections['一、叙事视角']).toBe('第三人称限知。');
        expect(preset.sections['总体风格']).toBe('简洁克制。');
        expect(preset.sections['句式特征']).toBe('短句为主。');
        expect(preset.sections['用语习惯']).toBe('现代白话。');
        expect(preset.sections['三、对话风格']).toBe('对话推动剧情。');
        expect(preset.sections['九、番茄小说格式要求']).toBe('每段一次回车。');
    });

    it('参考样本整段保留，供模态填入 sample 输入框', () => {
        const preset = parseStylePreset('02-测试风格', STYLE_RAW);
        expect(preset.reference).toContain('### 战斗/冲突场景样本');
        expect(preset.reference).toContain('样本 A');
        expect(preset.reference).toContain('样本 B');
    });

    it('缺少 frontmatter 时以文件名兜底，排序值置底', () => {
        const preset = parseStylePreset('05-自定义风格', '## 一、叙事视角\n第一人称。');
        expect(preset.name).toBe('自定义风格');
        expect(preset.order).toBe(999);
        expect(preset.sections['一、叙事视角']).toBe('第一人称。');
        expect(preset.reference).toBe('');
    });
});

/** 完整预设草稿：9 个一级分节 + 「二、文笔特征」3 个子节 */
function completeDraft(name: string): StylePresetDraft {
    return {
        name,
        description: '测试用完整预设',
        sections: {
            '一、叙事视角': '第三人称限知。',
            '总体风格': '简洁克制。',
            '句式特征': '短句为主。',
            '用语习惯': '现代白话。',
            '三、对话风格': '对话推动剧情。',
            '四、描写风格': '描写从简。',
            '五、叙事节奏': '快节奏。',
            '六、情感表达方式': '克制。',
            '七、禁用/慎用': '禁用套话。',
            '八、参考作品': '参考成熟商业网文。',
            '九、番茄小说格式要求': '每段一次回车。',
        },
    };
}

describe('saveStylePreset（新增预设落盘门禁）', () => {
    it('内容不完整时拒绝落盘，并提示缺失分节', async () => {
        const app = new App();
        const incomplete: StylePresetDraft = {
            name: '空预设',
            sections: { '一、叙事视角': '第三人称。' },
        };

        await expect(saveStylePreset(app, incomplete)).rejects.toThrow(/预设内容不完整/);

        const created = app.vault.getFiles().filter(f => f.path.startsWith(`${STYLE_PRESET_DIR}/`));
        expect(created).toHaveLength(0);
    });

    it('内容完整时写入预设目录，且可被 parseStylePreset 还原', async () => {
        const app = new App();
        const path = await saveStylePreset(app, completeDraft('冷硬派刑侦'));

        expect(path.startsWith(`${STYLE_PRESET_DIR}/`)).toBe(true);
        expect(path.endsWith('.md')).toBe(true);

        const file = app.vault.getAbstractFileByPath(path);
        expect(file).toBeInstanceOf(TFile);
        const raw = await app.vault.read(file as TFile);
        const parsed = parseStylePreset(path.split('/').pop()!.replace(/\.md$/, ''), raw);

        expect(parsed.name).toBe('冷硬派刑侦');
        expect(parsed.sections['一、叙事视角']).toBe('第三人称限知。');
        expect(parsed.sections['句式特征']).toBe('短句为主。');
        expect(parsed.sections['九、番茄小说格式要求']).toBe('每段一次回车。');
    });

    it('同名预设拒绝覆盖', async () => {
        const app = new App();
        await saveStylePreset(app, completeDraft('同名风格'));

        await expect(saveStylePreset(app, completeDraft('同名风格'))).rejects.toThrow(/已存在同名预设/);
    });
});
