import { describe, it, expect } from 'vitest';
import { describePrerequisiteGaps, PREREQ_MIN_BODY_CHARS } from '../../../shared/prereq-check';

describe('describePrerequisiteGaps — 前置规划缺口文本', () => {
    it('PC-1: 文件都存在且正文达标 → 无缺口', () => {
        expect(describePrerequisiteGaps([
            { name: '信息规划', exists: true, bodyLength: 800 },
            { name: '大纲摘要', exists: true, bodyLength: 600 },
        ])).toEqual([]);
    });

    it('PC-2: 文件不存在 → 只报名字', () => {
        expect(describePrerequisiteGaps([
            { name: '信息规划', exists: false },
        ])).toEqual(['信息规划']);
    });

    it('PC-3: 读取失败 → 标注读取失败', () => {
        expect(describePrerequisiteGaps([
            { name: '信息规划', exists: true, readFailed: true },
        ])).toEqual(['信息规划（读取失败）']);
    });

    it('PC-4: 正文为空模板 → 标注内容过短', () => {
        expect(describePrerequisiteGaps([
            { name: '大纲摘要', exists: true, bodyLength: 20 },
        ])).toEqual(['大纲摘要（内容过短）']);
    });

    it('PC-5: 恰好等于门槛视为通过', () => {
        expect(describePrerequisiteGaps([
            { name: '信息规划', exists: true, bodyLength: PREREQ_MIN_BODY_CHARS },
        ])).toEqual([]);
    });

    it('PC-6: 差 1 字视为过短', () => {
        expect(describePrerequisiteGaps([
            { name: '信息规划', exists: true, bodyLength: PREREQ_MIN_BODY_CHARS - 1 },
        ])).toEqual(['信息规划（内容过短）']);
    });

    it('PC-7: 未提供正文长度按 0 处理', () => {
        expect(describePrerequisiteGaps([
            { name: '信息规划', exists: true },
        ])).toEqual(['信息规划（内容过短）']);
    });

    it('PC-8: 多个缺口保持检查顺序', () => {
        expect(describePrerequisiteGaps([
            { name: '信息规划', exists: false },
            { name: '大纲摘要', exists: true, bodyLength: 10 },
        ])).toEqual(['信息规划', '大纲摘要（内容过短）']);
    });

    it('PC-9: 支持自定义门槛', () => {
        expect(describePrerequisiteGaps([
            { name: '信息规划', exists: true, bodyLength: 60 },
        ], 50)).toEqual([]);
    });

    it('PC-10: 读取失败优先于正文长度（不被误报成过短）', () => {
        expect(describePrerequisiteGaps([
            { name: '信息规划', exists: true, readFailed: true, bodyLength: 0 },
        ])).toEqual(['信息规划（读取失败）']);
    });
});
