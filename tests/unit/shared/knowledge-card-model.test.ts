import { describe, expect, it } from 'vitest';
import {
    parseKnowledgeEntries, renderKnowledgeCard, renderSettingLib, renderWorldview,
} from '@/shared/knowledge-card-model';

const WORLDVIEW = `# 世界观总览

## 灵气体系

灵气分九品。

## 地理

东荒、南岭、西漠。

## 宗门格局

一宗三阁七派。
`;

describe('parseKnowledgeEntries', () => {
    it('按 H2 拆条目', () => {
        const cards = parseKnowledgeEntries(WORLDVIEW, 'WLD');
        expect(cards).toHaveLength(3);
        expect(cards[0].title).toBe('灵气体系');
        expect(cards[0].content).toContain('九品');
        expect(cards[0].id).toBe('TMP-WLD-1');
    });

    it('无 H2 时返回单条或空', () => {
        expect(parseKnowledgeEntries('普通文本', 'SET')).toEqual([]);
    });

    it('空小节也保留标题', () => {
        const cards = parseKnowledgeEntries('## 空节\n\n## 有内容\n文本', 'SET');
        expect(cards).toHaveLength(2);
        expect(cards[0].title).toBe('空节');
    });
});

describe('渲染', () => {
    it('派生视图可往返解析', () => {
        const cards = parseKnowledgeEntries(WORLDVIEW, 'WLD');
        const rendered = renderWorldview(cards);
        expect(rendered).toContain('请勿手改');
        expect(parseKnowledgeEntries(rendered, 'WLD')).toHaveLength(3);
    });

    it('设定库渲染', () => {
        const rendered = renderSettingLib(parseKnowledgeEntries('## 货币\n灵石', 'SET'));
        expect(rendered).toContain('# 设定库');
        expect(rendered).toContain('货币');
    });

    it('条目卡含 frontmatter', () => {
        const card = parseKnowledgeEntries('## 灵气体系\n九品', 'WLD')[0];
        const file = renderKnowledgeCard(card, { id: 'WLD-0001', type: 'worldview', tags: '[nw/设定/世界观]' });
        expect(file).toContain('id: WLD-0001');
        expect(file).toContain('type: worldview');
        expect(file).toContain('# 灵气体系');
    });
});
