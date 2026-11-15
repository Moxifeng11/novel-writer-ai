/**
 * unit-card-model.ts — 短篇「节」/ 剧本「集·场·镜」卡片解析（纯函数）
 *
 * 三模式一视同仁：每节/每集一文件，场与镜作为原子单元。
 * 剧本场标题允许被规范化（补场 ID），正文内容不动。
 */

/** 短篇节卡 */
export interface ShortUnitCard {
    /** 节号（1 起） */
    index: number;
    /** 标题 */
    title: string;
    /** 字段（目标/冲突/信息增量/情绪变化/反转/结尾钩子/预计字数） */
    fields: Record<string, string>;
}

/** 剧本集卡 */
export interface ScriptEpisodeCard {
    /** 集号（1 起） */
    index: number;
    /** 标题 */
    title: string;
    /** 字段（单集时长/核心冲突/爽点反转/结尾钩子/场次数） */
    fields: Record<string, string>;
}

/** 剧本场卡 */
export interface ScriptSceneCard {
    /** 场 ID：EP01-S01 */
    id: string;
    /** 集号 */
    episode: number;
    /** 场内序号 */
    scene: number;
    /** 日/夜 + 内/外 */
    timeOfDay: string;
    /** 场景名 */
    location: string;
    /** 场标题行原文 */
    heading: string;
    /** 人物 */
    characters: string[];
    /** 动作行数 */
    actionLines: number;
    /** 对白行数 */
    dialogueLines: number;
}

/** 分镜卡 */
export interface ShotCard {
    /** 镜号（E01-S01-SH01） */
    shotId: string;
    /** 景别/角度/运镜/时长/画面/动作/台词/音效/转场/目的 */
    fields: Record<string, string>;
}

/** 字段行正则：`- 键：值` 或 `**键**：值` */
const FIELD_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?([^：:*]{1,16})(?:\*\*)?\s*[：:]\s*(.+)$/;

/**
 * 解析短篇分节大纲。
 *
 * @param text - 分节大纲全文
 * @returns 节卡
 */
export function parseShortUnitOutline(text: string): ShortUnitCard[] {
    const cards: ShortUnitCard[] = [];
    const blocks = String(text ?? '').split(/^##\s*第\s*(\d+)\s*节\s*[：:]?\s*(.*)$/m);
    for (let i = 1; i + 2 < blocks.length; i += 3) {
        const index = Number(blocks[i]);
        const title = String(blocks[i + 1] ?? '').trim();
        const body = String(blocks[i + 2] ?? '');
        if (!index) continue;
        cards.push({ index, title, fields: parseFields(body) });
    }
    return cards;
}

/**
 * 解析剧本分集大纲。
 *
 * @param text - 分集大纲全文
 * @returns 集卡
 */
export function parseScriptEpisodeOutline(text: string): ScriptEpisodeCard[] {
    const cards: ScriptEpisodeCard[] = [];
    const blocks = String(text ?? '').split(/^##\s*第\s*(\d+)\s*集\s*[：:]?\s*(.*)$/m);
    for (let i = 1; i + 2 < blocks.length; i += 3) {
        const index = Number(blocks[i]);
        const title = String(blocks[i + 1] ?? '').trim();
        const body = String(blocks[i + 2] ?? '');
        if (!index) continue;
        cards.push({ index, title, fields: parseFields(body) });
    }
    return cards;
}

/**
 * 解析剧本集正文中的场。
 *
 * 兼容 `### 1-1 日/内 山门` 与 `### 01-01 夜/外 后山` 两种写法。
 *
 * @param body - 集正文
 * @param episode - 集号
 * @returns 场卡
 */
export function parseScriptScenes(body: string, episode: number): ScriptSceneCard[] {
    const cards: ScriptSceneCard[] = [];
    const lines = String(body ?? '').split('\n');
    let current: ScriptSceneCard | null = null;
    for (const line of lines) {
        const heading = line.match(/^###\s*(\d+)\s*[-–—]\s*(\d+)\s*(.*)$/);
        if (heading) {
            const scene = Number(heading[2]);
            const rest = heading[3].trim();
            const timeMatch = rest.match(/^(日|夜|晨|昏|晨昏|黄昏|清晨)\s*[/／]\s*(内|外)/);
            const timeOfDay = timeMatch ? `${timeMatch[1]}/${timeMatch[2]}` : '';
            const location = rest.replace(/^(日|夜|晨|昏|晨昏|黄昏|清晨)\s*[/／]\s*(内|外)\s*/, '').trim();
            current = {
                id: `EP${String(episode).padStart(2, '0')}-S${String(scene).padStart(2, '0')}`,
                episode,
                scene,
                timeOfDay,
                location,
                heading: line.trim(),
                characters: [],
                actionLines: 0,
                dialogueLines: 0,
            };
            cards.push(current);
            continue;
        }
        if (!current) continue;
        const trimmed = line.trim();
        if (!trimmed) continue;
        const characterLine = trimmed.match(/^(?:人物|出场人物)\s*[：:]\s*(.+)$/);
        if (characterLine) {
            current.characters = characterLine[1].split(/[、，,;；/]+/).map(name => name.trim()).filter(Boolean);
            continue;
        }
        if (trimmed.startsWith('△')) current.actionLines += 1;
        else if (/^[\u4e00-\u9fa5A-Za-z0-9·]{1,12}\s*[：:]/.test(trimmed)) current.dialogueLines += 1;
    }
    return cards;
}

/**
 * 规范化剧本场标题（补场 ID，正文不动）。
 *
 * 把 `### 1-1 日/内 山门` 改为 `### 01-01 日/内 山门`；已规范化的保持不变。
 *
 * @param body - 集正文
 * @returns 规范化后的正文
 */
export function normalizeScriptSceneHeadings(body: string): string {
    return String(body ?? '').replace(
        /^###\s*(\d+)\s*[-–—]\s*(\d+)\s*(.*)$/gm,
        (_match, ep: string, sc: string, rest: string) =>
            `### ${String(Number(ep)).padStart(2, '0')}-${String(Number(sc)).padStart(2, '0')}${rest ? ` ${rest.trim()}` : ''}`,
    );
}

/**
 * 解析分镜表。
 *
 * 支持 `E01-S01-SH01` 开头的行，或表头为「镜号」的 markdown 表格。
 *
 * @param text - 分镜表全文
 * @returns 镜卡
 */
export function parseShotList(text: string): ShotCard[] {
    const cards: ShotCard[] = [];
    const lines = String(text ?? '').split('\n');
    let headers: string[] | null = null;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|')) continue;
        const cells = trimmed.split('|').slice(1, -1).map(cell => cell.trim());
        if (cells.length === 0) continue;
        if (!headers) {
            if (cells.some(cell => cell.includes('镜号'))) headers = cells;
            continue;
        }
        if (cells.every(cell => /^:?-{2,}:?$/.test(cell) || cell === '')) continue;
        const shotIdCell = cells[0] ?? '';
        const shotMatch = shotIdCell.match(/^E?(\d+)-S(\d+)-SH(\d+)$/i);
        if (!shotMatch) continue;
        const fields: Record<string, string> = {};
        headers.forEach((header, index) => {
            if (index === 0) return;
            fields[header] = cells[index] ?? '';
        });
        cards.push({ shotId: shotIdCell, fields });
    }
    return cards;
}

/**
 * 解析短篇节文件（单元正文）→ 节卡。
 *
 * @param text - 节文件全文
 * @param index - 节号
 * @returns 节卡
 */
export function parseShortUnitBody(text: string, index: number): ShortUnitCard {
    const source = String(text ?? '');
    const title = source.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
    const fields = parseFields(source);
    const mapped: Record<string, string> = {};
    const keyMap: Record<string, string> = {
        核心冲突: '冲突',
        信息推进: '信息增量',
        情绪转折: '情绪变化',
        结尾钩子: '结尾钩子',
        预计字数: '预计字数',
    };
    for (const [key, value] of Object.entries(fields)) {
        mapped[keyMap[key] ?? key] = value;
    }
    return { index, title, fields: mapped };
}

/**
 * 解析剧本集文件（单元正文）→ 集卡 + 场卡。
 *
 * @param text - 集文件全文
 * @param index - 集号
 * @returns 集卡与场卡
 */
export function parseScriptEpisodeBody(text: string, index: number): { episode: ScriptEpisodeCard; scenes: ScriptSceneCard[] } {
    const source = String(text ?? '');
    const title = source.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
    const fields = parseFields(source);
    const mapped: Record<string, string> = {};
    const keyMap: Record<string, string> = {
        单集时长: '单集时长',
        本集核心冲突: '核心冲突',
        '本集爽点/反转': '爽点反转',
        结尾钩子: '结尾钩子',
    };
    for (const [key, value] of Object.entries(fields)) {
        mapped[keyMap[key] ?? key] = value;
    }
    return {
        episode: { index, title, fields: mapped },
        scenes: parseScriptScenes(source, index),
    };
}

/** 解析字段行 */
function parseFields(body: string): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const line of String(body ?? '').split('\n')) {
        const match = line.match(FIELD_LINE);
        if (!match) continue;
        const key = match[1].trim();
        if (!key) continue;
        fields[key] = match[2].trim();
    }
    return fields;
}

/**
 * 由节卡渲染分节大纲（派生视图）。
 *
 * @param cards - 节卡
 * @returns Markdown
 */
export function renderShortUnitOutline(cards: readonly ShortUnitCard[]): string {
    const lines: string[] = ['# 分节大纲', '', '> 本文件由插件根据各节文件生成，请勿手改。', ''];
    for (const card of cards) {
        lines.push(`## 第${card.index}节${card.title ? `：${card.title}` : ''}`, '');
        for (const [key, value] of Object.entries(card.fields)) lines.push(`- ${key}：${value}`);
        lines.push('');
    }
    return lines.join('\n');
}

/**
 * 由集卡 + 场卡渲染分集大纲（派生视图）。
 *
 * @param episodes - 集卡
 * @param scenes - 场卡
 * @returns Markdown
 */
export function renderScriptOutline(
    episodes: readonly ScriptEpisodeCard[],
    scenes: readonly ScriptSceneCard[] = [],
): string {
    const lines: string[] = ['# 分集大纲', '', '> 本文件由插件根据各集文件生成，请勿手改。', ''];
    for (const episode of episodes) {
        lines.push(`## 第${episode.index}集${episode.title ? `：${episode.title}` : ''}`, '');
        for (const [key, value] of Object.entries(episode.fields)) lines.push(`- ${key}：${value}`);
        const episodeScenes = scenes.filter(scene => scene.episode === episode.index);
        if (episodeScenes.length > 0) {
            lines.push('', '场次：');
            for (const scene of episodeScenes) {
                lines.push(`- ${scene.id} ${scene.timeOfDay} ${scene.location}${scene.characters.length > 0 ? `（${scene.characters.join('、')}）` : ''}`);
            }
        }
        lines.push('');
    }
    return lines.join('\n');
}
