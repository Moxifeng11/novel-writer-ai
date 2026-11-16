/**
 * 场景细纲编解码测试（2026-11-16）
 */
import { describe, expect, it } from 'vitest';
import { createDefaultScene, type ExtendedSceneData } from '../../../shared/types';
import {
    appendScenesToContent,
    renumberScenes,
    serializeScene,
    serializeScenes,
} from '../../../ui/full-writer/scene-outline-format';

function scene(index: number, name: string): ExtendedSceneData {
    const base = createDefaultScene(index);
    return { ...base, name, objective: `目标${index}`, conflict: `冲突${index}` };
}

describe('serializeScene / serializeScenes', () => {
    it('输出场景标题与关键字段', () => {
        const text = serializeScene(scene(1, '开门'), true);
        expect(text).toContain('## 场景1：开门');
        expect(text).toContain('objective: 目标1');
        expect(text).toContain('conflict: 冲突1');
    });

    it('只有最后一个场景写 cliffhanger', () => {
        const scenes = [scene(1, 'a'), scene(2, 'b')];
        const text = serializeScenes(scenes);
        const parts = text.split('## 场景');
        expect(parts[1]).not.toContain('cliffhanger');
        expect(parts[2]).toContain('cliffhanger');
    });

    it('空数组输出空串', () => {
        expect(serializeScenes([])).toBe('');
    });

    it('每个场景段落以空行结尾', () => {
        const text = serializeScenes([scene(1, 'a')]);
        expect(text.endsWith('\n\n')).toBe(true);
    });
});

describe('renumberScenes', () => {
    it('从指定序号往后接排', () => {
        const renamed = renumberScenes([scene(1, 'a'), scene(2, 'b')], 3);
        expect(renamed.map(item => item.index)).toEqual([4, 5]);
    });

    it('不修改入参', () => {
        const input = [scene(1, 'a')];
        renumberScenes(input, 10);
        expect(input[0].index).toBe(1);
    });
});

describe('appendScenesToContent', () => {
    it('目标为空时从 1 开始', () => {
        const text = appendScenesToContent('', 0, [scene(5, 'copied')]);
        expect(text).toContain('## 场景1：copied');
    });

    it('目标已有场景时接着排', () => {
        const text = appendScenesToContent('## 场景1：已有\n\n', 1, [scene(9, 'copied')]);
        expect(text).toContain('## 场景1：已有');
        expect(text).toContain('## 场景2：copied');
    });

    it('追加空数组返回原内容', () => {
        expect(appendScenesToContent('原文', 1, [])).toBe('原文');
    });
});
