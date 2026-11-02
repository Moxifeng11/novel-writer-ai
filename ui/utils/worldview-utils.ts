/**
 * worldview-utils.ts — 世界观元数据提取工具
 *
 * 从 full-writer-view.ts 提取，消解与 batch-chapters-modal / write-chapter-modal 的循环依赖。
 * 纯函数，无外部依赖。
 *
 * 循环依赖链（已消解）：
 *   链1: full-writer-view → unified-workspace → write-chapter-modal → extractWorldviewMeta → full-writer-view
 *   链2: full-writer-view → sidebar-component → write-chapter-modal → extractWorldviewMeta → full-writer-view
 *   链3: full-writer-view → sidebar-component → batch-chapters-modal → extractWorldviewMeta → full-writer-view
 *
 * @param rawWorldview - 原始世界观
 * @returns 世界观元信息
 */

export function extractWorldviewMeta(rawWorldview: string): {
    worldType: string;
    worldEra: string;
    forbiddenElements: string;
    powerSystem: string;
    fallbackSettingLib: string;
} {
    const text = rawWorldview || '';
    const result = {
        worldType: '',
        worldEra: '',
        forbiddenElements: '',
        powerSystem: '',
        fallbackSettingLib: '',
    };

    if (!text.trim()) return result;

    // 从标题或内容提取世界类型
    const typePatterns: { keys: string[]; type: string }[] = [
        { keys: ['修仙', '修真', '玄幻', '仙侠'], type: '修仙' },
        { keys: ['科幻', '星际', '未来', '赛博'], type: '科幻' },
        { keys: ['都市异能', '都市'], type: '都市异能' },
        { keys: ['历史', '古代', '架空历史'], type: '历史' },
        { keys: ['奇幻', '魔法', '西幻'], type: '奇幻' },
        { keys: ['末日', '末世', '废土'], type: '末日' },
        { keys: ['灵异', '恐怖', '惊悚'], type: '灵异' },
        { keys: ['游戏', '电竞'], type: '游戏' },
    ];

    for (const { keys, type } of typePatterns) {
        for (const k of keys) {
            if (text.includes(k)) {
                result.worldType = type;
                break;
            }
        }
        if (result.worldType) break;
    }

    // 提取时代背景
    const eraMatch = text.match(/(?:时代背景|时代|背景)[：:]\s*(.+?)(?:\n|%%)/);
    if (eraMatch) {
        result.worldEra = eraMatch[1].trim().slice(0, 200);
    } else {
        // 回退：取第一段作为时代背景
        const firstPara = text.match(/^#.+?\n\n(.+?)(?:\n\n|%%)/s);
        if (firstPara) {
            result.worldEra = firstPara[1].trim().slice(0, 200);
        }
    }

    // 提取力量体系
    const powerMatch = text.match(/(?:力量体系|修炼体系|等级体系|等级|境界)[：:]\s*([\s\S]+?)(?=\n##|\n#|%%)/);
    if (powerMatch) {
        result.powerSystem = powerMatch[1].trim().slice(0, 500);
    }

    // 根据世界类型生成禁用要素
    const forbiddenMap: Record<string, string> = {
        '修仙': '手机、电脑、汽车、飞机、现代科技产品、现代通讯设备',
        '科幻': '飞剑、法术、仙气、灵力、魔法阵、修仙体系',
        '都市异能': '仙术、灵力、修仙体系、魔法阵',
        '历史': '现代科技、手机、电脑、互联网、汽车',
        '奇幻': '现代科技、手机、电脑、现代武器',
        '末日': '和平社会制度、正常城市运转、现代文明设施',
        '灵异': '高科技武器、未来科技',
        '游戏': '现实世界超能力、修仙体系',
    };
    result.forbiddenElements = forbiddenMap[result.worldType] || '';

    // 从世界观提取设定库回退内容（力量体系、世界架构、时代背景相关段落）
    const sections: string[] = [];
    const headers = ['力量体系', '世界架构', '时代背景', '世界观基础', '核心设定', '世界背景'];
    for (const h of headers) {
        const re = new RegExp(`##\\s*${h}[\\s\\S]*?(?=\n##|%%)`, 'i');
        const m = text.match(re);
        if (m) sections.push(m[0].trim().slice(0, 800));
    }
    if (sections.length === 0) {
        result.fallbackSettingLib = text.slice(0, 2000);
    } else {
        result.fallbackSettingLib = sections.join('\n\n');
    }

    return result;
}
