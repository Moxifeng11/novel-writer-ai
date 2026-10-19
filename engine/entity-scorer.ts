export interface ScoredEntity {
    name: string;
    fields: Record<string, string>;
    type: 'character' | 'faction' | 'location' | 'item';
    formatText: string;
}

export interface EntityResult {
    text: string;
    score: number;
    name: string;
    type: 'character' | 'faction' | 'location' | 'item';
}

const STOP_WORDS = new Set([
    '的', '了', '在', '是', '我', '他', '她', '它', '有', '和',
    '就', '不', '人', '都', '一', '一个', '上', '也', '很',
    '到', '说', '要', '去', '你', '会', '着', '没有', '看',
    '好', '自己', '这'
]);

const RELATION_KEYWORDS = [
    '所属势力', '势力', '师父', '师傅', '徒弟', '弟子',
    '敌人', '仇敌', '对手', '盟友', '朋友', '好友',
    '父亲', '母亲', '儿子', '女儿', '兄弟', '姐妹',
    '妻子', '丈夫', '爱人', '恋人', '师尊', '掌门',
    '掌门', '家主', '少主', '主子', '下属', '部下',
    '敌对势力', '盟友势力', '关系', '交往'
];

const STATUS_KEYWORDS = [
    '当前状态', '状态', '近况', '最新状态'
];

function extractKeywords(text: string): string[] {
    const freq: Map<string, number> = new Map();
    const chars = text.replace(/\s+/g, '');
    const maxLen = 4;

    for (let i = 0; i < chars.length; i++) {
        for (let len = maxLen; len >= 2; len--) {
            if (i + len <= chars.length) {
                const word = chars.slice(i, i + len);
                if (/^[\u4e00-\u9fff]+$/.test(word) && !STOP_WORDS.has(word)) {
                    freq.set(word, (freq.get(word) || 0) + 1);
                }
            }
        }
    }

    return Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([w]) => w);
}

export function scoreAndFilterEntities(
    entities: ScoredEntity[],
    contextText: string,
    topN: number = 8
): EntityResult[] {
    if (entities.length === 0) return [];

    const keywords = extractKeywords(contextText);
    const contextLower = contextText.toLowerCase();

    const scored: EntityResult[] = entities.map(e => {
        const fieldText = Object.values(e.fields).filter(v => v).join(' ');
        const combinedText = e.name + ' ' + fieldText;
        let score = 0;

        for (const kw of keywords) {
            let pos = combinedText.indexOf(kw);
            while (pos !== -1) {
                score++;
                pos = combinedText.indexOf(kw, pos + 1);
            }
        }

        const nameInContext = contextLower.includes(e.name.toLowerCase());
        if (nameInContext) {
            score += 15;
        }

        let relationBoost = 0;
        let statusBoost = 0;
        for (const [key, value] of Object.entries(e.fields)) {
            if (!value) continue;
            const keyLower = key.toLowerCase();
            const valLower = value.toLowerCase();

            for (const rk of RELATION_KEYWORDS) {
                if (keyLower.includes(rk.toLowerCase()) && valLower.length > 1) {
                    relationBoost += 2;
                    for (const other of entities) {
                        if (other.name !== e.name && valLower.includes(other.name.toLowerCase())) {
                            relationBoost += 3;
                            break;
                        }
                    }
                    break;
                }
            }

            for (const sk of STATUS_KEYWORDS) {
                if (keyLower.includes(sk.toLowerCase()) && valLower.length > 2) {
                    statusBoost += 2;
                    break;
                }
            }
        }

        score += relationBoost + statusBoost;

        return { text: e.formatText, score, name: e.name, type: e.type };
    });

    scored.sort((a, b) => b.score - a.score);

    const withScore = scored.filter(e => e.score > 0);
    if (withScore.length >= 3) {
        return withScore.slice(0, topN);
    }

    // 回退：正向分实体不足 3 个时，仍按 topN 上限截断（而非全量），避免无关实体污染上下文
    return scored.slice(0, Math.max(1, topN));
}
