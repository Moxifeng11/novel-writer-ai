export interface DiversityAnalysis {
    needsAdjustment: boolean;
    hints: string[];
    mergedHint: string;
    metrics: {
        sentenceLengthStd: number;
        openingRepeatCount: number;
        structureRepeatCount: number;
    };
}

const SVO_SUBJECTS = new Set(['他', '她', '它', '我', '你']);

const COMMON_VERBS = new Set([
    '是', '有', '去', '来', '看', '说', '想', '做', '走', '拿',
    '放', '打', '吃', '喝', '写', '读', '听', '见', '知', '觉',
    '感', '发', '出', '进', '回', '过', '起', '到', '让', '使',
    '把', '被', '给', '对', '向', '从', '在', '用', '以', '为',
    '能', '会', '可', '要', '应', '该', '当', '得', '着', '了',
    '跑', '跳', '飞', '游', '爬', '坐', '站', '躺', '跪', '蹲',
    '笑', '哭', '叫', '喊', '问', '答', '唱', '骂', '吼', '叹',
    '推', '拉', '扯', '撕', '抓', '握', '抱', '举', '扔', '摔',
    '杀', '砍', '刺', '劈', '射', '烧', '炸', '砸', '撞', '踩',
    '找', '寻', '追', '逃', '躲', '藏', '跟', '随', '带', '领',
    '送', '收', '交', '递', '传', '寄', '买', '卖', '换', '借',
    '开', '关', '锁', '盖', '包', '装', '拆', '修', '补', '缝',
    '种', '养', '喂', '煮', '炒', '烤', '蒸', '切', '剁', '拌',
    '画', '刻', '雕', '印', '染', '织', '编', '绣', '剪', '贴',
    '算', '数', '量', '称', '测', '试', '验', '查', '检', '核',
    '记', '忘', '忆', '思', '虑', '猜', '疑', '信', '认', '识',
    '爱', '恨', '怕', '怒', '喜', '悲', '忧', '愁', '烦', '厌',
    '求', '请', '劝', '逼', '催', '拦', '挡', '阻', '止', '禁',
    '帮', '助', '救', '护', '保', '守', '防', '卫', '攻', '击',
    '变', '改', '换', '调', '转', '移', '动', '摇', '晃', '摆',
]);

export class SentenceDiversityEngine {
    analyzeDiversity(sentences: string[]): DiversityAnalysis {
        if (!sentences || sentences.length < 2) {
            return {
                needsAdjustment: false,
                hints: [],
                mergedHint: '',
                metrics: {
                    sentenceLengthStd: 0,
                    openingRepeatCount: 0,
                    structureRepeatCount: 0,
                },
            };
        }

        const metrics = {
            sentenceLengthStd: this.calcSentenceLengthStd(sentences),
            openingRepeatCount: this.detectOpeningRepeat(sentences),
            structureRepeatCount: this.detectStructureRepeat(sentences),
        };

        const hints = this.generateHints(metrics);
        const needsAdjustment = hints.length > 0;
        const mergedHint = hints.join('；');

        return { needsAdjustment, hints, mergedHint, metrics };
    }

    private calcSentenceLengthStd(sentences: string[]): number {
        const recent = sentences.slice(-3);
        const lengths = recent.map(s => s.length);
        const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
        const variance = lengths.reduce((sum, len) => sum + (len - mean) ** 2, 0) / lengths.length;
        return Math.sqrt(variance);
    }

    private detectOpeningRepeat(sentences: string[]): number {
        let count = 0;
        for (let i = 1; i < sentences.length; i++) {
            const prev = sentences[i - 1].slice(0, 2);
            const curr = sentences[i].slice(0, 2);
            if (prev.length >= 2 && curr.length >= 2 && prev === curr) {
                count++;
            }
        }
        return count;
    }

    private detectStructureRepeat(sentences: string[]): number {
        const isSVO = (s: string): boolean => {
            if (s.length < 2) return false;
            if (!SVO_SUBJECTS.has(s[0])) return false;
            return [...s].some(c => COMMON_VERBS.has(c));
        };

        let count = 0;
        for (let i = 1; i < sentences.length; i++) {
            if (isSVO(sentences[i - 1]) && isSVO(sentences[i])) {
                count++;
            }
        }
        return count;
    }

    private generateHints(metrics: DiversityAnalysis['metrics']): string[] {
        const hints: string[] = [];

        if (metrics.sentenceLengthStd < 5) {
            hints.push('请写一个极短句（3-8字）或极长句（30-50字），打破句长均匀');
        }

        if (metrics.openingRepeatCount > 0) {
            hints.push('请变换句式开头，避免连续以相同词语开头');
        }

        if (metrics.structureRepeatCount > 0) {
            hints.push('请变换句式，以状语/连词/对话开头');
        }

        return hints;
    }
}
