import { describe, it, expect } from 'vitest';
import { buildContextPack, createContextFragment, hasRequiredFragment } from '../../../engine/harness/context-pack';

describe('ContextPack', () => {
    it('required 片段不被预算裁剪', () => {
        const pack = buildContextPack({
            projectId: 'p',
            mode: 'long',
            taskId: 'body',
            maxChars: 1200,
            fragments: [
                createContextFragment({ id: 'r', kind: 'rule', title: '硬规则', content: '必须遵守'.repeat(50), priority: 1, scope: 'project', source: 'rule', verified: true, required: true }),
                createContextFragment({ id: 'a', kind: 'character', title: '人物', content: '甲'.repeat(600), priority: 100, scope: 'project', source: 'vault', verified: true }),
                createContextFragment({ id: 'b', kind: 'worldview', title: '世界观', content: '乙'.repeat(600), priority: 90, scope: 'project', source: 'vault', verified: true }),
            ],
        });
        expect(pack.fragments.some(f => f.id === 'r')).toBe(true);
        expect(hasRequiredFragment(pack, 'rule')).toBe(true);
        expect(pack.fragments.length).toBeLessThan(3);
        expect(pack.dropped.length).toBeGreaterThan(0);
        expect(pack.dropped.every(item => item.reason === 'budget')).toBe(true);
    });

    it('required 总量超预算时抛错，不静默丢失', () => {
        expect(() => buildContextPack({
            projectId: 'p',
            mode: 'short',
            taskId: 'section',
            maxChars: 1000,
            fragments: [
                createContextFragment({ id: 'r1', kind: 'section-outline', title: '大纲', content: '甲'.repeat(800), priority: 1, scope: 'section', source: 'vault', verified: true, required: true }),
                createContextFragment({ id: 'r2', kind: 'rule', title: '规则', content: '乙'.repeat(800), priority: 1, scope: 'project', source: 'rule', verified: true, required: true }),
            ],
        })).toThrow(/required/);
    });

    it('去重空片段并生成 hash', () => {
        const pack = buildContextPack({
            projectId: 'p',
            mode: 'script',
            taskId: 'scene',
            fragments: [
                createContextFragment({ id: 'a', kind: 'scene-bible', title: '场景', content: '客厅', priority: 10, scope: 'scene', source: 'vault', verified: true }),
                createContextFragment({ id: 'b', kind: 'scene-bible', title: '场景', content: '客厅', priority: 10, scope: 'scene', source: 'vault', verified: true }),
                createContextFragment({ id: 'c', kind: 'character', title: '人物', content: '', priority: 10, scope: 'scene', source: 'vault', verified: true }),
            ],
        });
        expect(pack.fragments).toHaveLength(1);
        expect(pack.dropped.some(item => item.reason === 'duplicate')).toBe(true);
        expect(pack.dropped.some(item => item.reason === 'empty')).toBe(true);
        expect(pack.hash).toMatch(/^cp_[0-9a-f]{8}$/);
        expect(pack.promptText).toContain('【场景】');
    });

    it('按 priority 选择片段', () => {
        const pack = buildContextPack({
            projectId: 'p',
            mode: 'short',
            taskId: 'outline',
            maxChars: 1000,
            fragments: [
                createContextFragment({ id: 'low', kind: 'research', title: '低', content: '低'.repeat(600), priority: 1, scope: 'project', source: 'rag', verified: true }),
                createContextFragment({ id: 'high', kind: 'section-outline', title: '高', content: '高'.repeat(600), priority: 100, scope: 'section', source: 'vault', verified: true }),
            ],
        });
        expect(pack.fragments.map(f => f.id)).toEqual(['high']);
    });
});