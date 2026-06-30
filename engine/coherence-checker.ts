/**
 * coherence-checker.ts — C3 连贯 / 冗余轻审查（同步，不调 AI）
 *
 * 职责：在写作过程中快速检测正文中的冗余与重复：
 *   1. 重复句子（与前文几乎一致的句子）
 *   2. 高频重复短语（4字以上子串）
 *   3. 过度使用的词（在短窗口内出现多次的实词）
 *
 * 不依赖 AI，可在输入/插入/保存后实时调用。
 */

export interface CoherenceIssue {
    type: 'duplicate_sentence' | 'repeated_phrase' | 'overused_word';
    message: string;
    sample: string;
    count: number;
}

export interface CoherenceReport {
    issues: CoherenceIssue[];
    sentenceCount: number;
    checkedAt: number;
}

const SENTENCE_SPLIT = /[\u3002\uff01\uff1f\uff1b\n]+/;
// 常见虚词 / 停用词，不计入过度使用检测
const STOPWORDS = new Set([
    '\u7684', '\u4e86', '\u662f', '\u5728', '\u6211', '\u4f60', '\u4ed6', '\u5979', '\u5b83', '\u4eec',
    '\u8fd9', '\u90a3', '\u548c', '\u4e0e', '\u4e5f', '\u90fd', '\u5c31', '\u8fd8', '\u4e0d', '\u6ca1',
    '\u4e00\u4e2a', '\u4ec0\u4e48', '\u600e\u4e48', '\u53ef\u4ee5', '\u6240\u4ee5', '\u56e0\u4e3a', '\u4f46\u662f', '\u8fd9\u6837',
    '\u8d77\u6765', '\u4e0b\u53bb', '\u4e00\u4e9b', '\u81ea\u5df1', '\u4e8e\u662f', '\u7136\u540e'
]);

function normalize(sentence: string): string {
    return sentence.replace(/[\s\u3000\uff0c\u3001\u201c\u201d\u2018\u2019\uff08\uff09\u2014\u2026]/g, '').trim();
}

export function analyzeCoherence(body: string, recentWindow = 1500): CoherenceReport {
    const issues: CoherenceIssue[] = [];
    const text = (body || '').slice(-recentWindow);
    const rawSentences = text.split(SENTENCE_SPLIT).map(s => s.trim()).filter(s => s.length >= 6);
    const norm = rawSentences.map(normalize).filter(s => s.length >= 6);

    // 1. 重复句子
    const seen = new Map<string, number>();
    for (const s of norm) {
        seen.set(s, (seen.get(s) || 0) + 1);
    }
    for (const [s, c] of seen) {
        if (c >= 2) {
            issues.push({
                type: 'duplicate_sentence',
                message: `有句子重复出现 ${c} 次，考虑合并或删除`,
                sample: s.slice(0, 24),
                count: c
            });
        }
    }

    // 2. 高频重复短语（4-6 字子串）
    const phraseCounts = new Map<string, number>();
    const plain = norm.join('');
    const N = 4;
    for (let i = 0; i + N <= plain.length; i++) {
        const gram = plain.slice(i, i + N);
        if (/^[\u4e00-\u9fa5]{4}$/.test(gram)) {
            phraseCounts.set(gram, (phraseCounts.get(gram) || 0) + 1);
        }
    }
    const phraseHits = [...phraseCounts.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [gram, c] of phraseHits) {
        issues.push({
            type: 'repeated_phrase',
            message: `短语「${gram}」在近文重复 ${c} 次`,
            sample: gram,
            count: c
        });
    }

    // 3. 过度使用的词（2-3 字实词）
    const wordCounts = new Map<string, number>();
    const tokens = plain.match(/[\u4e00-\u9fa5]{2,3}/g) || [];
    for (const t of tokens) {
        if (STOPWORDS.has(t)) continue;
        wordCounts.set(t, (wordCounts.get(t) || 0) + 1);
    }
    const wordHits = [...wordCounts.entries()].filter(([, c]) => c >= 5).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [w, c] of wordHits) {
        issues.push({
            type: 'overused_word',
            message: `词「${w}」在近文出现 ${c} 次，考虑换个说法`,
            sample: w,
            count: c
        });
    }

    return { issues, sentenceCount: rawSentences.length, checkedAt: Date.now() };
}
