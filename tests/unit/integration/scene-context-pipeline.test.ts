/**
 * 集成测试：M1 索引 → M5 场景上下文 → M6 断言 → M10 节奏 → M11 口吻
 *
 * 验证「按场景在场 ID 精确装配上下文」这条主链在真实数据形状下能串起来，
 * 且缺口/未加载/偏离都被显式表达（不静默截断）。
 */

import { describe, expect, it, vi } from 'vitest';
import { App, Vault } from 'obsidian';
import { ContextSessionService } from '@/services/context-session-service';
import { SceneContextService } from '@/services/scene-context-service';
import { buildAssertionConstraintPack, renderAssertionConstraintSection } from '@/services/assertion-context-service';
import { parseAssertions } from '@/shared/assertion-source-model';
import { parseEmotionIntensities } from '@/shared/emotion-plan-parse';
import { detectRhythmDeviations, renderRhythmReport } from '@/shared/rhythm-baseline-model';
import { renderVoiceSampleSection, selectVoiceSamples } from '@/shared/voice-sample-model';

const entries = [
    { id: 'CHR-0001', path: 'p/人物/CHR-0001_林玄.md', name: '林玄', type: 'character' as const, aliases: ['林玄'] },
    { id: 'CHR-0002', path: 'p/人物/CHR-0002_苏婉.md', name: '苏婉', type: 'character' as const, aliases: ['苏婉'] },
    { id: 'CHR-0009', path: 'p/人物/CHR-0009_路人.md', name: '路人', type: 'character' as const, aliases: ['路人'] },
];

const index = {
    ensure: vi.fn(async () => ({ version: 2, project: 'p', updatedAt: 0, entries: entries.map(e => ({ ...e, kind: 'other', size: 1, mtime: 1 })) })),
    query: vi.fn(async (_project: string, q: { ids?: string[] }) => {
        const ids = q.ids ?? [];
        return entries.filter(e => ids.includes(e.id)).map(e => ({ ...e, kind: 'other', size: 1, mtime: 1 }));
    }),
};

const makeService = () => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    for (const entry of entries) vault._seedFile(entry.path, `# ${entry.name}\n正文`);
    vault._seedFile('p/人物/CHR-0001_林玄.md', '---\n口吻样本: [老子不干]\n说话特征: [爱用老子]\n---\n# 林玄');
    const sessionService = new ContextSessionService(app, index as never);
    return { service: new SceneContextService(index as never, sessionService), app, vault };
};

const SCENE_TEXT = `## 场景1：山门初见

- 在场人物：林玄、苏婉
- 冲突：守门弟子阻拦

## 场景2：夜谈

- 在场人物：林玄
- 钩子：断剑异动
`;

describe('场景上下文主链', () => {
    it('场景1 精确装配在场实体，不注入路人', async () => {
        const { service } = makeService();
        const pack = await service.build('p', SCENE_TEXT, 1);
        expect(Object.keys(pack.session.loaded)).toEqual(
            expect.arrayContaining(['entity:CHR-0001', 'entity:CHR-0002']),
        );
        expect(Object.keys(pack.session.loaded)).not.toContain('entity:CHR-0009');
        expect(pack.assembly.coverage.missing).toEqual([]);
        expect(pack.section).toContain('场景1');
    });

    it('场景2 只装配林玄一人', async () => {
        const { service } = makeService();
        const pack = await service.build('p', SCENE_TEXT, 2);
        expect(Object.keys(pack.session.loaded)).toEqual(['entity:CHR-0001']);
    });

    it('断言按在场实体全量筛选并分批（不设条数）', async () => {
        const { service } = makeService();
        const pack = await service.build('p', SCENE_TEXT, 1);
        const anchorIds = pack.session.anchorIds;
        const raw = [
            { id: 'AST-1', text: '林玄左臂有伤', 涉及人物: 'CHR-0001', severity: 'high' },
            { id: 'AST-2', text: '苏婉怕水', 涉及人物: 'CHR-0002', severity: 'medium' },
            { id: 'AST-3', text: '路人是路人', 涉及人物: 'CHR-0009', severity: 'high' },
        ];
        const assertions = parseAssertions(raw);
        const assertionPack = buildAssertionConstraintPack(assertions, anchorIds);
        expect(assertionPack.relevant.map(a => a.id)).toEqual(['AST-1', 'AST-2']);
        const section = renderAssertionConstraintSection(assertionPack);
        expect(section).toContain('AST-1');
        expect(section).not.toContain('AST-3');
    });

    it('节奏偏离从情绪规划推导', () => {
        const text = '## 场景1：起\n- 强度：30\n\n## 场景2：承\n- 强度：31\n\n## 场景3：转\n- 强度：95\n';
        const scenes = parseEmotionIntensities(text);
        const report = renderRhythmReport(scenes, detectRhythmDeviations(scenes));
        expect(report).toContain('节奏判定');
        expect(report).toContain('平铺');
    });

    it('口吻样本只取在场角色', () => {
        const frontmatters: Record<string, Record<string, unknown> | undefined> = {
            'p/人物/CHR-0001_林玄.md': { 口吻样本: ['老子不干'], 说话特征: ['爱用老子'] },
            'p/人物/CHR-0002_苏婉.md': { 口吻样本: ['好的呢'] },
        };
        const samples = selectVoiceSamples(entries as never, frontmatters, ['CHR-0001']);
        const section = renderVoiceSampleSection(samples);
        expect(section).toContain('林玄');
        expect(section).not.toContain('苏婉');
    });
});
