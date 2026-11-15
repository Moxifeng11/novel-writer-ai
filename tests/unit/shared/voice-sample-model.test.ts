import { describe, expect, it } from 'vitest';
import { parseVoiceSample, renderVoiceSampleSection, selectVoiceSamples } from '@/shared/voice-sample-model';
import type { ProjectIndexEntry } from '@/shared/project-index-model';

const entry = (over: Partial<ProjectIndexEntry>): ProjectIndexEntry => ({
    path: 'p/a.md', name: 'a', kind: 'other', size: 1, mtime: 1, ...over,
});

describe('parseVoiceSample', () => {
    it('解析台词样本与特征', () => {
        const sample = parseVoiceSample({ 口吻样本: ['老子不干', '行吧，听你的'], 说话特征: ['爱用老子', '语速快'] }, 'CHR-0001', '林玄');
        expect(sample?.samples).toHaveLength(2);
        expect(sample?.traits).toContain('爱用老子');
    });

    it('英文键也支持', () => {
        const sample = parseVoiceSample({ voice_samples: 'a|b', voice_traits: ['x'] }, 'CHR-0001', 'A');
        expect(sample?.samples).toEqual(['a', 'b']);
    });

    it('无样本返回 null', () => {
        expect(parseVoiceSample({}, 'CHR-0001', 'A')).toBeNull();
    });
});

describe('selectVoiceSamples', () => {
    const entries = [
        entry({ path: 'p/人物/CHR-0001_林玄.md', name: '林玄', type: 'character', id: 'CHR-0001' }),
        entry({ path: 'p/人物/CHR-0002_苏婉.md', name: '苏婉', type: 'character', id: 'CHR-0002' }),
        entry({ path: 'p/地点/LOC-0001.md', name: '山门', type: 'location', id: 'LOC-0001' }),
    ];
    const fm = {
        'p/人物/CHR-0001_林玄.md': { 口吻样本: ['老子不干'] },
        'p/人物/CHR-0002_苏婉.md': { 口吻样本: ['好的呢'] },
        'p/地点/LOC-0001.md': { 口吻样本: ['不该有'] },
    };

    it('只取在场角色', () => {
        const samples = selectVoiceSamples(entries, fm, ['CHR-0001']);
        expect(samples.map(sample => sample.id)).toEqual(['CHR-0001']);
    });

    it('非角色类型不参与', () => {
        const samples = selectVoiceSamples(entries, fm, ['LOC-0001']);
        expect(samples).toEqual([]);
    });
});

describe('renderVoiceSampleSection', () => {
    it('渲染角色与台词', () => {
        const text = renderVoiceSampleSection([{ id: 'CHR-0001', name: '林玄', samples: ['老子不干'], traits: ['爱用老子'] }]);
        expect(text).toContain('林玄');
        expect(text).toContain('老子不干');
        expect(text).toContain('爱用老子');
    });

    it('空样本返回空串', () => {
        expect(renderVoiceSampleSection([])).toBe('');
    });
});
