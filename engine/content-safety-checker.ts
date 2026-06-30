export type ContentSafetyIssueType = 'draft_artifact' | 'tone_break' | 'modern_term' | 'platform_risk';
export type ContentSafetySeverity = 'high' | 'medium' | 'low';

export interface ContentSafetyIssue {
    type: ContentSafetyIssueType;
    severity: ContentSafetySeverity;
    message: string;
    sample: string;
    suggestion: string;
}

export interface ContentSafetyReport {
    issues: ContentSafetyIssue[];
    paragraphCount: number;
}

interface Rule {
    type: ContentSafetyIssueType;
    severity: ContentSafetySeverity;
    pattern: RegExp;
    message: string;
    suggestion: string;
}

const RULES: Rule[] = [
    {
        type: 'draft_artifact',
        severity: 'high',
        pattern: /(TODO|TBD|FIXME|待补|待完善|此处略|这里补|XXX|【待|\[待)/i,
        message: '检测到草稿占位或未清理标记',
        suggestion: '将占位符替换为正文内容，避免进入最终稿。'
    },
    {
        type: 'draft_artifact',
        severity: 'high',
        pattern: /(作为AI|我是AI|以下是|下面是|生成如下|这段文字|本章主要讲述)/i,
        message: '检测到 AI/说明文口吻残留',
        suggestion: '删除说明性话语，改为角色行动、感知或叙述推进。'
    },
    {
        type: 'tone_break',
        severity: 'medium',
        pattern: /(yyds|绝绝子|破防了|栓Q|emo了|蚌埠住|笑死|牛逼|卧槽|社死|离谱)/i,
        message: '检测到可能跳戏的网络口语',
        suggestion: '若非现代都市语境，建议改成符合世界观和人物身份的表达。'
    },
    {
        type: 'modern_term',
        severity: 'medium',
        pattern: /(微信|朋友圈|热搜|直播间|短视频|外卖|打卡|扫码|APP|KPI|PPT|CPU|BUG|bug)/i,
        message: '检测到可能违和的现代词',
        suggestion: '确认本书时代/题材是否允许；若不允许，请换成世界观内的等价物。'
    },
    {
        type: 'platform_risk',
        severity: 'low',
        pattern: /(现实政治|真实领导人|真实政党|真实宗教组织|真实公司黑幕)/,
        message: '检测到可能需要谨慎处理的现实指向内容',
        suggestion: '建议虚构化命名与背景，避免把现实主体直接写成剧情冲突对象。'
    }
];

export function analyzeContentSafety(body: string): ContentSafetyReport {
    const paragraphs = body
        .split(/\n+/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

    const issues: ContentSafetyIssue[] = [];
    const seen = new Set<string>();

    for (const paragraph of paragraphs) {
        for (const rule of RULES) {
            const match = paragraph.match(rule.pattern);
            if (!match) continue;

            const sample = extractSample(paragraph, match.index || 0, match[0].length);
            const key = `${rule.type}:${sample}`;
            if (seen.has(key)) continue;
            seen.add(key);

            issues.push({
                type: rule.type,
                severity: rule.severity,
                message: rule.message,
                sample,
                suggestion: rule.suggestion
            });

            if (issues.length >= 12) {
                return { issues, paragraphCount: paragraphs.length };
            }
        }
    }

    return { issues, paragraphCount: paragraphs.length };
}

function extractSample(text: string, index: number, length: number): string {
    const start = Math.max(0, index - 24);
    const end = Math.min(text.length, index + length + 24);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < text.length ? '…' : '';
    return `${prefix}${text.slice(start, end)}${suffix}`;
}
