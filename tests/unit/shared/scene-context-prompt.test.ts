/**
 * M5：场景上下文提示词渲染测试
 */

import { describe, expect, it } from 'vitest';
import { addBatch, checkCoverage, createContextSession } from '@/shared/context-session-model';
import { renderSceneContextSection, sceneContextTokens } from '@/shared/scene-context-prompt';
import { parseSceneAnchors } from '@/shared/scene-anchor-model';

const scene = parseSceneAnchors('## 场景1：山门初见\n\n- 在场人物：林玄、苏婉')[0];

const item = (kind: 'entity' | 'relation' | 'foreshadow', id: string) => ({
    kind, id, title: id, text: `${id} 的正文内容`, tokens: 10,
});

describe('renderSceneContextSection', () => {
    it('空会话无场景无覆盖返回空串', () => {
        expect(renderSceneContextSection(createContextSession({}))).toBe('');
    });

    it('渲染场景头与已加载条目', () => {
        const session = addBatch(createContextSession({ sceneId: 'SC-1' }), {
            reason: 'anchor', items: [item('entity', 'CHR-0001'), item('entity', 'CHR-0002')],
        });
        const text = renderSceneContextSection(session, { scene });
        expect(text).toContain('场景1');
        expect(text).toContain('CHR-0001');
        expect(text).toContain('要素（2）');
    });

    it('覆盖缺口显式标注并提示 request_context', () => {
        const session = addBatch(createContextSession({}), { reason: 'anchor', items: [item('entity', 'CHR-0001')] });
        const coverage = checkCoverage(session, [{ kind: 'entity', ids: ['CHR-0001', 'CHR-0002'] }]);
        const text = renderSceneContextSection(session, { coverage });
        expect(text).toContain('覆盖缺口');
        expect(text).toContain('entity:CHR-0002');
        expect(text).toContain('request_context');
    });

    it('预算未加载显式标注', () => {
        const session = addBatch(createContextSession({ maxTokens: 500 }), {
            reason: 'anchor',
            items: Array.from({ length: 200 }, (_, i) => item('foreshadow', `FSH-${i}`)),
        });
        const text = renderSceneContextSection(session);
        expect(text).toContain('预算未加载');
    });

    it('按类别分组渲染', () => {
        const session = addBatch(createContextSession({}), {
            reason: 'anchor', items: [item('entity', 'CHR-0001'), item('foreshadow', 'FSH-0001')],
        });
        const text = renderSceneContextSection(session);
        expect(text).toContain('要素（1）');
        expect(text).toContain('伏笔（1）');
    });

    it('token 估算', () => {
        expect(sceneContextTokens('1234')).toBe(2);
    });
});
