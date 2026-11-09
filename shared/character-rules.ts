/**
 * character-rules.ts — 人物一致性规则表（单一来源）
 *
 * CharacterConsistencyChecker 与 DeviationDetector 过去各维护一套性格/行为/外貌词表，
 * 集合不同导致同一段正文一个引擎报、另一个不报。这里统一词表与匹配原语。
 *
 * 纯函数，不依赖 Obsidian。
 */

/** 性格标签 → 关键词/近义词 */
export const PERSONALITY_TRAITS: Record<string, string[]> = {
    冷漠: ['冷漠', '冷淡', '冷酷', '淡漠', '疏离', '不苟言笑'],
    热情: ['热情', '热心', '开朗', '活泼', '亲热', '热情洋溢'],
    温柔: ['温柔', '柔和', '温和', '柔声', '温柔体贴'],
    暴躁: ['暴躁', '易怒', '火爆', '怒吼', '咆哮', '勃然大怒'],
    沉稳: ['沉稳', '冷静', '镇定', '从容', '沉着', '不动声色'],
    冲动: ['冲动', '鲁莽', '莽撞', '意气用事', '不计后果'],
    勇敢: ['勇敢', '英勇', '无畏', '挺身而出', '奋勇'],
    懦弱: ['懦弱', '胆小', '怯懦', '畏缩', '害怕'],
    聪明: ['聪明', '机智', '聪慧', '睿智', '足智多谋'],
    愚蠢: ['愚蠢', '愚笨', '迟钝', '呆笨', '傻气'],
    狡猾: ['狡猾', '狡诈', '奸诈', '诡计多端', '城府深'],
    老实: ['老实', '忠厚', '诚实', '坦诚', '直率'],
    正直: ['正直', '刚正', '公正', '光明磊落'],
    虚伪: ['虚伪', '虚假', '伪善', '表里不一', '口是心非'],
    豪爽: ['豪爽', '豪迈', '爽快', '不拘小节'],
    细腻: ['细腻', '细致', '体贴', '细心', '周到'],
    霸道: ['霸道', '蛮横', '专横', '强势', '盛气凌人'],
    善良: ['善良', '仁慈', '慈悲', '心软', '乐于助人'],
    邪恶: ['邪恶', '狠毒', '残忍', '心狠手辣', '冷酷无情'],
    内向: ['内向', '沉默', '寡言', '腼腆', '害羞'],
    开朗: ['开朗', '外向', '活泼', '健谈', '乐观'],
};

/** 性格 → 不兼容动作 */
export const BEHAVIOR_PATTERNS: Array<{ trait: string; incompatibleActions: string[] }> = [
    { trait: '冷漠', incompatibleActions: ['激动地说', '热情地', '兴奋地', '感动得', '泪流满面', '激动不已'] },
    { trait: '沉稳', incompatibleActions: ['慌了神', '惊慌失措', '手忙脚乱', '大惊失色', '慌乱'] },
    { trait: '温柔', incompatibleActions: ['怒吼道', '厉声喝道', '勃然大怒', '摔门而去', '暴跳如雷'] },
    { trait: '老实', incompatibleActions: ['狡黠地笑', '眼珠一转', '暗中盘算', '撒谎', '欺骗'] },
    { trait: '正直', incompatibleActions: ['阴险地', '暗算', '偷袭', '不择手段', '耍阴谋'] },
    { trait: '霸道', incompatibleActions: ['唯唯诺诺', '低声下气', '卑躬屈膝', '俯首帖耳'] },
    { trait: '勇敢', incompatibleActions: ['吓得发抖', '缩成一团', '落荒而逃', '胆战心惊'] },
    { trait: '懦弱', incompatibleActions: ['挺身而出', '毫不畏惧', '英勇抗争', '视死如归'] },
];

/** 外貌设定词 → 反义词（同一句共现才判矛盾） */
export const APPEARANCE_CONTRADICTIONS: Array<{ words: string[]; opposite: string[] }> = [
    { words: ['黑发', '乌黑', '墨发'], opposite: ['金发', '白发', '银发', '红发', '棕发'] },
    { words: ['金发', '金色头发'], opposite: ['黑发', '白发', '银发', '红发', '棕发'] },
    { words: ['白发', '银发', '花白'], opposite: ['黑发', '金发', '红发', '棕发'] },
    { words: ['高大', '魁梧', '身高八尺', '人高马大'], opposite: ['瘦小', '矮小', '侏儒', '身高不足五尺'] },
    { words: ['瘦小', '矮小', '瘦弱'], opposite: ['高大', '魁梧', '壮硕', '膀大腰圆'] },
    { words: ['英俊', '帅气', '俊朗', '美男子'], opposite: ['丑陋', '难看', '其貌不扬'] },
    { words: ['美丽', '漂亮', '绝色', '倾城'], opposite: ['丑陋', '难看', '其貌不扬'] },
    { words: ['肥胖', '臃肿', '大腹便便'], opposite: ['清瘦', '苗条', '骨瘦如柴'] },
    { words: ['清瘦', '苗条', '纤细'], opposite: ['肥胖', '臃肿', '壮硕'] },
    { words: ['年轻', '少年', '青年', '二十岁'], opposite: ['年老', '年迈', '白发苍苍', '古稀之年'] },
    { words: ['年老', '年迈', '老者', '老人'], opposite: ['年轻', '少年', '青年'] },
];

/** 能力描述关键词 */
export const ABILITY_KEYWORDS = [
    '功法', '武技', '武功', '法术', '神通', '绝技', '绝招', '秘法',
    '修炼', '修为', '境界', '实力', '功力', '内力', '真气', '灵力',
    '擅长', '精通', '掌握', '炼成', '练成', '习得', '学会',
];

/**
 * 把人物设定文案解析为性格标签集合。
 * 设定常写「冷静」「沉默」「机智」，而词表键是「沉稳」「内向」「聪明」——
 * 只匹配键会让常见写法完全跳过检测。
 *
 * @param personalityDesc - 性格设定
 * @returns 命中的性格标签
 */
export function resolveConfiguredTraits(personalityDesc: string): string[] {
    const traits: string[] = [];
    for (const [trait, keywords] of Object.entries(PERSONALITY_TRAITS)) {
        if (personalityDesc.includes(trait) || keywords.some((kw) => personalityDesc.includes(kw))) {
            traits.push(trait);
        }
    }
    return traits;
}

/**
 * 查找「独立出现」的人物名区间：被更长人物名包住的短名不算命中。
 * 例：目标「林」，全名表含「林惊鸿」时，「林惊鸿拔剑」不算「林」的出场。
 *
 * @param text - 文本
 * @param target - 目标名
 * @param allNames - 全部人物名
 * @returns 区间列表
 */
export function findStandaloneNameRanges(text: string, target: string, allNames: string[]): Array<[number, number]> {
    const source = String(text ?? '');
    const name = String(target ?? '').trim();
    if (!source || !name) return [];
    // 只屏蔽比目标更长的名字：短名被目标包含时不应屏蔽目标
    const longer = [...new Set(allNames.map((item) => String(item ?? '').trim()))]
        .filter((item) => item.length > name.length && item !== name);
    const masked = new Uint8Array(source.length);
    for (const other of longer) {
        let start = source.indexOf(other);
        while (start >= 0) {
            for (let i = start; i < start + other.length; i++) masked[i] = 1;
            start = source.indexOf(other, start + 1);
        }
    }
    const ranges: Array<[number, number]> = [];
    let start = source.indexOf(name);
    while (start >= 0) {
        let free = true;
        for (let i = start; i < start + name.length; i++) {
            if (masked[i]) { free = false; break; }
        }
        if (free) {
            ranges.push([start, start + name.length]);
            for (let i = start; i < start + name.length; i++) masked[i] = 1;
        }
        start = source.indexOf(name, start + 1);
    }
    return ranges;
}

/**
 * 判断文本中是否存在独立的该人物名。
 *
 * @param text - 文本
 * @param target - 目标名
 * @param allNames - 全部人物名
 * @returns 是否命中
 */
export function hasStandaloneName(text: string, target: string, allNames: string[] = []): boolean {
    if (allNames.length === 0) return String(text ?? '').includes(target);
    return findStandaloneNameRanges(text, target, allNames).length > 0;
}

/**
 * 切句：中文标点与换行都作为边界，保留标点。
 *
 * @param text - 文本
 * @returns 句子列表
 */
export function splitSentences(text: string): string[] {
    const parts = String(text ?? '').split(/([。！？!?\n])/);
    const sentences: string[] = [];
    for (let i = 0; i < parts.length; i += 2) {
        const sentence = `${parts[i] ?? ''}${parts[i + 1] ?? ''}`.trim();
        if (sentence) sentences.push(sentence);
    }
    return sentences;
}

/**
 * 取与目标人物相关的句子（句子级归属，避免同段其他角色的话被算到目标头上）。
 *
 * @param text - 文本
 * @param target - 目标名
 * @param allNames - 全部人物名
 * @returns 句子列表
 */
export function sentencesForCharacter(text: string, target: string, allNames: string[] = []): string[] {
    return splitSentences(text).filter((sentence) => hasStandaloneName(sentence, target, allNames));
}

/**
 * 从能力设定中抽取具体能力词（用于无向量时的关键词回退）。
 *
 * @param abilitiesDesc - 能力设定
 * @returns 能力词
 */
export function abilityTerms(abilitiesDesc: string): string[] {
    return [...new Set(String(abilitiesDesc ?? '')
        .split(/[、,，。；;：:\s/|]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2))].slice(0, 12);
}
