import { describe, it, expect } from 'vitest';
import { EntityFactory } from '../../../../../../engine/repository/domain/serializers/entity-factory';
import { ChapterStatus } from '../../../../../../engine/repository/domain/value-objects';

describe('EntityFactory 实体工厂', () => {
    describe('Chapter fromMarkdown / toMarkdown', () => {
        it('解析章节 Markdown', () => {
            const content = `---
卷: 1
章: 3
标题: 第三章 初入江湖
status: written
word_count: 3000
涉及人物: [张三, 李四]
涉及地点: [京城]
tags: [开篇, 武侠]
---

# 第三章 初入江湖

张三踏入京城的那一刻...`;
            const chapter = EntityFactory.chapterFromMarkdown(content, 'project/03-大纲与章节/正文/第1卷/第3章_正文.md');
            expect(chapter.volume).toBe(1);
            expect(chapter.chapterNum).toBe(3);
            expect(chapter.title).toBe('第三章 初入江湖');
            expect(chapter.status.isWritten()).toBe(true);
            expect(chapter.characters).toContain('张三');
            expect(chapter.characters).toContain('李四');
            expect(chapter.locations).toContain('京城');
            expect(chapter.tags).toContain('开篇');
            expect(chapter.body).toContain('张三踏入京城的那一刻');
        });

        it('序列化和反序列化往返一致', () => {
            const original = `---
卷: 1
章: 1
标题: 第一章 开端
status: pending
---

# 第一章 开端

故事从这里开始。`;

            const chapter = EntityFactory.chapterFromMarkdown(original, 'test.md');
            const serialized = EntityFactory.chapterToMarkdown(chapter);
            const reparsed = EntityFactory.chapterFromMarkdown(serialized, 'test.md');

            expect(reparsed.volume).toBe(chapter.volume);
            expect(reparsed.chapterNum).toBe(chapter.chapterNum);
            expect(reparsed.title).toBe(chapter.title);
            expect(reparsed.status.value).toBe(chapter.status.value);
        });
    });

    describe('Character fromMarkdown / toMarkdown', () => {
        it('解析人物 Markdown', () => {
            const content = `---
name: 张三
姓名: 张三
年龄: 25
身份: 主角
性别: 男
所属势力: 青云宗
tags: 主角, 剑修
entity_status: active
---

# 张三

主角简介...`;
            const char = EntityFactory.characterFromMarkdown(content, 'project/01-世界架构/人物/张三.md');
            expect(char.name).toBe('张三');
            expect(char.category).toBe('character');
            expect(char.tags).toContain('主角');
            expect(char.tags).toContain('剑修');
            expect(char.entityStatus?.isActive()).toBe(true);
        });

        it('序列化和反序列化往返一致', () => {
            const content = `---
name: 李四
姓名: 李四
年龄: 30
身份: 配角
tags: [配角]
entity_status: active
---

# 李四

配角简介`;
            const char1 = EntityFactory.characterFromMarkdown(content, '李四.md');
            const md = EntityFactory.characterToMarkdown(char1);
            const char2 = EntityFactory.characterFromMarkdown(md, '李四.md');
            expect(char2.name).toBe(char1.name);
            expect(char2.category).toBe(char1.category);
        });
    });

    describe('Faction fromMarkdown / toMarkdown', () => {
        it('解析势力 Markdown', () => {
            const content = `---
名称: 青云宗
类型: 宗门
领袖: 掌门
tags: [正道]
entity_status: active
---

# 青云宗

宗门简介...`;
            const faction = EntityFactory.factionFromMarkdown(content, '青云宗.md');
            expect(faction.name).toBe('青云宗');
            expect(faction.category).toBe('faction');
            expect((faction as any).type).toBe('宗门');
        });

        it('序列化和反序列化往返一致', () => {
            const content = `---
名称: 魔教
类型: 宗门
领袖: 教主
tags: [魔道]
entity_status: active
---

# 魔教

魔教简介`;
            const f1 = EntityFactory.factionFromMarkdown(content, '魔教.md');
            const md = EntityFactory.factionToMarkdown(f1);
            const f2 = EntityFactory.factionFromMarkdown(md, '魔教.md');
            expect(f2.name).toBe(f1.name);
        });
    });

    describe('Location fromMarkdown / toMarkdown', () => {
        it('解析地点 Markdown', () => {
            const content = `---
名称: 京城
类型: 都城
重要程度: 高
tags: [都城]
entity_status: active
---

# 京城

地点简介...`;
            const loc = EntityFactory.locationFromMarkdown(content, '京城.md');
            expect(loc.name).toBe('京城');
            expect(loc.category).toBe('location');
        });
    });

    describe('Item fromMarkdown / toMarkdown', () => {
        it('解析物品 Markdown', () => {
            const content = `---
名称: 倚天剑
类型: 武器
品阶/等级: 神器
tags: [神器]
entity_status: active
---

# 倚天剑

物品简介...`;
            const item = EntityFactory.itemFromMarkdown(content, '倚天剑.md');
            expect(item.name).toBe('倚天剑');
            expect(item.category).toBe('item');
        });
    });

    describe('Project fromMarkdown / toMarkdown', () => {
        it('解析项目元数据', () => {
            const content = `---
name: 测试项目
genre: 玄幻
type: 长篇
author: 作者
target_word_count: 1000000
---

# 测试项目

项目简介...`;
            const project = EntityFactory.projectFromMarkdown(content, '测试项目/.project');
            expect(project.name).toBe('测试项目');
            expect(project.genre).toBe('玄幻');
            expect(project.type).toBe('长篇');
            expect(project.author).toBe('作者');
            expect(project.targetWordCount).toBe(1000000);
        });
    });
});
