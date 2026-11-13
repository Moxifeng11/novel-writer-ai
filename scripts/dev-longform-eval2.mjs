/**
 * 长篇端到端评测 v2（阶段 D 第二轮）
 *
 * 修首轮的两个脚本缺陷：
 *  1. 注入目标按**主体去重**（首轮重复注入同一角色，实际只有 2 个有效冲突对）
 *  2. 数值口径对齐：同时给出 value / numericValue / unit，并在注入后**自检**解析结果
 *
 * 另加**规模效应**：用真实事实按章节偏移复制到 60 / 100 章跨度，看误报是否随累积上升。
 * （复制是合成放大，报告里明确标注，不冒充真实 100 章数据。）
 */
import fs from 'node:fs';
import path from 'node:path';
import { runAudit } from '../engine/consistency/audit-pipeline.ts';

const pluginDir = 'D:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai';
const batch = JSON.parse(fs.readFileSync(path.join(pluginDir, 'docs/analysis/knowledge-batch.json'), 'utf8'));

const TYPE_TO_KIND = {
    age: 'quantitative', location: 'geographical', possession: 'appearance',
    ability: 'skill-fluctuation', relationship: 'social-norm', timeline: 'absolute-time',
    'world-rule': 'core-rule', knowledge: 'knowledge', memory: 'memory',
};

/**
 * 拆解条目 → 断言。
 *
 * @param entry - 条目
 * @param chapter - 章节号覆盖
 * @returns 断言
 */
function toAssertion(entry, chapter) {
    return {
        id: `fact|${chapter}|${entry.subject}|${entry.predicate}|${entry.type}`,
        kind: TYPE_TO_KIND[entry.type] ?? 'quantitative',
        subject: entry.subject,
        predicate: entry.predicate,
        value: entry.value,
        numericValue: entry.numeric,
        unit: entry.unit,
        chapterKey: `第${chapter}章`,
        chapterNum: chapter,
        quote: entry.quote,
        source: 'fact-store',
        extractedAt: 0,
        isCurrentState: entry.isCurrentState !== false,
        event: entry.event,
        slot: entry.slot,
    };
}

const baseAssertions = batch.entries.map(entry => toAssertion(entry, entry.chapter));
const maxChapter = Math.max(...batch.entries.map(e => e.chapter));

/**
 * 跑审核（只取矛盾）。
 *
 * @param assertions - 断言
 * @returns 矛盾列表
 */
async function audit(assertions) {
    const report = await runAudit({ assertions, chapters: [], factTexts: [] });
    return report.contradictions;
}

console.log(`真实数据：${batch.entries.length} 条事实 / ${batch.ok} 章（第1–${maxChapter}章）`);

// ── 基线 ──
const baseline = await audit(baseAssertions);
console.log(`真实数据误报：${baseline.length} 条`);
for (const c of baseline.slice(0, 6)) console.log(`  [${c.kind}] ${c.reasoning.slice(0, 70)}`);

// ── ① 注入 10 处矛盾（按主体去重）──
const ageEntries = batch.entries.filter(e => e.type === 'age' && Number.isFinite(e.numeric));
// 自检：只保留原值 > 3 的主体，确保注入后确实是「倒退」而不是「增长」
const INEXACT = ['未满', '不到', '不足', '将近', '接近', '约', '左右', '上下', '余', '多'];
const isExact = e => !INEXACT.some(m => String(e.value).includes(m));
// 只取精确值 + 当前状态的事实作为注入源（边界值与回溯值不参与比较）
const usableAge = ageEntries.filter(e => Number(e.numeric) > 3 && isExact(e) && e.isCurrentState !== false);
const bySubject = new Map();
for (const entry of usableAge) {
    if (!bySubject.has(entry.subject)) bySubject.set(entry.subject, []);
    bySubject.get(entry.subject).push(entry);
}
const injectTargets = [...bySubject.entries()]
    .map(([subject, list]) => ({ subject, earliest: list.sort((a, b) => a.chapter - b.chapter)[0] }))
    .slice(0, 10);
console.log(`\n可注入主体：${bySubject.size} 个，实际注入 ${injectTargets.length} 处`);

const injectedPairs = [];
const injectedAssertions = [];
injectTargets.forEach((target, index) => {
    const old = target.earliest;
    const later = maxChapter + 5 + index;
    const regressed = Math.max(1, Number(old.numeric) - 3);
    if (!(regressed < Number(old.numeric))) throw new Error(`注入自检失败：${target.subject} ${old.numeric}→${regressed} 不是倒退`);
    injectedPairs.push({ subject: target.subject, later, expected: regressed, original: old.numeric });
    injectedAssertions.push(toAssertion({
        ...old,
        value: String(regressed),
        numeric: regressed,
        unit: '岁',
        quote: `注入：${target.subject}今年${regressed}岁`,
    }, later));
});

const withContradictions = [...baseAssertions, ...injectedAssertions];
const findings = await audit(withContradictions);
const detected = injectedPairs.filter(pair => findings.some(c =>
    c.evidenceB.chapterKey === `第${pair.later}章` || c.evidenceA.chapterKey === `第${pair.later}章`));
console.log(`① 注入矛盾 ${injectedPairs.length} 处 → 检出 ${detected.length} 处（召回 ${((detected.length / injectedPairs.length) * 100).toFixed(0)}%）`);
for (const pair of injectedPairs) {
    const hit = detected.includes(pair) ? '✓' : '✗';
    console.log(`  ${hit} ${pair.subject}：第${pair.later}章注入 ${pair.expected}（原值 ${pair.original}）`);
}

// ── ② 注入 10 处合法变化（能力进阶）──
const abilityEntries = batch.entries.filter(e => e.type === 'ability');
const abilityBySubject = new Map();
for (const entry of abilityEntries) {
    if (!abilityBySubject.has(entry.subject)) abilityBySubject.set(entry.subject, []);
    abilityBySubject.get(entry.subject).push(entry);
}
const legalTargets = [...abilityBySubject.entries()].slice(0, 10);
const legalPairs = [];
const legalAssertions = [];
const LADDER = ['筑基一层', '金丹一层', '元婴一层'];
legalTargets.forEach(([subject, list], index) => {
    const source = list.sort((a, b) => a.chapter - b.chapter)[0];
    const later = maxChapter + 2 + index;
    legalPairs.push({ subject, later });
    legalAssertions.push(toAssertion({
        ...source,
        value: LADDER[index % LADDER.length],
        numeric: undefined,
        unit: undefined,
        quote: `合法进阶：${subject}${LADDER[index % LADDER.length]}`,
    }, later));
});
const withLegal = [...baseAssertions, ...legalAssertions];
const legalFindings = await audit(withLegal);
const legalFlagged = legalPairs.filter(pair => legalFindings.some(c =>
    c.evidenceB.chapterKey === `第${pair.later}章` || c.evidenceA.chapterKey === `第${pair.later}章`));
console.log(`\n② 注入合法变化 ${legalPairs.length} 处 → 误报 ${legalFlagged.length} 处（应为 0）`);
for (const pair of legalFlagged) console.log(`  ✗ ${pair.subject}：第${pair.later}章被判矛盾`);

// ── ③ 规模效应（合成放大，明确标注）──
console.log('\n③ 规模效应（用真实事实按章节偏移复制，非真实 100 章数据）');
const scaleRows = [];
for (const span of [30, 60, 100]) {
    const copies = Math.ceil(span / maxChapter);
    const scaled = [];
    for (let k = 0; k < copies; k += 1) {
        for (const entry of batch.entries) {
            const chapter = entry.chapter + k * maxChapter;
            if (chapter > span) continue;
            scaled.push(toAssertion(entry, chapter));
        }
    }
    const report = await audit(scaled);
    scaleRows.push({ span, facts: scaled.length, falsePositives: report.length });
    console.log(`  跨度 ${span} 章：事实 ${scaled.length} 条 → 误报 ${report.length} 条`);
}

const totalFalse = baseline.length + legalFlagged.length;
console.log('\n===== 汇总 =====');
console.log(`真实基线误报：${baseline.length} / ${batch.entries.length} 条`);
console.log(`注入矛盾召回：${detected.length} / ${injectedPairs.length}`);
console.log(`合法变化误报：${legalFlagged.length} / ${legalPairs.length}`);
console.log(`误报合计：${totalFalse}`);

fs.writeFileSync(path.join(pluginDir, 'docs/analysis/longform-eval-v2-result.json'), JSON.stringify({
    chapters: batch.ok,
    realFacts: batch.entries.length,
    baselineFalsePositives: baseline.length,
    injectedContradictions: injectedPairs.length,
    detected: detected.length,
    recall: injectedPairs.length ? detected.length / injectedPairs.length : 0,
    detectedSubjects: detected.map(p => p.subject),
    legalChanges: legalPairs.length,
    legalFalsePositives: legalFlagged.length,
    scale: scaleRows,
}, null, 2));
console.log('已写入 docs/analysis/longform-eval-v2-result.json');
