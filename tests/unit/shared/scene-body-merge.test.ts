import { describe, expect, it } from 'vitest';
import { mergeSceneBodies } from '../../../shared/scene-body-merge';

describe('mergeSceneBodies', () => {
    it('按场景顺序拼接，场景之间空一行', () => {
        const merged = mergeSceneBodies([
            { body: '场景一第一段。\n场景一第二段。' },
            { body: '场景二第一段。' },
        ]);
        expect(merged).toBe('场景一第一段。\n场景一第二段。\n\n场景二第一段。');
    });

    it('丢弃空场景，不在正文中留下连续空行', () => {
        const merged = mergeSceneBodies([
            { body: '   ' },
            { body: '保留的场景。' },
            { body: '' },
        ]);
        expect(merged).toBe('保留的场景。');
    });

    it('全部为空时返回空串', () => {
        expect(mergeSceneBodies([])).toBe('');
        expect(mergeSceneBodies([{ body: '\n' }, { body: '  ' }])).toBe('');
    });
});
