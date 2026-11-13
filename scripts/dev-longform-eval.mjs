/**
 * 长篇端到端评测（阶段 D）
 *
 * 用**真实原著拆解数据**（docs/analysis/knowledge-batch.json，《将夜》30 章 456 条）
 * 构造注入集，评测检测层的召回与误报：
 *
 *  - 注入 10 处矛盾：给真实事实追加一条「后续章节的冲突值」
 *  - 注入 10 处合法变化：能力进阶（等级更高）、物品在区间内失效
 *  - 真实基线：不加注入，看真实数据上误报多少
 *
 * 这样不额外花 LLM 费用（数据已存在），且答案已知（注入点）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { runAudit } from '../engine/consistency/audit-pipeline.ts';


const pluginDir = 'D:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai';
const batch = JSON.parse(fs.readFileSync(path.join(pluginDir, 'docs/analysis/knowledge-batch.json'), 'utf8'));

/** 拆解类型 → 断言 kind（与生产接线一致） */
const TYPE_TO_KIND = {
    age: 'quantitative', location: 'geographical', possession: 'appearance',
    ability: 'skill-fluctuation', relationship: 'social-norm', timeline: 'absolute-time',
    'world-rule': 'core-rule', knowledge: 'knowledge', memory: 'memory',
};

/**
 * 拆解条目 → 断言。
 *
 * @param entry - 拆解条目
 * @param chapter - 章节号（覆盖）
 * @returns 断言
 */
function toAssertion(entry, chapter = entry.chapter) {
    return {
        id: `fact|${entry.chapter}|${entry.subject}|${entry.predicate}|${chapter}`,
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
    };
}

const baseAssertions = batch.entries.map(entry => toAssertion(entry));

/**
 * 跑一次审核并只取「非视角」矛盾（视角检测依赖正文，本次不评）。
 *
 * @param assertions - 断言
 * @returns 矛盾列表
 */
async function audit(assertions) {
    const report = await runAudit({ assertions, chapters: [], factTexts: [] });
    return report.contradictions;
}

console.log(`真实数据基线：${batch.entries.length} 条事实 / ${batch.ok} 章`);
const baseline = await audit(baseAssertions);
console.log(`真实数据误报：${baseline.length} 条`);
for (const c of baseline.slice(0, 8)) {
    console.log(`  [${c.kind}] ${c.subject}·${c.predicate} · ${c.reasoning.slice(0, 60)}`);
}

// ① 注入 10 处矛盾：同一主体谓词在更晚章节给出冲突值
// 注入目标限定为「有确定性规则覆盖」的类型（age → quantitative R1 年龄倒退）：
// 地点/关系/记忆类目前没有跨章数值规则，注入它们只能测出「规则缺失」而非框架问题。
const candidates = batch.entries.filter(e => e.type === 'age');
const injected = [];
const injectedPairs = [];
for (let i = 0; i < Math.min(10, candidates.length); i += 1) {
    if (injected.length >= 10) break;
    const source = candidates[i];
    const later = Math.max(...batch.entries.map(e => e.chapter)) + 5 + i;
    const conflicting = { ...source, chapter: later, value: `${source.value}（冲突注入）`, quote: `注入冲突：${source.quote}` };
    injectedPairs.push({ source, later });
    injected.push(toAssertion(conflicting, later));
}

const withContradictions = [...baseAssertions, ...injected];
const contradictionFindings = await audit(withContradictions);
const detected = contradictionFindings.filter(c => injectedPairs.some(pair =>
    c.evidenceB.chapterKey === `第${pair.later}章` || c.evidenceA.chapterKey === `第${pair.later}章`));
console.log(`\n① 注入矛盾 ${injected.length} 处 → 检出 ${detected.length} 处（召回 ${((detected.length / injected.length) * 100).toFixed(0)}%）`);
for (const c of detected.slice(0, 5)) {
    console.log(`  ✓ [${c.kind}] ${c.reasoning.slice(0, 70)}`);
}

// ② 注入 10 处合法变化：能力进阶（更高等级）——不应报
const abilityEntries = batch.entries.filter(e => e.type === 'ability');
const legal = [];
const legalPairs = [];
const RANK = [['练气', 10], ['筑基', 20], ['金丹', 30], ['元婴', 40]];
for (let i = 0; i < Math.min(10, abilityEntries.length); i += 1) {
    if (legal.length >= 10) break;
    const source = abilityEntries[i];
    const later = Math.max(...batch.entries.map(e => e.chapter)) + 3 + i;
    const [name, rank] = RANK[Math.min(RANK.length - 1, 1 + (i % 3))];
    legal.push(toAssertion({ ...source, chapter: later, value: `${name}一层`, quote: `合法进阶：${name}一层` }, later));
    legalPairs.push({ source, later });
}
const withLegal = [...baseAssertions, ...legal];
const legalFindings = await audit(withLegal);
const legalFlagged = legalFindings.filter(c => legalPairs.some(pair =>
    c.evidenceB.chapterKey === `第${pair.later}章` || c.evidenceA.chapterKey === `第${pair.later}章`));
console.log(`\n② 注入合法变化 ${legal.length} 处 → 误报 ${legalFlagged.length} 处（应为 0）`);
for (const c of legalFlagged.slice(0, 5)) {
    console.log(`  ✗ [${c.kind}] ${c.reasoning.slice(0, 70)}`);
}

console.log('\n===== 汇总 =====');
console.log(`真实基线误报: ${baseline.length}`);
console.log(`注入矛盾召回: ${detected.length}/${injected.length}`);
console.log(`合法变化误报: ${legalFlagged.length}/${legal.length}`);
console.log(`合计误报率(相对真实基线+合法集): ${((baseline.length + legalFlagged.length) / (batch.entries.length + legal.length) * 100).toFixed(2)}%`);

fs.writeFileSync(path.join(pluginDir, 'docs/analysis/longform-eval-result.json'), JSON.stringify({
    chapters: batch.ok,
    realFacts: batch.entries.length,
    baselineFalsePositives: baseline.length,
    injectedContradictions: injected.length,
    detected,
    recall: injected.length ? detected.length / injected.length : 0,
    legalChanges: legal.length,
    legalFalsePositives: legalFlagged.length,
}, null, 2));
console.log('已写入 docs/analysis/longform-eval-result.json');
