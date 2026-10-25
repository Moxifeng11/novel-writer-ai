import { describe, expect, it } from 'vitest';
import {
    divergenceLevelFromScore,
    gradeFromScore,
    qualityGradeColor,
    qualityGradeLabel,
    qualityScoreColor,
    scoreLevelFromScore,
} from '../../../shared/quality-grade';

describe('quality-grade — 等级分界', () => {
    it('按 90/80/70/60 划分 S/A/B/C/D', () => {
        expect(gradeFromScore(100)).toBe('S');
        expect(gradeFromScore(90)).toBe('S');
        expect(gradeFromScore(89)).toBe('A');
        expect(gradeFromScore(80)).toBe('A');
        expect(gradeFromScore(70)).toBe('B');
        expect(gradeFromScore(60)).toBe('C');
        expect(gradeFromScore(59)).toBe('D');
    });

    it('等级颜色与标签唯一来源', () => {
        expect(qualityGradeColor('A')).toContain('success');
        expect(qualityGradeColor('D')).toContain('danger');
        expect(qualityGradeLabel('S')).toBe('绝世佳作');
        expect(qualityGradeLabel('D')).toBe('待提升');
    });
});

describe('quality-grade — 分数色阶', () => {
    it('80/60 为唯一色阶分界', () => {
        expect(scoreLevelFromScore(80)).toBe('good');
        expect(scoreLevelFromScore(79)).toBe('warning');
        expect(scoreLevelFromScore(60)).toBe('warning');
        expect(scoreLevelFromScore(59)).toBe('danger');
    });

    it('颜色与色阶一致', () => {
        expect(qualityScoreColor(80)).toContain('success');
        expect(qualityScoreColor(60)).toContain('warning');
        expect(qualityScoreColor(10)).toContain('danger');
    });
});

describe('quality-grade — 偏离预警', () => {
    it('与 deviation-detector 的 60/30 阈值同源', () => {
        expect(divergenceLevelFromScore(60)).toBe('danger');
        expect(divergenceLevelFromScore(59)).toBe('warning');
        expect(divergenceLevelFromScore(30)).toBe('warning');
        expect(divergenceLevelFromScore(29)).toBe('normal');
    });
});
