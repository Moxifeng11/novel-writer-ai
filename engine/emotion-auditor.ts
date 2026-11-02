/**
 * Emotion Auditor — V2 情绪审计
 * 
 * 对正文进行4项情绪维度检测，产出审计报告注入到自检步骤。
 * 
 * 检测项:
 * 1. 情绪变化 — 每场景是否发生情绪变化
 * 2. 心理活动密度 — 是否连续3段无心理活动
 * 3. 关系变化体现 — 对话/互动后关系是否有微妙变化
 * 4. 情绪钩子 — 章节结尾是否有情绪悬念
 */

export interface EmotionAuditResult {
    /** 情绪变化检测 */
    emotionChange: {
        passed: boolean;
        detail: string;
    };
    /** 心理活动密度 */
    psychDensity: {
        passed: boolean;
        consecutiveEmptyCount: number;
        detail: string;
    };
    /** 关系变化体现 */
    relationshipShift: {
        passed: boolean;
        detail: string;
    };
    /** 情绪钩子 */
    emotionHook: {
        passed: boolean;
        detail: string;
    };
    /** 综合评分 */
    overallScore: number;  // 0-100, 越高越好
}

/**
 * 检测段落是否包含心理活动（关键词匹配）
 * @param paragraph - 段落
 * @returns 是否成功
 */
function hasPsychActivity(paragraph: string): boolean {
    const psychPatterns = [
        /想[起着到]/,
        /觉得/,
        /知道/,
        /感觉/,
        /心里/,
        /脑海/,
        /回忆/,
        /意识/,
        /察觉/,
        /明白/,
        /忽然[想到起]/,
        /不禁/,
        /不自觉/,
        /隐隐/,
    ];
    return psychPatterns.some(p => p.test(paragraph));
}

/**
 * 检测段落是否包含身体反应（V2 新增）
 * @param paragraph - 段落
 * @returns 是否成功
 */
function hasBodyReaction(paragraph: string): boolean {
    const bodyPatterns = [
        /心跳/,
        /呼吸/,
        /手指/,
        /掌心/,
        /肩膀/,
        /背[脊后]/,
        /胸口/,
        /喉咙/,
        /眼眶/,
        /拳头/,
        /肌肉/,
        /发抖/,
        /发麻/,
        /发紧/,
        /发烫/,
        /发凉/,
        /收紧/,
        /绷紧/,
        /僵硬/,
    ];
    return bodyPatterns.some(p => p.test(paragraph));
}

/**
 * 检测段落是否包含情绪词汇
 * @param paragraph - 段落
 * @returns 是否成功
 */
function hasEmotionWord(paragraph: string): boolean {
    const emotionPatterns = [
        /愤怒/,
        /恐惧/,
        /害怕/,
        /紧张/,
        /担忧/,
        /焦虑/,
        /兴奋/,
        /喜悦/,
        /悲伤/,
        /绝望/,
        /希望/,
        /厌恶/,
        /惊喜/,
        /仇恨/,
        /爱/,
        /恨/,
        /悔/,
        /疚/,
        /愧/,
    ];
    return emotionPatterns.some(p => p.test(paragraph));
}

/**
 * 检测段落结尾是否有情绪钩子
 * @param closingParagraphs - 结尾段落
 * @returns 是否成功
 */
function hasEmotionHook(closingParagraphs: string[]): boolean {
    const hookPatterns = [
        /但[他是她]不知道/,
        /真正[的之]/,
        /还[在要]/,
        /却[不发]/,
        /只[剩有]/,
        /等[待着]/,
        /即将/,
        /下一/,
        /开始/,
        /来了/,
        /终于/,
    ];
    const text = closingParagraphs.slice(-5).join(' ');
    return hookPatterns.some(p => p.test(text));
}

/**
 * 对正文进行情绪审计
 * @param bodyText - 正文文本
  * @returns EmotionAuditResult 实例
 */
export function auditEmotions(bodyText: string): EmotionAuditResult {
    // 清理 frontmatter
    const cleanText = bodyText.replace(/^---[\s\S]*?---/, '').trim();

    // 按段落分割（按空行或按每段分割）
    const rawParagraphs = cleanText.split(/\n\n+/).filter(p => p.trim().length > 10);
    // 再按单行分割（因为部分正文每段只有一行）
    const paragraphs = cleanText.split(/\n/).filter(p => p.trim().length > 10);

    // 检查1: 情绪变化
    const emotionCheck = auditEmotionChanges(paragraphs);

    // 检查2: 心理活动密度
    const psychCheck = auditPsychDensity(rawParagraphs);

    // 检查3: 关系变化
    const relationCheck = auditRelationshipShift(rawParagraphs);

    // 检查4: 情绪钩子
    const hookCheck = auditEmotionHook(rawParagraphs);

    // 综合评分
    const passedCount = [emotionCheck, psychCheck, relationCheck, hookCheck].filter(r => r.passed).length;
    const score = Math.round((passedCount / 4) * 100);

    return {
        emotionChange: emotionCheck,
        psychDensity: psychCheck,
        relationshipShift: relationCheck,
        emotionHook: hookCheck,
        overallScore: score,
    };
}

function auditEmotionChanges(paragraphs: string[]): EmotionAuditResult['emotionChange'] {
    const emotionParagraphs = paragraphs.filter(p => hasEmotionWord(p) || hasBodyReaction(p));
    const ratio = paragraphs.length > 0 ? emotionParagraphs.length / paragraphs.length : 0;

    if (ratio >= 0.3) {
        return { passed: true, detail: `情绪/身体反应覆盖率 ${Math.round(ratio * 100)}%（≥30%，合格）` };
    }
    return {
        passed: false,
        detail: `情绪/身体反应覆盖率 ${Math.round(ratio * 100)}%（<30%，偏低）。${paragraphs.length} 段中仅 ${emotionParagraphs.length} 段有情绪或身体反应。建议增加生理反应描写和情绪变化。`,
    };
}

function auditPsychDensity(paragraphs: string[]): EmotionAuditResult['psychDensity'] {
    let maxConsecutiveEmpty = 0;
    let currentEmpty = 0;

    for (const p of paragraphs) {
        if (hasPsychActivity(p) || hasEmotionWord(p) || hasBodyReaction(p)) {
            currentEmpty = 0;
        } else {
            currentEmpty++;
            maxConsecutiveEmpty = Math.max(maxConsecutiveEmpty, currentEmpty);
        }
    }

    if (maxConsecutiveEmpty <= 2) {
        return { passed: true, consecutiveEmptyCount: maxConsecutiveEmpty, detail: `最长连续无心理活动段数: ${maxConsecutiveEmpty}（≤2，合格）` };
    }
    return {
        passed: false,
        consecutiveEmptyCount: maxConsecutiveEmpty,
        detail: `最长连续无心理活动段数: ${maxConsecutiveEmpty}（>2，警告）。连续 ${maxConsecutiveEmpty} 段无任何心理活动、情绪词或身体反应。读者可能失去对角色的共情。`,
    };
}

function auditRelationshipShift(paragraphs: string[]): EmotionAuditResult['relationshipShift'] {
    // 检测是否有角色互动段落中缺乏关系变化暗示
    const dialogueParagraphs = paragraphs.filter(p => p.includes('"') || p.includes('"') || p.includes('「'));
    const shiftIndicators = paragraphs.filter(p =>
        /信任|依赖|疏远|亲近|好感|厌恶|防备|猜疑|默契/i.test(p)
    );

    if (dialogueParagraphs.length === 0) {
        return { passed: true, detail: '本章无对话，跳过关系变化检测。' };
    }

    if (shiftIndicators.length > 0 || dialogueParagraphs.length < 3) {
        return { passed: true, detail: `检测到 ${shiftIndicators.length} 处关系暗示（对话 ${dialogueParagraphs.length} 段），合格。` };
    }

    return {
        passed: false,
        detail: `${dialogueParagraphs.length} 段对话中未检测到任何关系变化暗示（信任/疏远/好感/厌恶等词）。建议在对话后加入角色间的微妙关系变化。`,
    };
}

function auditEmotionHook(paragraphs: string[]): EmotionAuditResult['emotionHook'] {
    const closingParagraphs = paragraphs.slice(-10);

    if (hasEmotionHook(closingParagraphs)) {
        return { passed: true, detail: '结尾检测到情绪钩子/悬念元素。' };
    }

    // 回退检查：结尾是否有情绪词
    const hasClosingEmotion = closingParagraphs.some(p => hasEmotionWord(p) || hasBodyReaction(p));
    if (hasClosingEmotion) {
        return { passed: true, detail: '结尾包含情绪描写（虽无显式钩子，但情绪收束自然）。' };
    }

    return {
        passed: false,
        detail: '章节结尾缺少情绪钩子或情绪收束。建议在最后5段内增加一个情绪悬念或身体反应，让读者期待下一章。',
    };
}

/**
 * 格式化为审计报告文本（用于注入自检结果）
 * @param audit - 审计信息
 * @returns 文本结果
 */
export function formatEmotionAuditReport(audit: EmotionAuditResult): string {
    const lines: string[] = [
        '## V2 情绪审计',
        '',
        `15. 情绪变化: ${audit.emotionChange.passed ? '✅ 通过' : '❌ 问题'} — ${audit.emotionChange.detail}`,
        `16. 心理活动密度: ${audit.psychDensity.passed ? '✅ 通过' : '❌ 问题'} — ${audit.psychDensity.detail}`,
        `17. 关系变化体现: ${audit.relationshipShift.passed ? '✅ 通过' : '⚠️ 建议'} — ${audit.relationshipShift.detail}`,
        `18. 情绪钩子: ${audit.emotionHook.passed ? '✅ 通过' : '❌ 问题'} — ${audit.emotionHook.detail}`,
        '',
        `情绪审计综合评分: ${audit.overallScore}/100`,
    ];
    return lines.join('\n');
}
