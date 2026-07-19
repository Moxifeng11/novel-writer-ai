import { describe, it, expect } from 'vitest';
import { Chapter, Character, Faction, Location, Item, Project } from '../../../../../../engine/repository/domain/aggregates';
import { EntityStatus, ChapterStatus, WordCount } from '../../../../../../engine/repository/domain/value-objects';

describe('聚合根基础测试', () => {
    describe('Project', () => {
        it('create 创建项目', () => {
            const project = Project.create('test-proj', '测试项目', '测试项目/.project', {
                genre: '玄幻',
                type: '长篇',
            });
            expect(project.id).toBe('test-proj');
            expect(project.name).toBe('测试项目');
            expect(project.category).toBe('project');
            expect(project.genre).toBe('玄幻');
            expect(project.type).toBe('长篇');
        });

        it('withMeta 更新元数据', () => {
            const project = Project.create('p1', '项目1', 'p1/.project');
            const updated = project.withMeta({ genre: '都市' });
            expect(updated.genre).toBe('都市');
            expect(updated.name).toBe('项目1');
        });
    });

    describe('Chapter', () => {
        it('create 创建章节', () => {
            const chapter = Chapter.create('ch1', '第一章 开端', 1, 1, 'project/03-大纲与章节/正文/第1卷/第1章_正文.md');
            expect(chapter.id).toBe('ch1');
            expect(chapter.title).toBe('第一章 开端');
            expect(chapter.volume).toBe(1);
            expect(chapter.chapterNum).toBe(1);
            expect(chapter.status.isPending()).toBe(true);
            expect(chapter.category).toBe('chapter');
        });

        it('withBody 更新正文并自动统计字数', () => {
            const chapter = Chapter.create('ch1', '测试', 1, 1, 'test.md');
            const updated = chapter.withBody('这是一段测试文本。');
            expect(updated.wordCount.chinese).toBeGreaterThan(0);
            expect(updated.body).toBe('这是一段测试文本。');
        });

        it('withChapterStatus 更新章节状态', () => {
            const chapter = Chapter.create('ch1', '测试', 1, 1, 'test.md');
            const updated = chapter.withChapterStatus(ChapterStatus.WRITTEN);
            expect(updated.status.isWritten()).toBe(true);
        });

        it('添加/移除涉及人物', () => {
            let chapter = Chapter.create('ch1', '测试', 1, 1, 'test.md');
            chapter = chapter.addCharacter('张三');
            chapter = chapter.addCharacter('李四');
            expect(chapter.characters).toEqual(['张三', '李四']);
            chapter = chapter.removeCharacter('张三');
            expect(chapter.characters).toEqual(['李四']);
        });
    });

    describe('Character', () => {
        it('create 创建人物', () => {
            const char = Character.create('zhangsan', '张三', 'project/01-世界架构/人物/张三.md');
            expect(char.id).toBe('zhangsan');
            expect(char.name).toBe('张三');
            expect(char.category).toBe('character');
            expect(char.entityStatus?.isActive()).toBe(true);
        });

        it('withName 更新名称', () => {
            const char = Character.create('id', '旧名', 'path');
            const updated = char.withName('新名');
            expect(updated.name).toBe('新名');
        });

        it('withStatus 更新状态', () => {
            const char = Character.create('id', 'name', 'path');
            const updated = char.withStatus(EntityStatus.DEAD);
            expect(updated.entityStatus?.isDead()).toBe(true);
        });
    });

    describe('Faction', () => {
        it('create 创建势力', () => {
            const faction = Faction.create('qingyun', '青云宗', 'project/01-世界架构/势力/青云宗.md');
            expect(faction.id).toBe('qingyun');
            expect(faction.name).toBe('青云宗');
            expect(faction.category).toBe('faction');
        });

        it('withLeader 更新领袖', () => {
            const faction = Faction.create('id', '势力', 'path');
            const updated = faction.withLeader('张三');
            expect((updated as any).leader).toBe('张三');
        });
    });

    describe('Location', () => {
        it('create 创建地点', () => {
            const loc = Location.create('beijing', '京城', 'project/01-世界架构/地点/京城.md');
            expect(loc.id).toBe('beijing');
            expect(loc.name).toBe('京城');
            expect(loc.category).toBe('location');
        });
    });

    describe('Item', () => {
        it('create 创建物品', () => {
            const item = Item.create('sword', '倚天剑', 'project/01-世界架构/物品功法/倚天剑.md');
            expect(item.id).toBe('sword');
            expect(item.name).toBe('倚天剑');
            expect(item.category).toBe('item');
        });

        it('withOwner 更新所有者', () => {
            const item = Item.create('id', '物品', 'path');
            const updated = item.withOwner('张三');
            expect((updated as any).owner).toBe('张三');
        });
    });
});
