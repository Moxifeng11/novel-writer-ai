import { describe, expect, it } from 'vitest';
import {
    planPropertyCompletionForFile,
    planTagMigrationForFile,
} from '../../../engine/note-properties-service';

describe('note-properties-service — 标签迁移计划', () => {
    it('旧标签缺层级标签时生成变更', () => {
        const plan = planTagMigrationForFile('长篇小说/甲/03-大纲与章节/正文/第1卷/第1章_正文.md', {
            tags: ['正文'],
        });
        expect(plan).not.toBeNull();
        expect(plan!.add).toEqual(['nw/正文']);
        expect(plan!.kind).toBe('body');
    });

    it('已含层级标签返回 null', () => {
        expect(planTagMigrationForFile('x.md', { tags: ['正文', 'nw/正文'] })).toBeNull();
    });

    it('无插件标签返回 null（不误改私人笔记）', () => {
        expect(planTagMigrationForFile('笔记/随便.md', { tags: ['我的标签'] })).toBeNull();
        expect(planTagMigrationForFile('x.md', {})).toBeNull();
    });

    it('实体/步骤文件分别映射', () => {
        const character = planTagMigrationForFile('p/01-世界架构/人物/武昭.md', { tags: ['人物'] });
        expect(character!.add).toEqual(['nw/实体/人物']);
        const step = planTagMigrationForFile('p/03-大纲与章节/步骤结果/第1卷/第1章/分析报告.md', { tags: ['分析报告'] });
        expect(step!.add).toEqual(['nw/步骤/分析报告']);
    });
});

describe('note-properties-service — 属性补齐计划', () => {
    it('正文缺 status/word_count 时给出默认值', () => {
        const plan = planPropertyCompletionForFile('长篇小说/甲/03-大纲与章节/正文/第1卷/第1章_正文.md', {
            tags: ['正文', 'nw/正文'],
            卷: '第1卷',
        });
        expect(plan).not.toBeNull();
        expect(plan!.fill).toEqual([
            { key: 'status', value: 'pending' },
            { key: 'word_count', value: 0 },
        ]);
    });

    it('必填齐全返回 null', () => {
        const plan = planPropertyCompletionForFile('长篇小说/甲/03-大纲与章节/正文/第1卷/第1章_正文.md', {
            tags: ['nw/正文'],
            status: 'written',
            word_count: 1200,
        });
        expect(plan).toBeNull();
    });

    it('人物文件缺姓名时补空串', () => {
        const plan = planPropertyCompletionForFile('p/01-世界架构/人物/武昭.md', { tags: ['人物'] });
        expect(plan!.fill).toEqual([{ key: '姓名', value: '' }]);
    });

    it('无法判定类型不处理', () => {
        expect(planPropertyCompletionForFile('普通笔记.md', {})).toBeNull();
    });
});