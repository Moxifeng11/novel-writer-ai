import { describe, it, expect } from 'vitest';
import { DomainValidator } from '../../../../../../engine/repository/domain/validators/domain-validator';
import { Project, Chapter, Character, Faction, Location, Item } from '../../../../../../engine/repository/domain/aggregates';
import { EntityStatus } from '../../../../../../engine/repository/domain/value-objects';

describe('DomainValidator 领域验证器', () => {
    describe('基础实体验证', () => {
        it('空 ID 报错', () => {
            const project = Project.create('', '测试', 'test/.project');
            const result = DomainValidator.validate(project);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.field === 'id')).toBe(true);
        });

        it('空名称报错', () => {
            const project = Project.create('id', '', 'test/.project');
            const result = DomainValidator.validate(project);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.field === 'name')).toBe(true);
        });

        it('正常实体通过验证', () => {
            const project = Project.create('id', '测试项目', 'test/.project');
            const result = DomainValidator.validate(project);
            expect(result.isValid).toBe(true);
        });
    });

    describe('Project 验证', () => {
        it('负目标字数报错', () => {
            const project = Project.create('id', '测试', 'test/.project', { targetWordCount: -100 });
            const result = DomainValidator.validate(project);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.field === 'targetWordCount')).toBe(true);
        });

        it('负卷数报错', () => {
            const project = Project.create('id', '测试', 'test/.project', { currentVolume: -1 });
            const result = DomainValidator.validate(project);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.field === 'currentVolume')).toBe(true);
        });
    });

    describe('Chapter 验证', () => {
        it('负卷号报错', () => {
            const chapter = Chapter.create('id', '测试', -1, 1, 'test.md');
            const result = DomainValidator.validate(chapter);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.field === 'volume')).toBe(true);
        });

        it('负章号报错', () => {
            const chapter = Chapter.create('id', '测试', 1, -5, 'test.md');
            const result = DomainValidator.validate(chapter);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.field === 'chapterNum')).toBe(true);
        });
    });

    describe('Character 验证', () => {
        it('关系缺少目标名称报错', () => {
            const char = Character.create('id', '测试', 'test.md');
            const charWithRel = char.addRelation({ fromName: '张三', toName: '', type: '朋友', tension: '低' });
            const result = DomainValidator.validate(charWithRel);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(e => e.field.startsWith('relations'))).toBe(true);
        });

        it('正常人物通过验证', () => {
            const char = Character.create('zhangsan', '张三', '张三.md');
            const result = DomainValidator.validate(char);
            expect(result.isValid).toBe(true);
        });
    });

    describe('统一验证入口', () => {
        it('按分类调用正确的验证方法', () => {
            const faction = Faction.create('qingyun', '青云宗', '青云宗.md');
            const result = DomainValidator.validate(faction);
            expect(result.isValid).toBe(true);
        });

        it('Location 通过验证', () => {
            const loc = Location.create('beijing', '京城', '京城.md');
            const result = DomainValidator.validate(loc);
            expect(result.isValid).toBe(true);
        });

        it('Item 通过验证', () => {
            const item = Item.create('sword', '倚天剑', '倚天剑.md');
            const result = DomainValidator.validate(item);
            expect(result.isValid).toBe(true);
        });
    });

    describe('mergeResults', () => {
        it('合并多个验证结果', () => {
            const r1 = { isValid: true, errors: [], warnings: [{ field: 'a', message: 'warn1' }] };
            const r2 = { isValid: false, errors: [{ field: 'b', message: 'err1' }], warnings: [] };
            const merged = DomainValidator.mergeResults(r1, r2);
            expect(merged.isValid).toBe(false);
            expect(merged.errors.length).toBe(1);
            expect(merged.warnings.length).toBe(1);
        });
    });
});
