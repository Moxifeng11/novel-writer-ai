import { describe, it, expect } from 'vitest';
import {
    getRelationshipFilePath,
    extractRelationshipChanges,
    applyRelationshipChanges,
    formatRelationshipFile,
} from '../../../engine/relationship-engine';

describe('getRelationshipFilePath', () => {
    it('返回正确的关系文件路径', () => {
        const path = getRelationshipFilePath('我的小说');
        expect(path).toContain('我的小说');
        expect(path).toContain('.md');
    });
});

describe('extractRelationshipChanges', () => {
    it('从 RELATION 行提取关系变化', () => {
        const content = `RELATION: 林砚|苏晴|信任|trust +10
RELATION: 墨渊|守御者联盟|敌对|resentment +5`;
        const changes = extractRelationshipChanges(content);
        expect(changes.length).toBe(2);
        expect(changes[0].charA).toBe('林砚');
        expect(changes[0].charB).toBe('苏晴');
        expect(changes[0].dimension).toBe('trust');
        expect(changes[0].delta).toBe(10);
    });

    it('从 EMOTION 行提取关系变化', () => {
        const content = `EMOTION: [[林砚]] | 当前情绪 | 对苏晴 fear +10`;
        const changes = extractRelationshipChanges(content);
        expect(changes.length).toBe(1);
        expect(changes[0].charA).toBe('林砚');
        expect(changes[0].charB).toBe('苏晴');
        expect(changes[0].dimension).toBe('fear');
        expect(changes[0].delta).toBe(10);
    });

    it('空内容返回空数组', () => {
        expect(extractRelationshipChanges('')).toEqual([]);
    });

    it('不匹配的内容返回空数组', () => {
        expect(extractRelationshipChanges('普通文本内容')).toEqual([]);
    });

    it('支持负向变化', () => {
        const content = `RELATION: A|B|冲突|trust -20`;
        const changes = extractRelationshipChanges(content);
        expect(changes.length).toBe(1);
        expect(changes[0].delta).toBe(-20);
    });
});

describe('applyRelationshipChanges', () => {
    it('创建新关系并应用变化（初始值50）', () => {
        const { relations } = applyRelationshipChanges([], [{
            charA: 'A', charB: 'B', dimension: 'trust', delta: 10, reason: '初次相遇'
        }], '第1章');
        expect(relations.length).toBe(1);
        expect(relations[0].state.trust).toBe(60);
        expect(relations[0].lastUpdatedChapter).toBe('第1章');
    });

    it('累加同一维度的变化', () => {
        let { relations } = applyRelationshipChanges([], [{
            charA: 'A', charB: 'B', dimension: 'trust', delta: 10, reason: 'first'
        }], '第1章');
        relations = applyRelationshipChanges(relations, [{
            charA: 'A', charB: 'B', dimension: 'trust', delta: 20, reason: 'second'
        }], '第2章').relations;
        expect(relations[0].state.trust).toBe(80);
    });

    it('限制在 0-100 范围内', () => {
        const { relations } = applyRelationshipChanges([], [{
            charA: 'A', charB: 'B', dimension: 'trust', delta: 100, reason: 'max'
        }], '第1章');
        expect(relations[0].state.trust).toBe(100);
    });

    it('支持负向变化', () => {
        const { relations } = applyRelationshipChanges([], [{
            charA: 'A', charB: 'B', dimension: 'trust', delta: -60, reason: 'betrayal'
        }], '第1章');
        expect(relations[0].state.trust).toBe(0);
    });
});

describe('formatRelationshipFile', () => {
    it('格式化关系文件为 Markdown 格式', () => {
        const { relations } = applyRelationshipChanges([], [{
            charA: '林砚', charB: '苏晴', dimension: 'trust', delta: 20, reason: '信任: 共同经历冒险'
        }], '第3章');
        const content = formatRelationshipFile(relations, '第3章');
        expect(typeof content).toBe('string');
        expect(content).toContain('林砚');
        expect(content).toContain('苏晴');
        expect(content).toContain('---');
        expect(content).toContain('tags:');
        expect(content).toContain('trust:');
    });

    it('空关系列表也返回字符串', () => {
        const content = formatRelationshipFile([], '第1章');
        expect(typeof content).toBe('string');
    });
});
