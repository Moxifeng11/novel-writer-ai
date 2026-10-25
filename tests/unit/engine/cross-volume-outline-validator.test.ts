import { describe, it, expect } from 'vitest';
import {
    CrossVolumeOutlineValidator,
    GlobalStorylineBlueprint,
} from '../../../engine/cross-volume-outline-validator';

const validator = new CrossVolumeOutlineValidator();

function makeVolumeText(overrides: {
    volumeIndex?: number;
    chapterRange?: string;
    characters?: string;
    events?: string;
    foreshadows?: string;
    factions?: string;
    subplot?: string;
}): string {
    const parts: string[] = [];
    parts.push(`### 第${(overrides.volumeIndex ?? 1) + 1}卷`);
    if (overrides.chapterRange) {
        parts.push(`章节范围：${overrides.chapterRange}`);
    }
    if (overrides.characters) {
        parts.push(`## 人物状态\n${overrides.characters}`);
    }
    if (overrides.events) {
        parts.push(`## 关键事件\n${overrides.events}`);
    }
    if (overrides.foreshadows) {
        parts.push(`## 伏笔安排\n${overrides.foreshadows}`);
    }
    if (overrides.factions) {
        parts.push(`## 势力变动\n${overrides.factions}`);
    }
    if (overrides.subplot) {
        parts.push(`## 支线安排\n${overrides.subplot}`);
    }
    return parts.join('\n\n');
}

describe('CrossVolumeOutlineValidator — 章节号连续性', () => {
    it('章节范围首尾相接时无 critical', () => {
        const volumes = [
            makeVolumeText({ volumeIndex: 0, chapterRange: '第1章 - 第10章' }),
            makeVolumeText({ volumeIndex: 1, chapterRange: '第11章 - 第20章' }),
        ];
        const r = validator.validate(volumes, {});
        expect(r.criticalIssues.some(i => i.type === 'chapter_range_gap')).toBe(false);
        expect(r.isValid).toBe(true);
    });

    it('章节范围出现缺口时触发 chapter_range_gap critical', () => {
        const volumes = [
            makeVolumeText({ volumeIndex: 0, chapterRange: '第1章 - 第10章' }),
            makeVolumeText({ volumeIndex: 1, chapterRange: '第15章 - 第25章' }),
        ];
        const r = validator.validate(volumes, {});
        const issue = r.criticalIssues.find(i => i.type === 'chapter_range_gap');
        expect(issue).toBeDefined();
        expect(issue!.severity).toBe('critical');
        expect(r.isValid).toBe(false);
    });

    it('章节范围重叠时触发 chapter_range_gap critical', () => {
        const volumes = [
            makeVolumeText({ volumeIndex: 0, chapterRange: '第1章 - 第10章' }),
            makeVolumeText({ volumeIndex: 1, chapterRange: '第8章 - 第18章' }),
        ];
        const r = validator.validate(volumes, {});
        expect(r.criticalIssues.some(i => i.type === 'chapter_range_gap')).toBe(true);
        expect(r.isValid).toBe(false);
    });
});

describe('CrossVolumeOutlineValidator — 人物一致性', () => {
    it('同一角色先死亡后活跃触发 character_state_conflict critical', () => {
        const volumes = [
            makeVolumeText({ volumeIndex: 0, characters: '**林惊鸿**：在战斗中死亡' }),
            makeVolumeText({ volumeIndex: 1, characters: '**林惊鸿**：出场与反派对话' }),
        ];
        const r = validator.validate(volumes, {});
        const issue = r.criticalIssues.find(i => i.type === 'character_state_conflict');
        expect(issue).toBeDefined();
        expect(issue!.severity).toBe('critical');
        expect(issue!.message).toContain('林惊鸿');
        expect(r.isValid).toBe(false);
    });

    it('角色持续活跃不触发冲突', () => {
        const volumes = [
            makeVolumeText({ volumeIndex: 0, characters: '**林惊鸿**：活跃于京城' }),
            makeVolumeText({ volumeIndex: 1, characters: '**林惊鸿**：继续出场' }),
        ];
        const r = validator.validate(volumes, {});
        expect(r.criticalIssues.some(i => i.type === 'character_state_conflict')).toBe(false);
        expect(r.isValid).toBe(true);
    });

    it('蓝图角色时间线矛盾触发 critical', () => {
        const blueprint: GlobalStorylineBlueprint = {
            characterTimeline: [
                {
                    characterName: '苏白',
                    expectedStates: [
                        { volume: 1, state: '死亡' },
                        { volume: 2, state: '活跃出场' },
                    ],
                },
            ],
        };
        const volumes = [
            makeVolumeText({ volumeIndex: 0 }),
            makeVolumeText({ volumeIndex: 1 }),
        ];
        const r = validator.validate(volumes, blueprint);
        const issue = r.criticalIssues.find(i => i.type === 'character_state_conflict');
        expect(issue).toBeDefined();
        expect(issue!.message).toContain('苏白');
        expect(r.isValid).toBe(false);
    });
});

describe('CrossVolumeOutlineValidator — 主线事件衔接', () => {
    it('转折点缺失触发 turning_point_missing critical', () => {
        const blueprint: GlobalStorylineBlueprint = {
            turningPoints: [
                { name: '宗门覆灭', expectedVolume: 2 },
            ],
        };
        const volumes = [
            makeVolumeText({ volumeIndex: 0, events: '## 启程\n主角离开家乡' }),
            makeVolumeText({ volumeIndex: 1, events: '## 修炼\n主角闭关修炼' }),
        ];
        const r = validator.validate(volumes, blueprint);
        const issue = r.criticalIssues.find(i => i.type === 'turning_point_missing');
        expect(issue).toBeDefined();
        expect(issue!.severity).toBe('critical');
        expect(issue!.message).toContain('宗门覆灭');
        expect(r.isValid).toBe(false);
    });

    it('转折点被提及时不触发缺失', () => {
        const blueprint: GlobalStorylineBlueprint = {
            turningPoints: [
                { name: '宗门覆灭', expectedVolume: 2 },
            ],
        };
        const volumes = [
            makeVolumeText({ volumeIndex: 0 }),
            makeVolumeText({ volumeIndex: 1, events: '## 宗门覆灭\n反派攻陷宗门' }),
        ];
        const r = validator.validate(volumes, blueprint);
        expect(r.criticalIssues.some(i => i.type === 'turning_point_missing')).toBe(false);
        expect(r.isValid).toBe(true);
    });

    it('转折点预期卷超出大纲范围触发 critical', () => {
        const blueprint: GlobalStorylineBlueprint = {
            turningPoints: [
                { name: '最终决战', expectedVolume: 3 },
            ],
        };
        const volumes = [
            makeVolumeText({ volumeIndex: 0 }),
            makeVolumeText({ volumeIndex: 1 }),
        ];
        const r = validator.validate(volumes, blueprint);
        const issue = r.criticalIssues.find(i => i.type === 'turning_point_missing');
        expect(issue).toBeDefined();
        expect(issue!.message).toContain('最终决战');
        expect(r.isValid).toBe(false);
    });

    it('转折点在更早卷已出现时，不再要求预期卷重复书写（避免整卷重写）', () => {
        const blueprint: GlobalStorylineBlueprint = {
            turningPoints: [
                { name: '宗门覆灭', expectedVolume: 3 },
            ],
        };
        const volumes = [
            makeVolumeText({ volumeIndex: 0, events: '## 宗门覆灭\n反派攻陷宗门' }),
            makeVolumeText({ volumeIndex: 1 }),
            makeVolumeText({ volumeIndex: 2 }),
        ];
        const r = validator.validate(volumes, blueprint);
        expect(r.criticalIssues.some(i => i.type === 'turning_point_missing')).toBe(false);
        expect(r.isValid).toBe(true);
    });
});

describe('CrossVolumeOutlineValidator — 伏笔回收', () => {
    it('必须回收的伏笔未回收触发 foreshadow_not_revealed critical', () => {
        const blueprint: GlobalStorylineBlueprint = {
            requiredForeshadows: [
                { name: '玉佩之谜', buryVolume: 1, expectedRevealVolume: 2 },
            ],
        };
        const volumes = [
            makeVolumeText({ volumeIndex: 0 }),
            makeVolumeText({ volumeIndex: 1 }),
        ];
        const r = validator.validate(volumes, blueprint);
        const issue = r.criticalIssues.find(i => i.type === 'foreshadow_not_revealed');
        expect(issue).toBeDefined();
        expect(issue!.severity).toBe('critical');
        expect(issue!.message).toContain('玉佩之谜');
        expect(r.isValid).toBe(false);
    });

    it('伏笔已回收不触发 critical', () => {
        const blueprint: GlobalStorylineBlueprint = {
            requiredForeshadows: [
                { name: '玉佩之谜', buryVolume: 1, expectedRevealVolume: 2 },
            ],
        };
        const volumes = [
            makeVolumeText({ volumeIndex: 0 }),
            makeVolumeText({ volumeIndex: 1, foreshadows: '回收玉佩之谜，揭露其真正来源' }),
        ];
        const r = validator.validate(volumes, blueprint);
        expect(r.criticalIssues.some(i => i.type === 'foreshadow_not_revealed')).toBe(false);
        expect(r.isValid).toBe(true);
    });

    it('伏笔预期卷超出当前卷数时降级为 warning', () => {
        const blueprint: GlobalStorylineBlueprint = {
            requiredForeshadows: [
                { name: '终极秘密', buryVolume: 1, expectedRevealVolume: 5 },
            ],
        };
        const volumes = [
            makeVolumeText({ volumeIndex: 0 }),
            makeVolumeText({ volumeIndex: 1 }),
        ];
        const r = validator.validate(volumes, blueprint);
        expect(r.criticalIssues.some(i => i.type === 'foreshadow_not_revealed')).toBe(false);
        const w = r.warningIssues.find(i => i.type === 'foreshadow_not_revealed');
        expect(w).toBeDefined();
        expect(w!.severity).toBe('warning');
        expect(r.isValid).toBe(true);
    });

    it('支线内容无伏笔回收触发 subplot_foreshadow_weak warning', () => {
        const volumes = [
            makeVolumeText({ volumeIndex: 0, subplot: '支线：村民的烦恼，因此与主线相连' }),
        ];
        const r = validator.validate(volumes, {});
        const w = r.warningIssues.find(i => i.type === 'subplot_foreshadow_weak');
        expect(w).toBeDefined();
        expect(w!.severity).toBe('warning');
        expect(r.isValid).toBe(true);
    });
});

describe('CrossVolumeOutlineValidator — 势力格局', () => {
    it('势力兴亡时间线不匹配触发 faction_timeline_mismatch critical', () => {
        const blueprint: GlobalStorylineBlueprint = {
            factionTimeline: [
                { factionName: '青云宗', eventType: 'fall', expectedVolume: 2 },
            ],
        };
        const volumes = [
            makeVolumeText({ volumeIndex: 0, factions: '青云宗势力兴盛' }),
            makeVolumeText({ volumeIndex: 1, factions: '青云宗继续壮大' }),
        ];
        const r = validator.validate(volumes, blueprint);
        const issue = r.criticalIssues.find(i => i.type === 'faction_timeline_mismatch');
        expect(issue).toBeDefined();
        expect(issue!.severity).toBe('critical');
        expect(issue!.message).toContain('青云宗');
        expect(r.isValid).toBe(false);
    });

    it('势力崛起时间线匹配时不触发', () => {
        const blueprint: GlobalStorylineBlueprint = {
            factionTimeline: [
                { factionName: '青云宗', eventType: 'rise', expectedVolume: 1 },
            ],
        };
        const volumes = [
            makeVolumeText({ volumeIndex: 0, factions: '青云宗崛起于江湖' }),
        ];
        const r = validator.validate(volumes, blueprint);
        expect(r.criticalIssues.some(i => i.type === 'faction_timeline_mismatch')).toBe(false);
        expect(r.isValid).toBe(true);
    });
});

describe('CrossVolumeOutlineValidator — 支线-主线连接逻辑', () => {
    it('支线缺少因果连接词触发 subplot_mainline_disconnect critical', () => {
        const volumes = [
            makeVolumeText({
                volumeIndex: 0,
                subplot: '支线：村民的委托，第3章讲述村民故事，无主线关联',
            }),
        ];
        const r = validator.validate(volumes, {});
        const issue = r.criticalIssues.find(i => i.type === 'subplot_mainline_disconnect');
        expect(issue).toBeDefined();
        expect(issue!.severity).toBe('critical');
        expect(r.isValid).toBe(false);
    });

    it('支线含因果连接词时不触发 disconnect', () => {
        const volumes = [
            makeVolumeText({
                volumeIndex: 0,
                subplot: '支线：村民的委托，因此牵扯主线，最终回归主线',
            }),
        ];
        const r = validator.validate(volumes, {});
        expect(r.criticalIssues.some(i => i.type === 'subplot_mainline_disconnect')).toBe(false);
        expect(r.isValid).toBe(true);
    });

    it('支线未明确收束触发 subplot_no_resolution warning', () => {
        const volumes = [
            makeVolumeText({
                volumeIndex: 0,
                subplot: '支线：因此引出新的线索',
            }),
        ];
        const r = validator.validate(volumes, {});
        const w = r.warningIssues.find(i => i.type === 'subplot_no_resolution');
        expect(w).toBeDefined();
        expect(w!.severity).toBe('warning');
    });

    it('支线明确收束时不触发 resolution warning', () => {
        const volumes = [
            makeVolumeText({
                volumeIndex: 0,
                subplot: '支线：因此引出线索，支线收束回归主线',
            }),
        ];
        const r = validator.validate(volumes, {});
        expect(r.warningIssues.some(i => i.type === 'subplot_no_resolution')).toBe(false);
    });
});

describe('CrossVolumeOutlineValidator — detectVolumeConflict', () => {
    it('卷数量不一致返回 count_mismatch 冲突', () => {
        const info = validator.detectVolumeConflict(3, 5, 20);
        expect(info.hasConflict).toBe(true);
        expect(info.conflictType).toBe('count_mismatch');
        expect(info.message).toContain('3');
        expect(info.message).toContain('5');
        expect(info.details).toContain('100');
    });

    it('卷数量一致返回无冲突', () => {
        const info = validator.detectVolumeConflict(3, 3, 20);
        expect(info.hasConflict).toBe(false);
        expect(info.conflictType).toBe('none');
        expect(info.message).toContain('一致');
    });
});

describe('CrossVolumeOutlineValidator — 综合与边界', () => {
    it('空卷数组返回 isValid=true 且无 issues', () => {
        const r = validator.validate([], {});
        expect(r.isValid).toBe(true);
        expect(r.criticalIssues).toEqual([]);
        expect(r.warningIssues).toEqual([]);
        expect(typeof r.checkedAt).toBe('number');
    });

    it('单卷无蓝图返回 isValid=true', () => {
        const volumes = [makeVolumeText({ volumeIndex: 0, chapterRange: '第1章 - 第10章' })];
        const r = validator.validate(volumes, {});
        expect(r.isValid).toBe(true);
    });

    it('同时存在多个 critical 时 isValid=false', () => {
        const blueprint: GlobalStorylineBlueprint = {
            turningPoints: [{ name: '最终决战', expectedVolume: 3 }],
            requiredForeshadows: [{ name: '秘密', buryVolume: 1, expectedRevealVolume: 2 }],
        };
        const volumes = [
            makeVolumeText({ volumeIndex: 0, chapterRange: '第1章 - 第10章' }),
            makeVolumeText({ volumeIndex: 1, chapterRange: '第20章 - 第30章' }),
        ];
        const r = validator.validate(volumes, blueprint);
        expect(r.isValid).toBe(false);
        expect(r.criticalIssues.length).toBeGreaterThanOrEqual(2);
    });

    it('report 中 criticalIssues 与 warningIssues 结构完整', () => {
        const volumes = [
            makeVolumeText({
                volumeIndex: 0,
                chapterRange: '第1章 - 第10章',
                characters: '**林惊鸿**：死亡',
                subplot: '支线：村民故事',
            }),
            makeVolumeText({
                volumeIndex: 1,
                chapterRange: '第11章 - 第20章',
                characters: '**林惊鸿**：活跃',
            }),
        ];
        const r = validator.validate(volumes, {});
        for (const issue of [...r.criticalIssues, ...r.warningIssues]) {
            expect(issue.type.length).toBeGreaterThan(0);
            expect(issue.message.length).toBeGreaterThan(0);
            expect(['critical', 'warning']).toContain(issue.severity);
        }
    });
});

describe('CrossVolumeOutlineValidator — v2 误报修复：转折点全文匹配', () => {
    it('转折点关键词分散在卷大纲不同段落时不应误报 critical', () => {
        // 蓝图转折点「苍穹之觉醒」关键词 ["苍穹", "觉醒"]（由"之"字拆分得到）
        // "苍穹"出现在卷名中，"觉醒"出现在主要事件列表项中，二者不在同一段
        const blueprint: GlobalStorylineBlueprint = {
            turningPoints: [
                { name: '苍穹之觉醒', expectedVolume: 1 },
            ],
        };
        const volumes = [
            makeVolumeText({
                volumeIndex: 0,
                chapterRange: '第1章 - 第10章',
                events: '## 主要事件\n- 韩云澈觉醒，被碎片认主\n- 带着妹妹逃亡',
            }).replace('### 第1卷', '### 第1卷\n- **卷名**：《苍穹之痕》'),
        ];
        const r = validator.validate(volumes, blueprint);
        expect(r.criticalIssues.some(i => i.type === 'turning_point_missing')).toBe(false);
        expect(r.isValid).toBe(true);
    });

    it('转折点关键词完全不在卷大纲中仍应触发 critical', () => {
        const blueprint: GlobalStorylineBlueprint = {
            turningPoints: [
                { name: '神器现世', expectedVolume: 1 },
            ],
        };
        const volumes = [
            makeVolumeText({
                volumeIndex: 0,
                chapterRange: '第1章 - 第10章',
                events: '## 主要事件\n- 主角修炼\n- 与反派对话',
            }),
        ];
        const r = validator.validate(volumes, blueprint);
        const issue = r.criticalIssues.find(i => i.type === 'turning_point_missing');
        expect(issue).toBeDefined();
        expect(r.isValid).toBe(false);
    });
});

describe('CrossVolumeOutlineValidator — v2 误报修复：伏笔全文匹配', () => {
    it('伏笔未用"回收「XXX」"格式但关键词都出现在卷大纲中时不应误报 critical', () => {
        // 蓝图伏笔「苏家灭门真凶线索」关键词 ["苏家", "灭门", "真凶", "线索"]
        // 大纲中以"真凶是李四，他杀害了苏家"形式出现，无引号格式
        const blueprint: GlobalStorylineBlueprint = {
            requiredForeshadows: [
                { name: '苏家灭门真凶线索', buryVolume: 1, expectedRevealVolume: 3 },
            ],
        };
        const volumes = [
            makeVolumeText({ volumeIndex: 0, chapterRange: '第1章 - 第10章' }),
            makeVolumeText({ volumeIndex: 1, chapterRange: '第11章 - 第20章' }),
            makeVolumeText({
                volumeIndex: 2,
                chapterRange: '第21章 - 第30章',
                events: '## 主要事件\n- 真凶是李四，他杀害了苏家\n- 灭门之夜的线索浮现',
            }),
        ];
        const r = validator.validate(volumes, blueprint);
        expect(r.criticalIssues.some(i => i.type === 'foreshadow_not_revealed')).toBe(false);
        expect(r.isValid).toBe(true);
    });

    it('伏笔关键词完全未出现在任何卷大纲中时仍应触发 critical', () => {
        const blueprint: GlobalStorylineBlueprint = {
            requiredForeshadows: [
                { name: '神器碎片之谜', buryVolume: 1, expectedRevealVolume: 2 },
            ],
        };
        const volumes = [
            makeVolumeText({ volumeIndex: 0, chapterRange: '第1章 - 第10章' }),
            makeVolumeText({
                volumeIndex: 1,
                chapterRange: '第11章 - 第20章',
                events: '## 主要事件\n- 主角修炼\n- 与反派对话',
            }),
        ];
        const r = validator.validate(volumes, blueprint);
        const issue = r.criticalIssues.find(i => i.type === 'foreshadow_not_revealed');
        expect(issue).toBeDefined();
        expect(r.isValid).toBe(false);
    });
});

describe('CrossVolumeOutlineValidator — v2 误报修复：势力全文匹配', () => {
    it('势力名与事件词非紧邻但都出现在卷大纲中时不应误报 critical', () => {
        // 蓝图势力「幽渊第七氏族」关键词 ["幽渊", "氏族"]
        // 大纲中"幽渊第七氏族"出现在势力变动段，"壮大"出现在主要事件段（不同段落）
        const blueprint: GlobalStorylineBlueprint = {
            factionTimeline: [
                { factionName: '幽渊第七氏族', eventType: 'rise', expectedVolume: 1 },
            ],
        };
        const volumes = [
            makeVolumeText({
                volumeIndex: 0,
                chapterRange: '第1章 - 第10章',
                events: '## 主要事件\n- 幽渊势力在暗中壮大\n- 主角初次遭遇敌人',
                factions: '## 势力变动\n- 幽渊第七氏族（冥渊旗下）首次露面',
            }),
        ];
        const r = validator.validate(volumes, blueprint);
        expect(r.criticalIssues.some(i => i.type === 'faction_timeline_mismatch')).toBe(false);
        expect(r.isValid).toBe(true);
    });

    it('势力名出现在卷大纲中但缺少对应事件词时仍应触发 critical', () => {
        const blueprint: GlobalStorylineBlueprint = {
            factionTimeline: [
                { factionName: '青云宗', eventType: 'fall', expectedVolume: 2 },
            ],
        };
        const volumes = [
            makeVolumeText({
                volumeIndex: 0,
                chapterRange: '第1章 - 第10章',
                factions: '## 势力变动\n- 青云宗兴盛',
            }),
            makeVolumeText({
                volumeIndex: 1,
                chapterRange: '第11章 - 第20章',
                factions: '## 势力变动\n- 青云宗继续出场',
            }),
        ];
        const r = validator.validate(volumes, blueprint);
        const issue = r.criticalIssues.find(i => i.type === 'faction_timeline_mismatch');
        expect(issue).toBeDefined();
        expect(r.isValid).toBe(false);
    });
});

describe('CrossVolumeOutlineValidator — v2 误报修复：中间卷章节范围缺失', () => {
    it('中间卷 chapterRange 为 null 时只发 warning 不发跨卷 critical', () => {
        // 第2卷没有 chapterRange，第1卷和第3卷都有
        // 旧逻辑会因 sorted 后第1卷和第3卷非相邻但仍比较，错误地报 critical
        const volumes = [
            makeVolumeText({ volumeIndex: 0, chapterRange: '第1章 - 第10章' }),
            makeVolumeText({ volumeIndex: 1 }), // 故意不给 chapterRange
            makeVolumeText({ volumeIndex: 2, chapterRange: '第21章 - 第30章' }),
        ];
        const r = validator.validate(volumes, {});
        // 不应有跨卷不连续 critical
        expect(r.criticalIssues.some(i => i.type === 'chapter_range_gap')).toBe(false);
        // 应有第2卷未识别到章节范围的 warning
        const w = r.warningIssues.find(i => i.type === 'chapter_range_missing');
        expect(w).toBeDefined();
        expect(w!.severity).toBe('warning');
        expect(w!.message).toContain('第2卷');
        expect(w!.message).toContain('未识别到章节范围');
    });

    it('所有卷都有 chapterRange 且连续时不触发 chapter_range_missing warning', () => {
        const volumes = [
            makeVolumeText({ volumeIndex: 0, chapterRange: '第1章 - 第10章' }),
            makeVolumeText({ volumeIndex: 1, chapterRange: '第11章 - 第20章' }),
        ];
        const r = validator.validate(volumes, {});
        expect(r.warningIssues.some(i => i.type === 'chapter_range_missing')).toBe(false);
        expect(r.criticalIssues.some(i => i.type === 'chapter_range_gap')).toBe(false);
        expect(r.isValid).toBe(true);
    });
});
