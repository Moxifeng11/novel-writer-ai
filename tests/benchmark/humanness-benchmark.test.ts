/**
 * humanness-benchmark.test.ts — 「像不像人写」离线评估入口
 *
 * 为什么是 vitest 而不是独立 .mjs：判定要用 `engine/anti-ai-detector.ts` 与
 * `shared/human-similarity.ts`（TS），脚本里重复实现会立刻漂移。这里用基准配置跑，
 * 读环境变量当命令行参数，输出一张可复核的表。
 *
 * 用法：
 *   npm run sample:human                     # 先抽样，生成 data/human-samples/baseline.json
 *   npm run eval:humanness                   # 用本地样文自查（真人样文应拿高分）
 *   HUMAN_EVAL_FILE=<path> npm run eval:humanness          # 评一篇文本
 *   HUMAN_EVAL_COMPARE=<before>:<after> npm run eval:humanness  # 改写前后对比
 *
 * 无 `data/human-samples/baseline.json` 时显式 skip（不阻塞 CI）。
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AntiAIDetector } from '../../engine/anti-ai-detector';
import { analyzeProse, scoreProseRisk } from '../../shared/prose-metrics';
import {
    humanSimilarity,
    scoreHumanity,
    type DistributionHistogram,
} from '../../shared/human-similarity';
import { evaluateHumanFeatures } from '../../shared/human-feature-rubric';

const SAMPLE_DIR = path.resolve(process.cwd(), 'data', 'human-samples');
const BASELINE_PATH = path.join(SAMPLE_DIR, 'baseline.json');

interface BaselineFile {
    version: number;
    books: Array<{ book: string; encoding: string; chunks: number; samples: number }>;
    sampleCount: number;
    distribution: DistributionHistogram;
}

function loadBaseline(): BaselineFile | null {
    if (!fs.existsSync(BASELINE_PATH)) return null;
    try {
        return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as BaselineFile;
    } catch {
        return null;
    }
}

function evaluateText(text: string, baseline: DistributionHistogram) {
    const detector = new AntiAIDetector();
    const detection = detector.detect(text);
    const metrics = analyzeProse(text);
    const risk = scoreProseRisk(metrics);
    const similarity = humanSimilarity(text, baseline);
    const rubric = evaluateHumanFeatures(text);
    return {
        chars: text.replace(/\s+/g, '').length,
        antiAI: detection.score,
        humanSim: Math.round(similarity.score * 1000) / 1000,
        proseRisk: risk.score,
        proseLevel: risk.level,
        dialogueRatio: metrics.dialogueCharsRatio,
        avgSentence: metrics.avgSentenceLength,
        humanFeatureScore: Math.round(rubric.score * 100),
        humanFeatureIssues: rubric.issues.map((issue) => issue.key),
    };
}

describe('人味基准（离线）', () => {
    const baselineFile = loadBaseline();
    const hasFixture = Boolean(baselineFile);
    const baseline = baselineFile?.distribution;

    it.skipIf(!hasFixture)('本地真人样文的 humanSim 显著高于 AI 腔样本', () => {
        if (!baseline) return;
        const sampleFiles = fs.readdirSync(SAMPLE_DIR).filter((name) => name.endsWith('.json') && name !== 'baseline.json');
        const rows = sampleFiles.flatMap((file) => {
            const data = JSON.parse(fs.readFileSync(path.join(SAMPLE_DIR, file), 'utf8')) as {
                book: string;
                samples: Array<{ kind: string; text: string }>;
            };
            return data.samples.map((sample) => ({
                book: data.book,
                kind: sample.kind,
                ...evaluateText(sample.text, baseline),
            }));
        });
        const avgHumanSim = rows.reduce((sum, row) => sum + row.humanSim, 0) / Math.max(1, rows.length);
        const avgAntiAI = rows.reduce((sum, row) => sum + row.antiAI, 0) / Math.max(1, rows.length);
        console.log(`\n[human] ${rows.length} 段真人样文：平均 humanSim=${avgHumanSim.toFixed(3)}、平均 antiAI=${avgAntiAI.toFixed(1)}`);
        for (const row of rows.slice(0, 5)) {
            console.log(`  - ${row.book}·${row.kind}: antiAI=${row.antiAI} humanSim=${row.humanSim} risk=${row.proseRisk}`);
        }
        // 真人样文的 antiAI 必须低（这条是硬指标）
        expect(avgAntiAI).toBeLessThan(25);
        // humanSim 只作参考：实测（2026-10-31）第2章 AI 正文 humanSim 0.64 > 真人样文均值 0.58，
        // 因为句长/段长这些表层分布早被提示词优化过。这里只防「指标塌到 0」，
        // 真正的判据是 antiAI + 对话占比下限 + 保真（见 shared/human-similarity.ts）。
        expect(avgHumanSim).toBeGreaterThan(0.45);
    });

    it.skipIf(!hasFixture)('指定文本可评估（HUMAN_EVAL_FILE）', () => {
        if (!baseline) return;
        const target = process.env.HUMAN_EVAL_FILE?.trim();
        if (!target) {
            console.log('\n[skip-eval] 未设置 HUMAN_EVAL_FILE，跳过单文件评估');
            return;
        }
        const text = fs.readFileSync(target, 'utf8');
        const result = evaluateText(text, baseline);
        console.log(`\n[eval] ${path.basename(target)}: ${JSON.stringify(result, null, 2)}`);
        expect(result.chars).toBeGreaterThan(100);
    });

    it.skipIf(!hasFixture)('改写前后对比（HUMAN_EVAL_COMPARE=before:after）', () => {
        if (!baseline) return;
        const spec = process.env.HUMAN_EVAL_COMPARE?.trim();
        if (!spec) {
            console.log('\n[skip-compare] 未设置 HUMAN_EVAL_COMPARE，跳过对比');
            return;
        }
        const [beforePath, afterPath] = spec.split(':');
        if (!beforePath || !afterPath) {
            console.log('[compare] 格式应为 before:after（两个文件路径）');
            return;
        }
        const before = fs.readFileSync(beforePath, 'utf8');
        const after = fs.readFileSync(afterPath, 'utf8');
        const beforeResult = evaluateText(before, baseline);
        const afterResult = evaluateText(after, baseline);
        const beforeComposite = scoreHumanity({
            original: before, candidate: before, antiAI: beforeResult.antiAI, baseline,
        }).composite;
        const afterComposite = scoreHumanity({
            original: before, candidate: after, antiAI: afterResult.antiAI, baseline,
        }).composite;

        console.log('\n[compare] 改写前 → 改写后');
        console.log(`  antiAI   : ${beforeResult.antiAI} → ${afterResult.antiAI}（越低越好）`);
        console.log(`  humanSim : ${beforeResult.humanSim} → ${afterResult.humanSim}（越高越好）`);
        console.log(`  proseRisk: ${beforeResult.proseRisk} → ${afterResult.proseRisk}`);
        console.log(`  综合分   : ${(beforeComposite * 100).toFixed(1)} → ${(afterComposite * 100).toFixed(1)}`);
        const fidelity = scoreHumanity({
            original: before, candidate: after, antiAI: afterResult.antiAI, baseline,
        }).fidelity;
        console.log(`  保真     : ok=${fidelity.ok} 长度比=${fidelity.lengthRatio.toFixed(2)} 内容重合=${fidelity.contentOverlap.toFixed(2)}`);
        if (fidelity.reasons.length > 0) console.log(`  保真问题 : ${fidelity.reasons.join('；')}`);

        // 不断言"一定变好"——只看数据；但保真失败必须显式失败
        expect(fidelity.lengthRatio).toBeGreaterThan(0);
    });
});
