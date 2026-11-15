/**
 * M5：场景上下文包编排测试
 */

import { describe, expect, it, vi } from 'vitest';
import { App, Vault } from 'obsidian';
import { ContextSessionService } from '@/services/context-session-service';
import { SceneContextService } from '@/services/scene-context-service';

const SCENE_TEXT = `## 场景1：山门初见

- 在场人物：林玄、苏婉
- 地点：青云宗山门
- 冲突：守门弟子阻拦

## 场景2：夜谈

- 在场人物：林玄
- 钩子：断剑异动
`;

const entries = [
    { id: 'CHR-0001', path: 'p/人物/CHR-0001_林玄.md', name: '林玄', type: 'character' as const, aliases: ['林玄'] },
    { id: 'CHR-0002', path: 'p/人物/CHR-0002_苏婉.md', name: '苏婉', type: 'character' as const, aliases: ['苏婉'] },
];

const makeIndex = () => ({
    ensure: vi.fn(async () => ({ version: 2, project: 'p', updatedAt: 0, entries: entries.map(entry => ({
        ...entry, kind: 'other', size: 1, mtime: 1,
    })) })),
    query: vi.fn(async (_project: string, query: { ids?: string[] }) => {
        const ids = query.ids ?? [];
        return entries.filter(entry => ids.includes(entry.id)).map(entry => ({
            ...entry, kind: 'other', size: 1, mtime: 1,
        }));
    }),
});

const makeService = () => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    for (const entry of entries) vault._seedFile(entry.path, `# ${entry.name}\n正文`);
    const index = makeIndex();
    const sessionService = new ContextSessionService(app, index as never);
    return new SceneContextService(index as never, sessionService);
};

describe('SceneContextService.build', () => {
    it('解析场景并装配在场实体', async () => {
        const service = makeService();
        const pack = await service.build('p', SCENE_TEXT, 1);
        expect(pack.scene?.index).toBe(1);
        expect(pack.sceneCount).toBe(2);
        expect(Object.keys(pack.session.loaded)).toContain('entity:CHR-0001');
        expect(pack.section).toContain('场景1');
        expect(pack.section).toContain('CHR-0001');
    });

    it('场景序号越界时取最后一个', async () => {
        const service = makeService();
        const pack = await service.build('p', SCENE_TEXT, 99);
        expect(pack.scene?.index).toBe(2);
    });

    it('无场景文本返回空包', async () => {
        const service = makeService();
        const pack = await service.build('p', '没有场景', 1);
        expect(pack.scene).toBeNull();
        expect(pack.section).toBe('');
    });

    it('未解析名称进入 unresolved（不猜）', async () => {
        const service = makeService();
        const pack = await service.build('p', '## 场景1：x\n\n- 在场人物：路人甲\n', 1);
        expect(pack.unresolved).toContain('路人甲');
        expect(Object.keys(pack.session.loaded)).toHaveLength(0);
    });

    it('覆盖缺口在段落中显式标注', async () => {
        const service = makeService();
        const pack = await service.build('p', SCENE_TEXT, 1);
        // 山门（地点）不在索引中 → 未解析，不产生缺口；在场人物应全部覆盖
        expect(pack.assembly.coverage.missing).toEqual([]);
    });
});
