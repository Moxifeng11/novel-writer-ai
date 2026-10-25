import { describe, it, expect } from 'vitest';
import { App, TFile } from 'obsidian';
import { validateWizardStepContent } from '../../../ui/full-writer/wizard-step-validators';
import { SL_SECTIONS } from '../../../shared/format-constants';
import { WRITING_STYLE_REQUIRED_SECTIONS } from '../../../shared/template-validator';

interface SeedableVault {
    _seedFile(path: string, content: string): TFile;
}

function seed(app: App, path: string, content: string): void {
    (app.vault as unknown as SeedableVault)._seedFile(path, content);
}

const PROJECT = '测试项目';

const settingLibSample = SL_SECTIONS
    .map(section => `## ${section}\n- 这是「${section}」的具体内容。`)
    .join('\n\n');

const writingStyleSample = WRITING_STYLE_REQUIRED_SECTIONS
    .map(section => {
        if (section === '二、文笔特征') {
            return `## ${section}\n### 总体风格\n冷峻克制\n### 句式特征\n长短句交替\n### 用语习惯\n少用成语`;
        }
        return `## ${section}\n这里是「${section}」的具体要求。`;
    })
    .join('\n\n');

describe('validateWizardStepContent', () => {
    it('设定库文件缺失时阻止前进', async () => {
        const app = new App();
        const result = await validateWizardStepContent(app, PROJECT, 'setting_lib');
        expect(result.valid).toBe(false);
        expect(result.missingFields[0]).toContain('设定库文件不存在');
    });

    it('设定库内容完整时通过', async () => {
        const app = new App();
        seed(app, `${PROJECT}/01-世界架构/设定库.md`, settingLibSample);
        const result = await validateWizardStepContent(app, PROJECT, 'setting_lib');
        expect(result.valid).toBe(true);
        expect(result.missingFields).toEqual([]);
    });

    it('设定库分节为空时阻止前进', async () => {
        const app = new App();
        const broken = settingLibSample.replace(
            `## ${SL_SECTIONS[1]}\n- 这是「${SL_SECTIONS[1]}」的具体内容。`,
            `## ${SL_SECTIONS[1]}`
        );
        seed(app, `${PROJECT}/01-世界架构/设定库.md`, broken);
        const result = await validateWizardStepContent(app, PROJECT, 'setting_lib');
        expect(result.valid).toBe(false);
        expect(result.missingFields.some(f => f.includes(SL_SECTIONS[1]))).toBe(true);
    });

    it('文笔风格文件完整时通过', async () => {
        const app = new App();
        seed(app, `${PROJECT}/01-世界架构/文笔风格.md`, writingStyleSample);
        const result = await validateWizardStepContent(app, PROJECT, 'writing_style');
        expect(result.valid).toBe(true);
    });

    it('世界观文件为空时阻止前进', async () => {
        const app = new App();
        seed(app, `${PROJECT}/01-世界架构/世界观总览.md`, '   ');
        const result = await validateWizardStepContent(app, PROJECT, 'worldview');
        expect(result.valid).toBe(false);
    });

    it('章节文件缺失时阻止进入写作', async () => {
        const app = new App();
        const result = await validateWizardStepContent(app, PROJECT, 'chapters');
        expect(result.valid).toBe(false);
        expect(result.missingFields[0]).toContain('尚未创建任何章节');
    });

    it('章节文件有正文时通过', async () => {
        const app = new App();
        seed(app, `${PROJECT}/03-大纲与章节/正文/第1卷/第1章 试炼_正文.md`, '# 第1章\n\n正文内容。');
        const result = await validateWizardStepContent(app, PROJECT, 'chapters');
        expect(result.valid).toBe(true);
    });

    it('无需校验的步骤（如实体）直接通过', async () => {
        const app = new App();
        const result = await validateWizardStepContent(app, PROJECT, 'entities');
        expect(result.valid).toBe(true);
    });

    it('同人步骤：.project 未记录同人设定路径时阻止前进', async () => {
        const app = new App();
        seed(app, `${PROJECT}/.project`, '# 测试项目\n\n## 类型\nfanfic\n');
        const result = await validateWizardStepContent(app, PROJECT, 'fanfic');
        expect(result.valid).toBe(false);
        expect(result.missingFields[0]).toContain('尚未保存同人设定');
    });

    it('同人步骤：路径已记录但文件缺失时阻止前进', async () => {
        const app = new App();
        seed(app, `${PROJECT}/.project`, `# 测试项目\n\n## 类型\nfanfic\n\n## 同人设定路径\n${PROJECT}/05-同人设定库/缺失设定.md\n`);
        const result = await validateWizardStepContent(app, PROJECT, 'fanfic');
        expect(result.valid).toBe(false);
        expect(result.missingFields[0]).toContain('同人设定文件不存在');
    });

    it('同人步骤：设定内容完整时通过', async () => {
        const app = new App();
        const fanficPath = `${PROJECT}/05-同人设定库/测试同人设定.md`;
        seed(app, `${PROJECT}/.project`, `# 测试项目\n\n## 类型\nfanfic\n\n## 同人设定路径\n${fanficPath}\n`);
        seed(app, fanficPath, `---
作品名称: 测试同人
作品类型: 同人
作者: 某人
---

## 原作核心设定
- **世界观类型**：都市异能
- **力量体系**：灵气
- **核心规则**：历史主线不可改

## 创作规则
- **必须遵守的原作规则**：主线事件不变
- **允许改编的范围**：支线人物关系
- **禁止触及的红线**：主要角色死亡

## 原作剧情时间线
| 时间节点 | 原作事件 | 涉及人物 | 章节参考 | 你的同人如何切入 |
|---|---|---|---|---|
| 开篇 | 主角觉醒 | 主角 | 第1章 | 提前相遇 |

## 故事背景时间线
| 你的时间节点 | 你的事件 | 对应原作时间 | 涉及人物 |
|---|---|---|---|
| 第一年 | 加入组织 | 开篇 | 主角、配角 |
`);
        const result = await validateWizardStepContent(app, PROJECT, 'fanfic');
        expect(result.valid).toBe(true);
        expect(result.missingFields).toEqual([]);
    });
});
