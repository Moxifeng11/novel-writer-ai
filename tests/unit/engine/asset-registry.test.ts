import { describe, expect, it } from 'vitest';
import { Vault } from '../../__mocks__/obsidian';
import { collectAssetRegistry } from '../../../engine/asset-registry';
import type { StyleFingerprint } from '../../../engine/style-fingerprint-library';

function fingerprint(id: string, name: string, scope: 'project' | 'global', enabled: boolean): StyleFingerprint {
    return {
        id,
        name,
        source: 'test',
        scope,
        enabled,
        tags: [],
        features: {
            sentenceRhythm: '短句为主',
            wordPreference: '口语',
            narrativeStyle: '贴身视角',
            rhetoric: '少修辞',
            dialogueStyle: '短对白',
            paragraphStructure: '短段',
            overallTone: '克制',
        },
        samples: [],
        extractedAt: Date.parse('2026-11-05T00:00:00Z'),
    } as unknown as StyleFingerprint;
}

function fakeLibrary(): {
    getEnabledFingerprints(project?: string): Promise<StyleFingerprint[]>;
    listProject(): Promise<StyleFingerprint[]>;
    listGlobal(): Promise<StyleFingerprint[]>;
} {
    const project = [fingerprint('fp_p1', '项目指纹', 'project', true)];
    const global = [fingerprint('fp_g1', '全局指纹', 'global', true), fingerprint('fp_g2', '全局停用', 'global', false)];
    return {
        async getEnabledFingerprints() { return [...project, global[0]]; },
        async listProject() { return project; },
        async listGlobal() { return global; },
    };
}

describe('collectAssetRegistry — 资产总览', () => {
    it('列出规则/模板/指纹/知识库并标注生效状态', async () => {
        const vault = new Vault();
        vault._seedFile('元文件/00-系统模板/写作规则.md', '---\nversion: "4.0.0"\n---\n\n# 写作规则\n\n单一镜头。\n');
        vault._seedFile('元文件/00-系统模板/prompts/infoPlan-system.md', '# 自定义信息规划\n');
        const app = { vault } as never;

        const report = await collectAssetRegistry(app, '长篇小说/甲', {
            fingerprintLibrary: fakeLibrary() as never,
            knowledgeBaseManager: {
                async getAllBooks() {
                    return [
                        { id: 'kb_1', name: '参考书A', updatedAt: Date.parse('2026-11-05T00:00:00Z'), breakdownStatus: 'completed', primaryGenre: '都市' },
                        { id: 'kb_2', name: '参考书B', updatedAt: Date.parse('2026-11-05T00:00:00Z'), breakdownStatus: 'pending' },
                    ];
                },
            },
            promptManager: {
                getAllTemplates: () => [{ id: 'pt_1', name: '自定义开场', versions: [{ version: 'v2', isActive: true }] }],
            },
        });

        expect(report.summary.rules).toBeGreaterThanOrEqual(1);
        expect(report.summary['prompt-template']).toBeGreaterThanOrEqual(2);
        expect(report.summary['style-fingerprint']).toBe(3);
        expect(report.summary['knowledge-book']).toBe(2);

        const rules = report.entries.find(entry => entry.kind === 'rules' && entry.enabled);
        expect(rules?.version).toBe('4.0.0');
        expect(rules?.source).toBe('vault');

        const infoPlan = report.entries.find(entry => entry.id === 'template:infoPlan');
        expect(infoPlan?.source).toBe('vault');

        const customPrompt = report.entries.find(entry => entry.id === 'prompt-manager:pt_1');
        expect(customPrompt?.version).toBe('v2');

        const disabledFp = report.entries.find(entry => entry.id === 'fp_g2');
        expect(disabledFp?.enabled).toBe(false);

        const readyBook = report.entries.find(entry => entry.id === 'kb_1');
        expect(readyBook?.enabled).toBe(true);
        expect(report.effective.some(line => line.includes('参考书A'))).toBe(true);
    });
});
