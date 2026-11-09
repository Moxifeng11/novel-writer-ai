/**
 * ui/co-writing/human-rate.ts — 协同写作「人工率」仪表盘计算与渲染
 *
 * 从 5k 行的 co-writing-view.ts 拆出：输入框实时评分不依赖视图实例，
 * 计算函数是纯函数，便于单测；渲染函数只接收容器。
 */

/** 人工率各维度评分（style = -1 表示尚未由指纹比对评估） */
export interface HumanRateScores {
    overall: number;
    style: number;
    sentenceLength: number;
    opening: number;
    punctuation: number;
    aiWords: number;
}

const AI_HIGH_FREQ_WORDS = [
    '然而', '于是', '随后', '紧接着', '与此同时', '不知为何', '仿佛', '似乎',
    '某种', '莫名', '陡然', '蓦地', '倏地', '旋即', '不由得',
];

/**
 * 根据当前正文末尾计算人工率各维度评分。
 *
 * 只读取文本、不访问视图状态，便于在输入过程中同步调用。
 *
 * @param text - 当前正文
 * @returns 各维度评分
 */
export function calculateHumanRate(text: string): HumanRateScores {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
        // 空正文没有任何可评估证据：基础分必须是 0，而不是各维度默认 100。
        return { overall: 0, style: -1, sentenceLength: 0, opening: 0, punctuation: 0, aiWords: 0 };
    }

    const sentences = trimmed.split(/[。！？；.!?;]/).filter(s => s.trim().length > 0);
    const recent3 = sentences.slice(-3);
    const recent5 = sentences.slice(-5);
    // 少于 2 句无法判断句长波动/开头重复/标点多样性：先保持 0，随正文增长再计算。
    const hasSample = recent3.length >= 2;

    let sentenceLength = 0;
    if (hasSample) {
        sentenceLength = 100;
        const lengths = recent3.map(s => s.length);
        const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
        const variance = lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length;
        const stdDev = Math.sqrt(variance);
        const cv = mean > 0 ? stdDev / mean : 0;
        sentenceLength = Math.max(0, Math.min(100, Math.round(100 - cv * 100)));
    }

    let opening = 0;
    if (hasSample) {
        opening = 100;
        const openings = recent3.map(s => s.trim().slice(0, 2)).filter(o => o.length >= 1);
        const unique = new Set(openings);
        const diversity = openings.length > 0 ? unique.size / openings.length : 1;
        opening = Math.round(diversity * 100);
    }

    let punctuation = 0;
    if (hasSample) {
        punctuation = 100;
        const punctTypes = new Set<string>();
        let totalPunct = 0;
        for (const s of recent5) {
            const matches = s.match(/[，。！？、；：""''《》…—,\.!\?;:'"\-]/g);
            if (matches) {
                totalPunct += matches.length;
                matches.forEach(m => punctTypes.add(m));
            }
        }
        const variety = totalPunct > 0 ? punctTypes.size / Math.min(totalPunct, 10) : 0;
        punctuation = Math.max(30, Math.min(100, Math.round(variety * 100)));
    }

    let aiWords = 0;
    if (hasSample) {
        let aiWordCount = 0;
        const recentText = recent5.join('');
        for (const word of AI_HIGH_FREQ_WORDS) {
            if (recentText.includes(word)) aiWordCount++;
        }
        aiWords = Math.max(40, Math.min(100, Math.round(100 - aiWordCount * 12)));
    }

    // 风格分只能由指纹比对/AI 评估得出，输入时同步计算会阻塞编辑，
    // 因此这里返回 -1 表示「未评估」，并从总分权重中剔除，避免用常数 75 冒充真实分。
    const style = -1;

    const measured = sentenceLength * 0.20 + opening * 0.15 + punctuation * 0.15 + aiWords * 0.10;
    const overall = hasSample ? Math.round(measured / 0.60) : 0;

    return { overall, style, sentenceLength, opening, punctuation, aiWords };
}

/**
 * 把评分渲染到仪表盘容器（会先清空容器）。
 *
 * @param container - 仪表盘容器
 * @param scores - 评分
 */
export function renderHumanRate(container: HTMLElement, scores: HumanRateScores): void {
    container.empty();

    const colorClass = scores.overall >= 85 ? 'nw-hr-high' : scores.overall >= 60 ? 'nw-hr-mid' : 'nw-hr-low';

    const header = container.createDiv({ cls: 'nw-hr-header' });
    header.createSpan({ cls: 'nw-hr-label', text: '人工率' });
    header.createSpan({ cls: `nw-hr-score ${colorClass}`, text: `${scores.overall}%` });

    const bar = container.createDiv({ cls: 'nw-hr-bar' });
    bar.createDiv({ cls: `nw-hr-bar-fill ${colorClass}`, attr: { style: `width: ${scores.overall}%` } });

    const details = container.createDiv({ cls: 'nw-hr-details' });
    details.createSpan({ text: scores.style < 0 ? '风格 未评估' : `风格 ${scores.style}%` });
    details.createSpan({ text: `句长 ${scores.sentenceLength}%` });
    details.createSpan({ text: `开头 ${scores.opening}%` });
    details.createSpan({ text: `标点 ${scores.punctuation}%` });
    details.createSpan({ text: `AI词 ${scores.aiWords}%` });
}
