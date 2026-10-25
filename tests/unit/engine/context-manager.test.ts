import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {
        settings = {
            maxContext: 8000,
            maxUnrevealedForeshadow: 20,
        };
        app = {};
    },
}));

import { ContextManager, detectProjects } from '../../../engine/context-manager';
import { App, TFile, TFolder, Vault } from '../../__mocks__/obsidian';
import type { CharacterData, TimelineEvent, ForeshadowData } from '../../../engine/context/context-types';

function makeMockApp() {
    const app = new App();
    return app;
}

function makeMockPlugin(app?: App) {
    return {
        settings: {
            maxContext: 8000,
            maxUnrevealedForeshadow: 20,
        },
        app: app || makeMockApp(),
        cacheManager: null,
    } as any;
}

describe('detectProjects - 项目检测', () => {
    it('空 vault 返回空数组', () => {
        const app = makeMockApp();
        const result = detectProjects(app as any);
        expect(result).toEqual([]);
    });

    it('通过 .project 文件检测项目', () => {
        const app = makeMockApp();
        const vault = app.vault as any;
        vault.getFiles = () => [
            { path: '我的小说/.project' },
            { path: '我的小说/01-世界架构/人物/主角.md' },
        ];
        const result = detectProjects(app as any);
        expect(result).toContain('我的小说');
        expect(result.length).toBe(1);
    });

    it('通过世界观总览.md 检测项目', () => {
        const app = makeMockApp();
        const vault = app.vault as any;
        vault.getFiles = () => [
            { path: '玄幻世界/世界观总览.md' },
        ];
        const result = detectProjects(app as any);
        expect(result).toContain('玄幻世界');
    });

    it('通过 01-世界架构 子目录检测项目', () => {
        const app = makeMockApp();
        const vault = app.vault as any;
        vault.getFiles = () => [
            { path: '都市传说/01-世界架构/地点/学校.md' },
        ];
        const result = detectProjects(app as any);
        expect(result).toContain('都市传说');
    });

    it('多个项目返回排序后的数组', () => {
        const app = makeMockApp();
        const vault = app.vault as any;
        vault.getFiles = () => [
            { path: 'B项目/.project' },
            { path: 'A项目/世界观总览.md' },
            { path: 'C项目/01-世界架构/人物/x.md' },
        ];
        const result = detectProjects(app as any);
        expect(result).toEqual(['A项目', 'B项目', 'C项目']);
    });

    it('跳过元文件和点文件开头的路径', () => {
        const app = makeMockApp();
        const vault = app.vault as any;
        vault.getFiles = () => [
            { path: '元文件/模板.md' },
            { path: '.obsidian/plugins/x.md' },
            { path: '正常项目/.project' },
        ];
        const result = detectProjects(app as any);
        expect(result).toEqual(['正常项目']);
    });

    it('普通文件不被误判为项目', () => {
        const app = makeMockApp();
        const vault = app.vault as any;
        vault.getFiles = () => [
            { path: '笔记/读书心得.md' },
            { path: '日记/2024-01-01.md' },
        ];
        const result = detectProjects(app as any);
        expect(result).toEqual([]);
    });

    it('同一项目只出现一次（去重）', () => {
        const app = makeMockApp();
        const vault = app.vault as any;
        vault.getFiles = () => [
            { path: '同一项目/.project' },
            { path: '同一项目/世界观总览.md' },
            { path: '同一项目/01-世界架构/人物/a.md' },
            { path: '同一项目/01-世界架构/人物/b.md' },
        ];
        const result = detectProjects(app as any);
        expect(result).toHaveLength(1);
        expect(result[0]).toBe('同一项目');
    });
});

describe('ContextManager.formatCharacters - 人物格式化', () => {
    it('空数组返回空字符串', () => {
        const result = ContextManager.formatCharacters([]);
        expect(result).toBe('');
    });

    it('单个角色格式化输出包含姓名和字段', () => {
        const chars: CharacterData[] = [
            { name: '林惊鸿', 年龄: '25', 身份: '剑修', 性格标签: '冷静' } as any,
        ];
        const result = ContextManager.formatCharacters(chars);
        expect(result).toContain('林惊鸿');
        expect(result).toContain('年龄=25');
        expect(result).toContain('身份=剑修');
        expect(result.startsWith('\n- ')).toBe(true);
    });

    it('多个角色每行一个', () => {
        const chars: CharacterData[] = [
            { name: '林惊鸿', 年龄: '25' } as any,
            { name: '苏白', 年龄: '22' } as any,
        ];
        const result = ContextManager.formatCharacters(chars);
        expect(result).toContain('林惊鸿');
        expect(result).toContain('苏白');
        const lines = result.split('\n- ').filter(Boolean);
        expect(lines.length).toBe(2);
    });

    it('缺失字段显示为 —', () => {
        const chars: CharacterData[] = [
            { name: '无名氏' } as any,
        ];
        const result = ContextManager.formatCharacters(chars);
        expect(result).toContain('—');
    });

    it('从 姓名 字段回退获取名字', () => {
        const chars: CharacterData[] = [
            { 姓名: '张三', 年龄: '30' } as any,
        ];
        const result = ContextManager.formatCharacters(chars);
        expect(result).toContain('张三');
    });
});

describe('ContextManager.formatEntities - 实体格式化', () => {
    it('空数组返回空字符串', () => {
        const result = ContextManager.formatEntities([], 'location');
        expect(result).toBe('');
    });

    it('地点实体包含类型、地理特征、重要程度', () => {
        const entities = [
            { name: '青云宗', 类型: '门派', 地理特征: '山顶', 重要程度: '核心' },
        ];
        const result = ContextManager.formatEntities(entities, 'location');
        expect(result).toContain('青云宗');
        expect(result).toContain('类型=门派');
        expect(result).toContain('地理特征=山顶');
        expect(result).toContain('重要程度=核心');
    });

    it('势力实体包含类型、领袖、地位/排名', () => {
        const entities = [
            { name: '魔门', 类型: '邪派', 领袖: '魔尊', '地位/排名': '第一' },
        ];
        const result = ContextManager.formatEntities(entities, 'faction');
        expect(result).toContain('魔门');
        expect(result).toContain('类型=邪派');
        expect(result).toContain('领袖=魔尊');
        expect(result).toContain('地位/排名=第一');
    });

    it('物品实体包含类型、品阶/等级、效果', () => {
        const entities = [
            { name: '诛仙剑', 类型: '法宝', '品阶/等级': '仙器', 效果: '斩妖除魔' },
        ];
        const result = ContextManager.formatEntities(entities, 'item');
        expect(result).toContain('诛仙剑');
        expect(result).toContain('类型=法宝');
        expect(result).toContain('品阶/等级=仙器');
        expect(result).toContain('效果=斩妖除魔');
    });

    it('缺失字段显示为 —', () => {
        const entities = [
            { name: '神秘地点' },
        ];
        const result = ContextManager.formatEntities(entities, 'location');
        expect(result).toContain('神秘地点');
        expect(result).toContain('类型=—');
    });

    it('多个实体每行一个', () => {
        const entities = [
            { name: '地点A', 类型: '城镇' },
            { name: '地点B', 类型: '山脉' },
        ];
        const result = ContextManager.formatEntities(entities, 'location');
        const lines = result.split('\n- ').filter(Boolean);
        expect(lines.length).toBe(2);
    });
});

describe('ContextManager.formatTimeline - 时间线格式化', () => {
    it('空数组返回空字符串', () => {
        const result = ContextManager.formatTimeline([]);
        expect(result).toBe('');
    });

    it('包含表头', () => {
        const events: TimelineEvent[] = [
            { time: '开元元年', chapter: '第1章', event: '主角出生', impact: '', location: '青云村', involvedEntities: ['林惊鸿'], type: '背景', idx: '1' },
        ];
        const result = ContextManager.formatTimeline(events);
        expect(result).toContain('#');
        expect(result).toContain('事件名称');
        expect(result).toContain('时间');
        expect(result).toContain('地点');
        expect(result).toContain('涉及人物');
    });

    it('正确渲染事件数据', () => {
        const events: TimelineEvent[] = [
            { time: '开元元年', chapter: '第1章', event: '主角出生', impact: '', location: '青云村', involvedEntities: ['林惊鸿', '林父'], type: '背景', idx: '1' },
        ];
        const result = ContextManager.formatTimeline(events);
        expect(result).toContain('主角出生');
        expect(result).toContain('开元元年');
        expect(result).toContain('青云村');
        expect(result).toContain('林惊鸿、林父');
        expect(result).toContain('第1章');
    });

    it('多个事件按顺序编号', () => {
        const events: TimelineEvent[] = [
            { time: 't1', chapter: '第1章', event: '事件一', impact: '', location: '', involvedEntities: [], type: '', idx: '' },
            { time: 't2', chapter: '第2章', event: '事件二', impact: '', location: '', involvedEntities: [], type: '', idx: '' },
            { time: 't3', chapter: '第3章', event: '事件三', impact: '', location: '', involvedEntities: [], type: '', idx: '' },
        ];
        const result = ContextManager.formatTimeline(events);
        expect(result).toContain('| 1 |');
        expect(result).toContain('| 2 |');
        expect(result).toContain('| 3 |');
    });

    it('空 involvedEntities 不报错', () => {
        const events: TimelineEvent[] = [
            { time: 't1', chapter: '第1章', event: '单独事件', impact: '', location: '', type: '', idx: '' },
        ];
        expect(() => ContextManager.formatTimeline(events)).not.toThrow();
    });
});

describe('ContextManager.formatFanficRules - 同人规则格式化', () => {
    it('undefined 返回空字符串', () => {
        const result = ContextManager.formatFanficRules(undefined);
        expect(result).toBe('');
    });

    it('包含必须遵守的规则', () => {
        const rules = {
            mustFollow: ['角色A性格不能OOC', '不能改变原作结局'],
            adaptScope: '',
            redlines: [],
        };
        const result = ContextManager.formatFanficRules(rules);
        expect(result).toContain('必须遵守的原作规则');
        expect(result).toContain('角色A性格不能OOC');
        expect(result).toContain('不能改变原作结局');
    });

    it('包含改编范围', () => {
        const rules = {
            mustFollow: [],
            adaptScope: '可以改编配角剧情',
            redlines: [],
        };
        const result = ContextManager.formatFanficRules(rules);
        expect(result).toContain('允许改编的范围');
        expect(result).toContain('可以改编配角剧情');
    });

    it('包含禁止触及的红线', () => {
        const rules = {
            mustFollow: [],
            adaptScope: '',
            redlines: ['不能写死主角', '不能有悲剧结局'],
        };
        const result = ContextManager.formatFanficRules(rules);
        expect(result).toContain('禁止触及的红线');
        expect(result).toContain('不能写死主角');
    });

    it('完整规则包含三部分且用空行分隔', () => {
        const rules = {
            mustFollow: ['规则1'],
            adaptScope: '改编范围',
            redlines: ['红线1'],
        };
        const result = ContextManager.formatFanficRules(rules);
        expect(result).toContain('必须遵守的原作规则');
        expect(result).toContain('允许改编的范围');
        expect(result).toContain('禁止触及的红线');
    });
});

describe('ContextManager - 构造函数', () => {
    it('plugin 模式构造正常', () => {
        const plugin = makeMockPlugin();
        expect(() => {
            new ContextManager({ plugin });
        }).not.toThrow();
    });

    it('capabilities 模式构造正常', () => {
        const app = makeMockApp();
        const capabilities = {
            app,
            settings: { maxContext: 8000 },
        };
        expect(() => {
            new ContextManager({ capabilities } as any);
        }).not.toThrow();
    });

    it('旧式构造（直接传 plugin）兼容', () => {
        const plugin = makeMockPlugin();
        expect(() => {
            new ContextManager(plugin as any);
        }).not.toThrow();
    });

    it('构造后 detectProjects 方法可用', async () => {
        const plugin = makeMockPlugin();
        const cm = new ContextManager({ plugin });
        expect(typeof cm.detectProjects).toBe('function');
    });

    it('构造后 gatherAll 方法可用', () => {
        const plugin = makeMockPlugin();
        const cm = new ContextManager({ plugin });
        expect(typeof cm.gatherAll).toBe('function');
    });

    it('构造后 buildPromptSection 方法可用', () => {
        const plugin = makeMockPlugin();
        const cm = new ContextManager({ plugin });
        expect(typeof cm.buildPromptSection).toBe('function');
    });

    it('notifier 可选，不传时使用 NOOP_NOTIFIER', () => {
        const plugin = makeMockPlugin();
        expect(() => {
            new ContextManager({ plugin });
        }).not.toThrow();
    });
});

describe('ContextManager - 缓存机制', () => {
    it('setContextCacheTTL 设置缓存 TTL 不报错', () => {
        const plugin = makeMockPlugin();
        const cm = new ContextManager({ plugin });
        expect(() => {
            cm.setContextCacheTTL(60000);
        }).not.toThrow();
    });

    it('invalidateContextCache 不传参数时不报错', () => {
        const plugin = makeMockPlugin();
        const cm = new ContextManager({ plugin });
        expect(() => {
            cm.invalidateContextCache();
        }).not.toThrow();
    });

    it('invalidateContextCache 传项目名时不报错', () => {
        const plugin = makeMockPlugin();
        const cm = new ContextManager({ plugin });
        expect(() => {
            cm.invalidateContextCache('测试项目');
        }).not.toThrow();
    });
});

describe('ContextManager - detectProjects 实例方法', () => {
    it('实例方法调用 detectProjects 纯函数', async () => {
        const app = makeMockApp();
        const vault = app.vault as any;
        vault.getFiles = () => [
            { path: '测试项目/.project' },
        ];
        const plugin = makeMockPlugin(app);
        const cm = new ContextManager({ plugin });
        const result = await cm.detectProjects();
        expect(result).toContain('测试项目');
    });

    it('空 vault 返回空数组', async () => {
        const plugin = makeMockPlugin();
        const cm = new ContextManager({ plugin });
        const result = await cm.detectProjects();
        expect(result).toEqual([]);
    });
});

describe('ContextManager.getInfoSummary - 信息摘要', () => {
    it('空上下文返回空字符串', () => {
        const plugin = makeMockPlugin();
        const cm = new ContextManager({ plugin });
        const result = cm.getInfoSummary({
            project: '测试',
            gatheredAt: new Date().toISOString(),
            data: {},
            issues: [],
        });
        expect(result).toBe('');
    });

    it('包含人物数量', () => {
        const plugin = makeMockPlugin();
        const cm = new ContextManager({ plugin });
        const result = cm.getInfoSummary({
            project: '测试',
            gatheredAt: new Date().toISOString(),
            data: {
                character_state: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
            },
            issues: [],
        });
        expect(result).toContain('人物: 3人');
    });

    it('包含伏笔数量', () => {
        const plugin = makeMockPlugin();
        const cm = new ContextManager({ plugin });
        const result = cm.getInfoSummary({
            project: '测试',
            gatheredAt: new Date().toISOString(),
            data: {
                foreshadows: {
                    unrevealed: [{}, {}, {}],
                    revealed: [{}],
                    abandoned: [],
                } as unknown as ForeshadowData,
            },
            issues: [],
        });
        expect(result).toContain('伏笔: 3未揭示 / 1已揭示');
    });

    it('包含时间线事件数量', () => {
        const plugin = makeMockPlugin();
        const cm = new ContextManager({ plugin });
        const result = cm.getInfoSummary({
            project: '测试',
            gatheredAt: new Date().toISOString(),
            data: {
                timeline: [{}, {}, {}, {}, {}] as any,
            },
            issues: [],
        });
        expect(result).toContain('时间线事件: 5个');
    });

    it('包含前文已加载标记', () => {
        const plugin = makeMockPlugin();
        const cm = new ContextManager({ plugin });
        const result = cm.getInfoSummary({
            project: '测试',
            gatheredAt: new Date().toISOString(),
            data: {
                previous_chapter: { content: 'x' } as any,
            },
            issues: [],
        });
        expect(result).toContain('前文: 已加载');
    });
});

describe('ContextManager - 同人设定读取（.project 路径即权威路径）', () => {
    const PROJECT = '同人项目';
    const FANFIC_PATH = `${PROJECT}/05-同人设定库/遮天设定.md`;

    const REAL_CONTENT = `## 原作剧情时间线
| 时间节点 | 原作事件 | 涉及人物 | 章节参考 | 你的同人如何切入 |
|---|---|---|---|---|
| 开篇 | 主角觉醒 | 主角 | 第1章 | 提前相遇 |

## 故事背景时间线（你的同人）
| 你的时间节点 | 你的事件 | 对应原作时间 | 涉及人物 |
|---|---|---|---|
| 第一年 | 加入组织 | 开篇 | 主角、配角 |

## 创作规则
- **必须遵守的原作规则**：主线事件不变
- **允许改编的范围**：支线人物关系
- **禁止触及的红线**：主要角色死亡
`;

    const PLACEHOLDER_CONTENT = `## 原作剧情时间线
| 时间节点 | 原作事件 | 涉及人物 | 章节参考 | 你的同人如何切入 |
|---|---|---|---|---|
| 待补充 | 待补充 | 待补充 | 待补充 | 待补充 |

## 故事背景时间线（你的同人）
| 你的时间节点 | 你的事件 | 对应原作时间 | 涉及人物 |
|---|---|---|---|
| 待补充 | 待补充 | 待补充 | 待补充 |

## 创作规则
- **必须遵守的原作规则**：（待补充）
- **允许改编的范围**：（待补充）
- **禁止触及的红线**：（待补充）
`;

    function seedProject(recordedPath: string): { app: App; cm: ContextManager } {
        const app = makeMockApp();
        const vault = app.vault as any;
        vault._seedFile(
            `${PROJECT}/.project`,
            `# ${PROJECT}\n\n## 类型\nfanfic\n\n## 同人设定路径\n${recordedPath}\n`
        );
        return { app, cm: new ContextManager({ plugin: makeMockPlugin(app) }) };
    }

    it('按 .project 记录的完整路径读取时间线与规则', async () => {
        const { app, cm } = seedProject(FANFIC_PATH);
        (app.vault as any)._seedFile(FANFIC_PATH, REAL_CONTENT);

        const canon = await cm.loadFanficCanonTimeline(PROJECT);
        expect(canon).toHaveLength(1);
        expect(canon[0]['原作事件']).toBe('主角觉醒');
        expect(canon[0]['你的同人如何切入']).toBe('提前相遇');

        const fan = await cm.loadFanficFanTimeline(PROJECT);
        expect(fan).toHaveLength(1);
        expect(fan[0]['你的事件']).toBe('加入组织');

        const rules = await cm.loadFanficRules(PROJECT);
        expect(rules.mustFollow).toEqual(['主线事件不变']);
        expect(rules.adaptScope).toBe('支线人物关系');
        expect(rules.redlines).toEqual(['主要角色死亡']);
    });

    it('兼容旧数据里只记录文件名的情况', async () => {
        const { app, cm } = seedProject('遮天设定');
        (app.vault as any)._seedFile(FANFIC_PATH, REAL_CONTENT);

        const canon = await cm.loadFanficCanonTimeline(PROJECT);
        expect(canon).toHaveLength(1);
        expect(canon[0]['原作事件']).toBe('主角觉醒');
    });

    it('骨架占位行与占位规则不作为上下文内容', async () => {
        const { app, cm } = seedProject(FANFIC_PATH);
        (app.vault as any)._seedFile(FANFIC_PATH, PLACEHOLDER_CONTENT);

        expect(await cm.loadFanficCanonTimeline(PROJECT)).toEqual([]);
        expect(await cm.loadFanficFanTimeline(PROJECT)).toEqual([]);
        const rules = await cm.loadFanficRules(PROJECT);
        expect(rules.mustFollow).toEqual([]);
        expect(rules.adaptScope).toBe('');
        expect(rules.redlines).toEqual([]);
    });
});
