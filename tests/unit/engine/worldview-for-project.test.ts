import { describe, it, expect, vi } from 'vitest';

// ai-worldview-generator 以值导入 main，运行时只需类型占位
vi.mock('../../../main', () => ({ default: class NovelWriterPlugin {} }));

import { App, TFile } from 'obsidian';
import { WorldviewGenerator } from '../../../engine/ai-worldview-generator';
import { WV_SECTIONS, WV_SECTION_FIELDS } from '../../../shared/format-constants';
import { pjWorldview } from '../../../shared/paths';

/**
 * 覆盖工作台真实调用链：WizardStepExecutors → AIEngine.generateWorldviewForProject
 * → WorldviewGenerator.generateWorldviewForProject → 瀑布式生成/校验/重试/落盘。
 *
 * 只 mock 网络层（AIApiClient.callAI），其余全部走真实实现。
 */

type ChatResult = { content: string; error?: string };

function sectionBody(name: string): string {
    const fields = WV_SECTION_FIELDS[name] || [];
    if (fields.length === 0) {
        return [
            '### 远古',
            '- **关键事件**：天地初开',
            '### 近代',
            '- **关键事件**：宗门并起',
            '### 近期',
            '- **关键事件**：主角入门',
        ].join('\n');
    }
    return fields.map(f => `- **${f}**：${name}的${f}`).join('\n');
}

function fullWorldview(): string {
    return [
        '【项目名称】九霄逆脉行【/项目名称】',
        ...WV_SECTIONS.map(s => `## ${s}\n${sectionBody(s)}`),
    ].join('\n\n');
}

function skeleton(): string {
    return ['# 世界观总览', ...WV_SECTIONS.map(s => `## ${s}\n- **概要**：待细化`)].join('\n\n');
}

function createHarness(callAI: (system: string, user: string) => Promise<ChatResult>) {
    const app = new App();
    const templateService = {
        getCustomPrompt: vi.fn(async (_key: string, fallback: { system?: string; user?: string }) => ({
            system: fallback.system ?? '',
            user: fallback.user ?? '',
        })),
    };
    const plugin = {
        app,
        settings: { flashModel: 'test-flash', proModel: 'test-pro', maxOutput: 4096 },
        engineRegistry: {
            get: vi.fn(() => templateService),
            getOrNull: vi.fn(() => null),
        },
    };
    const apiClient = { callAI: vi.fn(callAI) };
    const generator = new WorldviewGenerator(plugin as any, apiClient as any);
    return { app, generator, apiClient };
}

describe('WorldviewGenerator.generateWorldviewForProject（真实工作路径）', () => {
    it('成功：瀑布式生成全部模块、回调进度并写入世界观文件', async () => {
        const { app, generator, apiClient } = createHarness(async (_system, user) => {
            const moduleMatch = user.match(/【目标模块】(.+)/);
            return { content: moduleMatch ? sectionBody(moduleMatch[1].trim()) : skeleton() };
        });

        const progress: string[] = [];
        const outcome = await generator.generateWorldviewForProject(
            app,
            '测试项目',
            '玄幻',
            (phase, module) => progress.push(module ? `${phase}:${module}` : phase)
        );

        expect(outcome.error).toBeUndefined();
        expect(outcome.content).toContain('## 力量体系');

        const file = app.vault.getAbstractFileByPath(pjWorldview('测试项目'));
        expect(file).toBeInstanceOf(TFile);
        const raw = await app.vault.read(file as TFile);
        expect(raw).toContain('世界名称: "测试项目"');
        expect(raw).toContain('## 力量体系');

        expect(progress[0]).toBe('skeleton');
        expect(progress.filter(p => p.startsWith('module:'))).toHaveLength(WV_SECTIONS.length);
        expect(apiClient.callAI).toHaveBeenCalledTimes(1 + WV_SECTIONS.length);
    });

    it('API 失败：返回真实错误原因，且不写入文件', async () => {
        const { app, generator } = createHarness(async () => ({
            content: '',
            error: 'HTTP 401: {"error":{"message":"Authentication Fails, Your api key is invalid"}}',
        }));

        const outcome = await generator.generateWorldviewForProject(app, '测试项目', '玄幻');

        expect(outcome.content).toBe('');
        expect(outcome.error).toContain('401');
        expect(outcome.error).toContain('Authentication Fails');
        expect(app.vault.getAbstractFileByPath(pjWorldview('测试项目'))).toBeNull();
    });

    it('校验失败：自动重试并在补齐字段后落盘', async () => {
        let call = 0;
        const { app, generator } = createHarness(async () => {
            call += 1;
            if (call <= 2) {
                return { content: '# 世界观总览\n\n## 世界层级体系\n- **层级数量**：1' };
            }
            return { content: fullWorldview() };
        });

        const outcome = await generator.generateWorldviewForProject(app, '测试项目', '玄幻');

        expect(outcome.error).toBeUndefined();
        expect(call).toBe(3);
        expect(outcome.content).toContain('## 与主线关联');
        expect(app.vault.getAbstractFileByPath(pjWorldview('测试项目'))).not.toBeNull();
    });

    it('已有世界观：保留原有 frontmatter 字段', async () => {
        const { app, generator } = createHarness(async (_system, user) => {
            const moduleMatch = user.match(/【目标模块】(.+)/);
            return { content: moduleMatch ? sectionBody(moduleMatch[1].trim()) : skeleton() };
        });

        const vault = app.vault as any;
        vault._seedFile(
            pjWorldview('测试项目'),
            '---\n世界名称: "旧名"\n项目名称: "旧项目"\n世界类型: 玄幻\n---\n\n旧内容'
        );

        const outcome = await generator.generateWorldviewForProject(app, '测试项目', '仙侠');

        expect(outcome.error).toBeUndefined();
        const raw = await vault.readByPath(pjWorldview('测试项目'));
        expect(raw).toContain('世界名称: "旧名"');
        expect(raw).toContain('世界类型: 玄幻');
        expect(raw).not.toContain('旧内容');
    });
});
