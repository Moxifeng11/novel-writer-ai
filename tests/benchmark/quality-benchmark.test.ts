import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { WritingQualityEngine } from '../../engine/writing-quality-engine';
import { computeBenchmarkSummary, passesBenchmark, type BenchmarkSampleScore } from '../../shared/quality-benchmark';

interface FixtureSample {
    id: string;
    label: 'good' | 'bad';
    genre?: string;
    text: string;
}

interface Fixture {
    minGap?: number;
    maxMisclassified?: number;
    samples: FixtureSample[];
}

const fixturePath = resolve(process.cwd(), 'benchmarks/quality/samples.json');
const hasFixture = existsSync(fixturePath);

describe.skipIf(!hasFixture)('quality benchmark — 基准样章评估', () => {
    it('good 样章评分显著高于 bad，并输出维度分离度', () => {
        const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
        const engine = new WritingQualityEngine();
        const scores: BenchmarkSampleScore[] = fixture.samples.map(sample => {
            const result = engine.evaluate(sample.text);
            return {
                id: sample.id,
                label: sample.label,
                genre: sample.genre,
                overall: result.overallScore,
                dimensions: {
                    language: result.languageQuality.score,
                    rhythm: result.rhythmQuality.score,
                    character: result.characterQuality.score,
                    plot: result.plotQuality.score,
                    atmosphere: result.atmosphereQuality.score,
                    structure: result.structureQuality.score,
                },
            };
        });

        const summary = computeBenchmarkSummary(scores);
        console.table(summary.dimensions);
        const verdict = passesBenchmark(summary, {
            minGap: fixture.minGap ?? 5,
            maxMisclassified: fixture.maxMisclassified,
        });
        expect(verdict.passed, verdict.reasons.join('；')).toBe(true);
    });
});

describe.skipIf(hasFixture)('quality benchmark — 未配置 fixture', () => {
    it('没有 benchmarks/quality/samples.json 时跳过（不阻塞日常测试）', () => {
        expect(hasFixture).toBe(false);
    });
});
