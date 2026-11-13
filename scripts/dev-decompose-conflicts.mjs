/**
 * 用拆解条目做跨章冲突分析（C 臂效能验证）
 *
 * 不接规则层，直接按「同主体 + 同谓词」分组，用有效区间判定是否冲突。
 * 目的：看 30 章真实原著里能找出多少候选矛盾、其中多少像真问题（人工抽检）。
 */
import fs from 'node:fs';
import path from 'node:path';

const file = 'D:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/docs/analysis/knowledge-batch.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

/** 同主体+谓词的互斥判定（与 validRangesConflict 同语义） */
function conflict(a, b) {
    if (a.value === b.value) return false;
    const aEnd = a.validTo;
    const bEnd = b.validTo;
    if (aEnd === null && bEnd === null) return true;
    if (aEnd !== null && aEnd <= b.validFrom) return false;
    if (bEnd !== null && bEnd <= a.validFrom) return false;
    return true;
}

const groups = new Map();
for (const e of data.entries) {
    const key = `${e.subject}|${e.predicate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
}

const candidates = [];
for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((x, y) => x.validFrom - y.validFrom);
    for (let i = 0; i < sorted.length - 1; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
            if (conflict(sorted[i], sorted[j])) {
                candidates.push({ key, a: sorted[i], b: sorted[j] });
            }
        }
    }
}

console.log(`条目 ${data.entries.length} 条 · 分组 ${groups.size} 个 · **候选冲突 ${candidates.length} 处**`);
console.log(`其中有跨章（不同章）的: ${candidates.filter(c => c.a.chapter !== c.b.chapter).length}`);

const byType = {};
for (const c of candidates) byType[c.a.type] = (byType[c.a.type] ?? 0) + 1;
console.log('类型分布:', JSON.stringify(byType));

console.log('\n--- 候选冲突前 12 条（人工抽检）---');
for (const c of candidates.slice(0, 12)) {
    console.log(`[${c.a.type}] ${c.key}`);
    console.log(`   第${c.a.chapter}章: ${c.a.value}  「${c.a.quote.slice(0, 30)}」`);
    console.log(`   第${c.b.chapter}章: ${c.b.value}  「${c.b.quote.slice(0, 30)}」`);
}

// 重复计数（同主体谓词多次出现但值相同 = 正常延续）
const repeats = [...groups.values()].reduce((acc, l) => acc + (l.length > 1 ? 1 : 0), 0);
console.log(`\n出现多次的主体·谓词组: ${repeats} 个（其中 ${candidates.length} 个组合被判冲突）`);
