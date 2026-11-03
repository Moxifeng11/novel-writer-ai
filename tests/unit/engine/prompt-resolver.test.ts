import { describe, expect, it } from 'vitest';
import { TFile, type App } from 'obsidian';
import { renderTemplate, resolveStepPrompt } from '@/engine/prompt-resolver';

function appWithFiles(files: Record<string, string>): App {
    return {
        vault: {
            getAbstractFileByPath: (path: string) => (path in files ? Object.assign(new TFile(), { path }) : null),
            read: async (file: { path: string }) => files[file.path],
        },
    } as unknown as App;
}

describe('renderTemplate', () => {
    it('同时支持 ${var} 与 {{var}}', () => {
        const result = renderTemplate('第${chapNum}章《{{name}}》', { chapNum: '3', name: '风起' });
        expect(result.text).toBe('第3章《风起》');
        expect(result.unresolved).toEqual([]);
    });

    it('未提供的变量保留并登记，不静默吞掉', () => {
        const result = renderTemplate('${missing} 与 {{alsoMissing}}', {});
        expect(result.text).toContain('${missing}');
        expect(result.text).toContain('{{alsoMissing}}');
        expect(result.unresolved).toEqual(['missing', 'alsoMissing']);
    });
});

describe('resolveStepPrompt — 单一优先级', () => {
    it('vault 自定义优先于用户覆盖与内置', async () => {
        const app = appWithFiles({
            '元文件/00-系统模板/prompts/infoPlan-system.md': 'VAULT SYSTEM ${chapNum}',
            '元文件/00-系统模板/prompts/infoPlan-user.md': 'VAULT USER',
        });
        const result = await resolveStepPrompt(app, 'infoPlan', {
            chapNum: '3',
            _stepOverrides: JSON.stringify({ infoPlan: { system: 'OVERRIDE', user: 'OVERRIDE' } }),
        });
        expect(result?.source).toBe('vault');
        expect(result?.systemPrompt).toBe('VAULT SYSTEM 3');
        expect(result?.userPrompt).toBe('VAULT USER');
        expect(result?.templateId).toBe('vault:infoPlan');
    });

    it('用户覆盖支持只改 system 或只改 user', async () => {
        const app = appWithFiles({});
        const result = await resolveStepPrompt(app, 'infoPlan', {
            chapNum: '3',
            _stepOverrides: JSON.stringify({ infoPlan: { system: 'ONLY SYSTEM' } }),
        });
        expect(result?.source).toBe('user-override');
        expect(result?.systemPrompt).toBe('ONLY SYSTEM');
        expect(result?.userPrompt).toBeTruthy();
        expect(result?.templateId).toBe('infoPlan.v1');
    });

    it('无任何覆盖时回退内置，并返回实际正文变体元数据', async () => {
        const app = appWithFiles({});
        const result = await resolveStepPrompt(app, 'bodyGeneration', {
            chapNum: '3',
            _bodyVariant: 'v3',
        });
        expect(result?.source).toBe('builtin');
        expect(result?.templateId).toBe('bodyGeneration.v3');
        expect(result?.templateVersion).toBe('3.0.0');
        expect(result?.templateHash).toBeTruthy();
    });
});
