import type { ChapterStateSnapshot } from './story-state-types';

/** 冲突类型 */
export type ConflictType = 'character' | 'timeline' | 'foreshadow' | 'location';

/** 单个冲突详情 */
export interface Conflict {
    type: ConflictType;
    message: string;
    detail: string;
}

/** 冲突检测选项 */
export interface ConflictDetectorOptions {
    knownCharacters?: string[];
    appearingCharacters?: string[];
    /** 已知地点库（程序规则层地点冲突检测用） */
    knownLocations?: string[];
    previousTimeValue?: number;
    /**
     * P2 第二意见（可选）：正则给出时间声称值时，由事实库判断是否与已记录事实一致。
     * `consistent` 抑制该冲突；`unknown` 不抑制（不能因为没数据就放过）。
     */
    adviseTimeline?: (claim: { value: string; chapterNum: number }) => {
        status: 'consistent' | 'conflict' | 'unknown';
        reason: string;
    };
    /**
     * P2 第二意见（扩面：地点/实体状态）：由事实库回答某主体属性是否一致。
     * 与 adviseTimeline 同一状态语义（consistent 抑制 / unknown 不干预）。
     */
    adviseState?: (claim: { subject: string; predicate?: string; chapter: number; value: string }) => {
        status: 'consistent' | 'conflict' | 'unknown';
        reason: string;
    };
    /**
     * P2 第二意见（能力/修为）：按等级序判断，进阶合法不报、倒退才报。
     */
    /**
     * 剧变关键词分组（内置 + 用户追加）。
     * 不传时用内置词表；设置界面追加的词由此进入。
     */
    drasticChangeGroups?: ReadonlyArray<{ group: string; words: readonly string[] }>;
    adviseAbility?: (claim: { subject: string; chapter: number; value: string }) => {
        status: 'consistent' | 'conflict' | 'unknown';
        reason: string;
    };
}

/** 弱提示规则的正文长度门槛（低于此长度的文本不触发未提及类弱冲突，避免误报） */
const MIN_BODY_LEN_FOR_WEAK_RULES = 200;

/** 人物状态剧变关键词分组（无依据检测用） */
const DRASTIC_CHANGE_KEYWORDS: Array<{ group: string; words: string[] }> = [
    { group: '死亡', words: ['死了', '身亡', '陨落', '丧命', '气绝'] },
    { group: '重伤', words: ['重伤', '断臂', '重伤垂危'] },
    { group: '能力变化', words: ['突破', '晋升', '进阶', '顿悟'] },
];

/**
 * ConflictDetector — 程序规则层冲突检测器
 * 对应 spec: story-quality-closed-loop-optimization 第 2.2 节。
 *
 * 纯程序判断：检测人物/时间线/伏笔/地点冲突。无网络、无副作用。
 * 弱提示类规则（未提及设定地点/计划回收伏笔未出现）有正文长度门槛，
 * 避免短文本或尚未写到对应段落时的误报。
 */
export class ConflictDetector {
    /**
     * 检测正文与快照之间的冲突。
     * @param snapshot 章节状态快照
     * @param body 正文内容
     * @param options 检测选项
     * @returns 结果数组
     */
    detect(
        snapshot: ChapterStateSnapshot,
        body: string,
        options: ConflictDetectorOptions = {}
    ): Conflict[] {
        const text = typeof body === 'string' ? body : '';
        const conflicts: Conflict[] = [];

        this.detectTimeline(snapshot, options, conflicts);
        this.detectForbiddenReveals(snapshot, text, conflicts);
        this.detectUnknownCharacters(options, conflicts);
        this.detectLocation(snapshot, text, options, conflicts);
        this.detectMissingRequiredReveals(snapshot, text, conflicts);
        this.detectUnbackedDrasticChange(snapshot, text, options, conflicts);

        return conflicts;
    }

    private detectTimeline(
        snapshot: ChapterStateSnapshot,
        options: ConflictDetectorOptions,
        conflicts: Conflict[]
    ): void {
        const prev = options.previousTimeValue;
        if (prev === undefined || prev === null) return;

        const current = this.parseTimeValue(snapshot?.timeline?.time);
        if (current === null) return;

        if (current < prev) {
            conflicts.push({
                type: 'timeline',
                message: '时间线倒退',
                detail: `当前时间(${current}) 早于上一章时间(${prev})`,
            });
        }
    }

    private detectForbiddenReveals(
        snapshot: ChapterStateSnapshot,
        body: string,
        conflicts: Conflict[]
    ): void {
        const reveals = Array.isArray(snapshot?.forbiddenReveals) ? snapshot.forbiddenReveals : [];
        for (const reveal of reveals) {
            if (this.isMentioned(body, reveal)) {
                conflicts.push({
                    type: 'foreshadow',
                    message: '禁止揭示内容提前出现',
                    detail: reveal,
                });
            }
        }
    }

    private detectUnknownCharacters(
        options: ConflictDetectorOptions,
        conflicts: Conflict[]
    ): void {
        const appearing = Array.isArray(options.appearingCharacters) ? options.appearingCharacters : [];
        const known = Array.isArray(options.knownCharacters) ? options.knownCharacters : [];
        if (appearing.length === 0) return;

        for (const name of appearing) {
            if (!name) continue;
            if (!known.includes(name)) {
                conflicts.push({
                    type: 'character',
                    message: '人物不在设定库',
                    detail: name,
                });
            }
        }
    }

    /**
     * 地点冲突检测（checklist 待补项）。
     * 规则1（强）：knownLocations 中非设定地点出现在正文，且正文未提及设定地点 → 场景地点与设定不符。
     * 规则2（弱）：正文足够长但完全未提及设定地点 → 提示核对（有长度门槛防短文本误报）。
     */
    private detectLocation(
        snapshot: ChapterStateSnapshot,
        body: string,
        options: ConflictDetectorOptions,
        conflicts: Conflict[]
    ): void {
        const setting = (snapshot?.timeline?.location || '').trim();
        if (!setting || !body) return;

        const mentionsSetting = body.includes(setting);

        // 规则1：明确场景地点不符
        const known = Array.isArray(options.knownLocations) ? options.knownLocations : [];
        for (const loc of known) {
            const target = (loc || '').trim();
            if (!target || target === setting) continue;
            if (body.includes(target) && !mentionsSetting) {
                // P2 第二意见（扩面）：事实库若显示该地点在第本节点确为有效场景，
                // 说明是原文合理的换场/回忆，不应判为「场景地点不符」。
                const advice = options.adviseState?.({
                    subject: '场景',
                    predicate: '地点',
                    chapter: 0,
                    value: target,
                });
                if (advice?.status === 'consistent') return;
                conflicts.push({
                    type: 'location',
                    message: '场景地点与本章设定不符',
                    detail: `正文出现地点「${target}」，但本章设定地点为「${setting}」`
                        + (advice?.status === 'conflict' ? `；事实库：${advice.reason}` : ''),
                });
                return;
            }
        }

        // 规则2：长正文未提及设定地点（弱提示）
        if (!mentionsSetting && body.length >= MIN_BODY_LEN_FOR_WEAK_RULES) {
            conflicts.push({
                type: 'location',
                message: '正文未提及本章设定地点，请核对',
                detail: `本章设定地点：${setting}`,
            });
        }
    }

    /**
     * 伏笔状态未正确更新检测（checklist 待补项）：
     * 本章计划回收（requiredReveals）的伏笔在足够长的正文中完全未出现 → 提示核对。
     */
    private detectMissingRequiredReveals(
        snapshot: ChapterStateSnapshot,
        body: string,
        conflicts: Conflict[]
    ): void {
        if (body.length < MIN_BODY_LEN_FOR_WEAK_RULES) return;
        const required = Array.isArray(snapshot?.requiredReveals) ? snapshot.requiredReveals : [];

        for (const name of required) {
            if (!name || body.includes(name)) continue;
            conflicts.push({
                type: 'foreshadow',
                message: '本章计划回收的伏笔未在正文中出现，请核对',
                detail: `伏笔：${name}`,
            });
        }
    }

    /**
     * 人物状态剧变无依据检测（checklist 待补项）：
     * 出场人物与剧变关键词（死亡/重伤/能力变化）同段共现，
     * 且快照中该人物的 emotion/injury 无任何相关迹象 → 提示核实铺垫依据。
     */
    private detectUnbackedDrasticChange(
        snapshot: ChapterStateSnapshot,
        body: string,
        options: ConflictDetectorOptions,
        conflicts: Conflict[]
    ): void {
        const appearing = Array.isArray(options.appearingCharacters)
            ? options.appearingCharacters.filter(Boolean)
            : [];
        if (appearing.length === 0 || !body) return;

        const states = Array.isArray(snapshot?.characterStates) ? snapshot.characterStates : [];
        const paragraphs = body.split(/\r?\n/);

        for (const name of appearing) {
            const state = states.find((s) => s.name === name);
            // 未知人物已由「人物不在设定库」规则覆盖，此处只查已知人物
            if (!state) continue;

            const groups = options.drasticChangeGroups ?? DRASTIC_CHANGE_KEYWORDS;
            for (const { group, words } of groups) {
                const mentioned = words.find((w) =>
                    paragraphs.some((p) => p.includes(name) && p.includes(w))
                );
                if (!mentioned) continue;
                // ① 结构化优先：快照已声明该维度时，以结构化字段为准（不靠词表猜）
                if (this.structuredStateCovers(group, state)) continue;
                // ② 有铺垫迹象（emotion/injury 非空即视为人物已有状态描述）则不报
                if ((state.emotion || '').trim() !== '' || (state.injury || '').trim() !== '') continue;
                // P2 第二意见：能力变化若与事实库等级序一致（合法进阶），不报
                if (group === '能力变化' && options.adviseAbility) {
                    const advice = options.adviseAbility({ subject: name, chapter: 0, value: mentioned });
                    if (advice.status === 'consistent') continue;
                }
                conflicts.push({
                    type: 'character',
                    message: '人物状态剧变缺乏前置铺垫，请核实依据',
                    detail: `「${name}」出现「${group}」（${mentioned}），但人物状态快照无相关迹象`,
                });
                break;
            }
        }
    }

    /**
     * 快照的结构化字段是否已覆盖该组剧变（覆盖则不再靠词表告警）。
     *
     * 例：快照 lifeState='dead' 时，「死了/身亡」这类词命中属预期，不必报；
     * 快照 injuryLevel='severe' 时，「重伤/断臂」同理。
     *
     * @param group - 剧变分组名
     * @param state - 人物状态摘要
     * @returns 是否已被结构化字段覆盖
     */
    private structuredStateCovers(
        group: string,
        state: { lifeState?: string; injuryLevel?: string },
    ): boolean {
        if (group === '死亡') return state.lifeState === 'dead';
        if (group === '重伤') {
            return state.injuryLevel === 'severe' || state.injuryLevel === 'critical';
        }
        // 能力变化已由事实库等级序判定（adviseAbility），此处不靠结构化字段
        return false;
    }

    private isMentioned(body: string, phrase: string): boolean {
        if (!body || !phrase) return false;
        const target = phrase.trim();
        if (target === '') return false;
        if (body.includes(target)) return true;

        const parts = target
            .split(/[，,。.；;、\s（）()【】\[\]]+/)
            .map((p) => p.trim())
            .filter((p) => p.length >= 2);

        return parts.some((p) => body.includes(p));
    }

    private parseTimeValue(raw?: string): number | null {
        if (typeof raw !== 'string' || raw.trim() === '') return null;
        const m = raw.match(/\d+/);
        return m ? Number(m[0]) : null;
    }
}
