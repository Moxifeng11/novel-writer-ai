import { describe, it, expect } from 'vitest';
import { SentenceDiversityEngine } from '../../../engine/sentence-diversity-engine';

function makeEngine() {
    return new SentenceDiversityEngine();
}

describe('SentenceDiversityEngine — 句长波动检测', () => {
    it('句长标准差<5时触发句长提示', () => {
        const engine = makeEngine();
        const sentences = ['你好世界', '这是一个测试', '你好'];
        const result = engine.analyzeDiversity(sentences);
        expect(result.needsAdjustment).toBe(true);
        expect(result.hints).toContain('请写一个极短句（3-8字）或极长句（30-50字），打破句长均匀');
    });

    it('句长标准差≥5时不触发句长提示', () => {
        const engine = makeEngine();
        const sentences = ['短', '这是一个非常非常非常长的句子用来测试标准差'];
        const result = engine.analyzeDiversity(sentences);
        const hasLengthHint = result.hints.some(h => h.includes('极短句'));
        expect(hasLengthHint).toBe(false);
    });
});

describe('SentenceDiversityEngine — 开头词重复检测', () => {
    it('连续相同开头时触发开头提示', () => {
        const engine = makeEngine();
        const sentences = ['他站在门口望着远方', '他站在椅子旁边', '她推门走了进来'];
        const result = engine.analyzeDiversity(sentences);
        expect(result.hints).toContain('请变换句式开头，避免连续以相同词语开头');
        expect(result.metrics.openingRepeatCount).toBe(1);
    });

    it('开头多样时不触发开头提示', () => {
        const engine = makeEngine();
        const sentences = ['他站在门口', '忽然一阵风吹过', '她微微一笑'];
        const result = engine.analyzeDiversity(sentences);
        const hasOpeningHint = result.hints.some(h => h.includes('变换句式开头'));
        expect(hasOpeningHint).toBe(false);
        expect(result.metrics.openingRepeatCount).toBe(0);
    });
});

describe('SentenceDiversityEngine — 句式结构重复检测', () => {
    it('连续SVO结构时触发结构提示', () => {
        const engine = makeEngine();
        const sentences = ['他拿起桌上的茶杯', '她放下手中的书本'];
        const result = engine.analyzeDiversity(sentences);
        expect(result.hints).toContain('请变换句式，以状语/连词/对话开头');
        expect(result.metrics.structureRepeatCount).toBe(1);
    });

    it('结构多样时不触发结构提示', () => {
        const engine = makeEngine();
        const sentences = ['他拿起茶杯', '忽然门外传来脚步声', '她放下书本'];
        const result = engine.analyzeDiversity(sentences);
        const hasStructureHint = result.hints.some(h => h.includes('变换句式'));
        expect(hasStructureHint).toBe(false);
    });
});

describe('SentenceDiversityEngine — 边界情况', () => {
    it('多样性良好时 needsAdjustment=false, hints=[]', () => {
        const engine = makeEngine();
        const sentences = [
            '晨光',
            '忽然一阵急促的敲门声打破了清晨的宁静',
            '她缓缓站起身，目光凝重地望向窗外那片灰蒙蒙的天空',
        ];
        const result = engine.analyzeDiversity(sentences);
        expect(result.needsAdjustment).toBe(false);
        expect(result.hints).toEqual([]);
        expect(result.mergedHint).toBe('');
    });

    it('空数组不报错且 needsAdjustment=false', () => {
        const engine = makeEngine();
        const result = engine.analyzeDiversity([]);
        expect(result.needsAdjustment).toBe(false);
        expect(result.hints).toEqual([]);
        expect(result.metrics.sentenceLengthStd).toBe(0);
        expect(result.metrics.openingRepeatCount).toBe(0);
        expect(result.metrics.structureRepeatCount).toBe(0);
    });

    it('少于2句时不触发调整', () => {
        const engine = makeEngine();
        const result = engine.analyzeDiversity(['单独一句']);
        expect(result.needsAdjustment).toBe(false);
        expect(result.hints).toEqual([]);
    });

    it('metrics 数据正确反映输入', () => {
        const engine = makeEngine();
        const sentences = ['他站在门口', '他站在椅子上', '他站在茶杯旁'];
        const result = engine.analyzeDiversity(sentences);
        expect(result.metrics.openingRepeatCount).toBe(2);
        expect(result.metrics.structureRepeatCount).toBe(2);
        expect(typeof result.metrics.sentenceLengthStd).toBe('number');
    });
});
