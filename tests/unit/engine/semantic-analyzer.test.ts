/**
 * semantic-analyzer.test.ts — 语义分析模块单元测试
 * 
 * 覆盖 Task 4 的测试要求：
 * - TR-4.1: 词性标注准确性（动词识别率 > 90%）
 * - TR-4.2: 语义相似度匹配（编辑距离阈值正确识别同义词）
 * - TR-4.3: 语境分析准确性（根据上下文正确判断实体类型）
 * - TR-4.4: 同指消解（语义等价实体正确合并）
 */

import { describe, it, expect } from 'vitest';
import { SemanticAnalyzer, WordType } from '../../../engine/semantic-analyzer';

describe('SemanticAnalyzer - 词性标注', () => {
    describe('名词识别', () => {
        it('识别物品名词（剑/刀/玉佩/丹药）', () => {
            const items = ['长剑', '宝刀', '传国玉佩', '九转金丹', '玄铁令', '青铜鼎'];
            items.forEach(item => {
                const result = SemanticAnalyzer.analyzeWord(item);
                expect(result.type).toBe('noun');
                expect(result.subType).toBe('item');
                expect(result.confidence).toBeGreaterThan(0.6);
            });
        });

        it('识别人物名词（人名/角色名）', () => {
            const characters = ['克莱恩', '卡丹', '紫川秀', '帝林', '李云龙', '王小云'];
            characters.forEach(char => {
                const result = SemanticAnalyzer.analyzeWord(char);
                expect(result.type).toBe('noun');
                expect(result.subType).toBe('character');
                expect(result.confidence).toBeGreaterThan(0.6);
            });
        });

        it('识别技能名词（功法/心法/秘籍）', () => {
            const skills = ['九阳神功', '九阴真经', '乾坤大挪移', '紫霞神功', '北冥神功', '小无相功'];
            skills.forEach(skill => {
                const result = SemanticAnalyzer.analyzeWord(skill);
                expect(result.type).toBe('noun');
                expect(result.subType).toBe('skill');
                expect(result.confidence).toBeGreaterThan(0.6);
            });
        });

        it('识别地点名词（秘境/禁地/城池）', () => {
            const settings = ['太古秘境', '昆仑禁地', '长安城', '幽冥鬼界', '东海龙宫', '西天大雷音寺'];
            settings.forEach(setting => {
                const result = SemanticAnalyzer.analyzeWord(setting);
                expect(result.type).toBe('noun');
                expect(result.subType).toBe('setting');
                expect(result.confidence).toBeGreaterThan(0.6);
            });
        });

        it('识别事件名词（大战/预言/浩劫）', () => {
            const events = ['三界大战', '末日预言', '万年浩劫', '封神之战', '千年大劫', '末世灾变'];
            events.forEach(event => {
                const result = SemanticAnalyzer.analyzeWord(event);
                expect(result.type).toBe('noun');
                expect(result.subType).toBe('event');
                expect(result.confidence).toBeGreaterThan(0.6);
            });
        });

        it('识别组织名词（门派/宗族/帮会）', () => {
            const orgs = ['武当派', '少林派', '青龙帮', '明教', '妖族联盟', '暗夜组织'];
            orgs.forEach(org => {
                const result = SemanticAnalyzer.analyzeWord(org);
                expect(result.type).toBe('noun');
                expect(result.subType).toBe('organization');
                expect(result.confidence).toBeGreaterThan(0.6);
            });
        });
    });

    describe('动词识别', () => {
        it('识别动作动词（修炼/战斗/突破）', () => {
            const verbs = ['修炼', '战斗', '突破', '渡劫', '飞升', '重生', '穿越', '进化'];
            verbs.forEach(verb => {
                const result = SemanticAnalyzer.analyzeWord(verb);
                expect(result.type).toBe('verb');
                expect(result.confidence).toBeGreaterThan(0.6);
            });
        });

        it('识别心理动词（思考/回忆/想象）', () => {
            const verbs = ['思考', '回忆', '想象', '决定', '希望', '害怕', '怀疑', '相信'];
            verbs.forEach(verb => {
                const result = SemanticAnalyzer.analyzeWord(verb);
                expect(result.type).toBe('verb');
                expect(result.confidence).toBeGreaterThan(0.5);
            });
        });

        it('识别交流动词（说话/询问/回答）', () => {
            const verbs = ['说话', '询问', '回答', '命令', '请求', '拒绝', '说服', '解释'];
            verbs.forEach(verb => {
                const result = SemanticAnalyzer.analyzeWord(verb);
                expect(result.type).toBe('verb');
                expect(result.confidence).toBeGreaterThan(0.5);
            });
        });

        it('动词识别率 > 90%', () => {
            const testVerbs = [
                '修炼', '战斗', '突破', '渡劫', '飞升', '重生', '穿越', '进化',
                '思考', '回忆', '想象', '决定', '希望', '害怕', '怀疑', '相信',
                '说话', '询问', '回答', '命令', '请求', '拒绝', '说服', '解释',
                '攻击', '防守', '逃跑', '追逐', '寻找', '发现', '行动', '帮助',
                '伤害', '杀死', '复活', '成长', '变强', '变弱', '出现', '消失',
                '获得', '失去', '拥有', '使用', '学习', '领悟', '创造', '毁灭',
                '改变', '进化', '突破', '到达', '离开', '返回', '等待', '出发',
            ];

            let correct = 0;
            testVerbs.forEach(verb => {
                const result = SemanticAnalyzer.analyzeWord(verb);
                if (result.type === 'verb') {
                    correct++;
                }
            });

            const accuracy = correct / testVerbs.length;
            expect(accuracy).toBeGreaterThan(0.9);
        });
    });

    describe('形容词识别', () => {
        it('识别属性形容词（强大/弱小/美丽）', () => {
            const adjectives = ['强大', '弱小', '美丽', '丑陋', '善良', '邪恶', '聪明', '愚蠢'];
            adjectives.forEach(adj => {
                const result = SemanticAnalyzer.analyzeWord(adj);
                expect(result.type).toBe('adjective');
                expect(result.confidence).toBeGreaterThan(0.5);
            });
        });

        it('识别状态形容词（温暖/寒冷/明亮）', () => {
            const adjectives = ['温暖', '寒冷', '明亮', '黑暗', '安静', '喧闹', '干净', '肮脏'];
            adjectives.forEach(adj => {
                const result = SemanticAnalyzer.analyzeWord(adj);
                expect(result.type).toBe('adjective');
                expect(result.confidence).toBeGreaterThan(0.5);
            });
        });
    });

    describe('副词识别', () => {
        it('识别程度副词（非常/特别/十分）', () => {
            const adverbs = ['非常', '特别', '十分', '格外', '分外', '更加', '愈发', '极其'];
            adverbs.forEach(adv => {
                const result = SemanticAnalyzer.analyzeWord(adv);
                expect(result.type).toBe('adverb');
                expect(result.confidence).toBeGreaterThan(0.5);
            });
        });

        it('识别时间副词（突然/渐渐/立即）', () => {
            const adverbs = ['突然', '忽然', '渐渐', '逐渐', '立即', '马上', '终于', '刚刚'];
            adverbs.forEach(adv => {
                const result = SemanticAnalyzer.analyzeWord(adv);
                expect(result.type).toBe('adverb');
                expect(result.confidence).toBeGreaterThan(0.5);
            });
        });
    });

    describe('虚词识别', () => {
        it('识别虚词（的/了/着/过/和/与）', () => {
            const functionWords = ['的', '了', '着', '过', '和', '与', '及', '或', '而', '且'];
            functionWords.forEach(word => {
                const result = SemanticAnalyzer.analyzeWord(word);
                expect(result.type).toBe('function');
                expect(result.confidence).toBeGreaterThan(0.9);
            });
        });
    });
});

describe('SemanticAnalyzer - 语义相似度匹配', () => {
    describe('编辑距离计算', () => {
        it('相同字符串距离为 0', () => {
            expect(SemanticAnalyzer.levenshteinDistance('克莱恩', '克莱恩')).toBe(0);
            expect(SemanticAnalyzer.levenshteinDistance('灰雾之门', '灰雾之门')).toBe(0);
        });

        it('不同长度字符串计算正确', () => {
            expect(SemanticAnalyzer.levenshteinDistance('克莱恩', '小克')).toBe(3);
            expect(SemanticAnalyzer.levenshteinDistance('灰雾之门', '灰雾')).toBe(2);
        });
    });

    describe('语义相似度', () => {
        it('完全相同相似度为 1.0', () => {
            expect(SemanticAnalyzer.semanticSimilarity('克莱恩', '克莱恩')).toBe(1.0);
            expect(SemanticAnalyzer.semanticSimilarity('灰雾之门', '灰雾之门')).toBe(1.0);
        });

        it('别名相似度高（克莱恩/小克）', () => {
            const similarity = SemanticAnalyzer.semanticSimilarity('克莱恩', '小克');
            expect(similarity).toBeGreaterThan(0.5);
        });

        it('近义词相似度较高', () => {
            const similarity = SemanticAnalyzer.semanticSimilarity('修炼', '修练');
            expect(similarity).toBeGreaterThan(0.7);
        });

        it('无关词相似度低', () => {
            const similarity = SemanticAnalyzer.semanticSimilarity('克莱恩', '灰雾之门');
            expect(similarity).toBeLessThan(0.3);
        });
    });

    describe('语义匹配', () => {
        it('精确匹配', () => {
            const result = SemanticAnalyzer.compare('克莱恩', '克莱恩');
            expect(result.matched).toBe(true);
            expect(result.matchType).toBe('exact');
            expect(result.similarity).toBe(1.0);
        });

        it('别名匹配（前缀关系）', () => {
            const result = SemanticAnalyzer.compare('克莱恩', '小克');
            expect(result.matched).toBe(true);
            expect(result.matchType).toBe('alias');
            expect(result.similarity).toBeGreaterThan(0.7);
        });

        it('语义匹配（高相似度）', () => {
            const result = SemanticAnalyzer.compare('修炼', '修练');
            expect(result.matched).toBe(true);
            expect(result.matchType).toBe('semantic');
            expect(result.similarity).toBeGreaterThan(0.6);
        });

        it('不匹配（低相似度）', () => {
            const result = SemanticAnalyzer.compare('克莱恩', '灰雾之门');
            expect(result.matched).toBe(false);
            expect(result.similarity).toBeLessThan(0.3);
        });
    });

    describe('编辑距离阈值正确识别同义词', () => {
        it('同义词识别（修炼/修练/修行）', () => {
            const words = ['修炼', '修练', '修行', '修持'];
            for (let i = 0; i < words.length; i++) {
                for (let j = i + 1; j < words.length; j++) {
                    const result = SemanticAnalyzer.compare(words[i], words[j]);
                    expect(result.matched).toBe(true);
                    expect(result.similarity).toBeGreaterThan(0.6);
                }
            }
        });

        it('角色别名识别（克莱恩/小克/愚者）', () => {
            const result1 = SemanticAnalyzer.compare('克莱恩', '小克');
            expect(result1.matched).toBe(true);
            expect(result1.similarity).toBeGreaterThan(0.5);
        });
    });
});

describe('SemanticAnalyzer - 语境分析', () => {
    it('对话上下文识别角色（卡丹道：）', () => {
        const context = '卡丹道："你怎么会在这里？"她的眼中满是惊讶。';
        const result = SemanticAnalyzer.analyzeContext(context, '卡丹');
        expect(result.type).toBe('noun');
        expect(result.subType).toBe('character');
        expect(result.confidence).toBeGreaterThan(0.85);
    });

    it('对话上下文识别角色（紫川秀说道）', () => {
        const context = '紫川秀说道："此事必有蹊跷。"';
        const result = SemanticAnalyzer.analyzeContext(context, '紫川秀');
        expect(result.type).toBe('noun');
        expect(result.subType).toBe('character');
        expect(result.confidence).toBeGreaterThan(0.85);
    });

    it('所属关系上下文识别名词（玉佩的光芒）', () => {
        const context = '传国玉佩的光芒闪烁着神秘的色彩。';
        const result = SemanticAnalyzer.analyzeContext(context, '传国玉佩');
        expect(result.type).toBe('noun');
        expect(result.subType).toBe('item');
        expect(result.confidence).toBeGreaterThan(0.6);
    });

    it('命名上下文识别名词（名为克莱恩）', () => {
        const context = '他名为克莱恩，是一位非凡的冒险家。';
        const result = SemanticAnalyzer.analyzeContext(context, '克莱恩');
        expect(result.type).toBe('noun');
        expect(result.subType).toBe('character');
        expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('语境分析准确性（根据上下文正确判断实体类型）', () => {
        const contexts = [
            { context: '卡丹道："你好。"', entity: '卡丹', expectedType: 'noun', expectedSubType: 'character' },
            { context: '传国玉佩的光芒闪烁。', entity: '传国玉佩', expectedType: 'noun', expectedSubType: 'item' },
            { context: '九阳神功威力无穷。', entity: '九阳神功', expectedType: 'noun', expectedSubType: 'skill' },
            { context: '太古秘境危险重重。', entity: '太古秘境', expectedType: 'noun', expectedSubType: 'setting' },
            { context: '三界大战即将爆发。', entity: '三界大战', expectedType: 'noun', expectedSubType: 'event' },
        ];

        contexts.forEach(({ context, entity, expectedType, expectedSubType }) => {
            const result = SemanticAnalyzer.analyzeContext(context, entity);
            expect(result.type).toBe(expectedType);
            expect(result.subType).toBe(expectedSubType);
        });
    });
});

describe('SemanticAnalyzer - 同指消解', () => {
    describe('别名分组', () => {
        it('正确分组同义词（修炼/修练/修行）', () => {
            const names = ['修炼', '修练', '修行', '战斗', '战争', '决斗'];
            const groups = SemanticAnalyzer.findAliases(names);
            
            expect(groups.length).toBeGreaterThanOrEqual(2);
            
            const cultivationGroup = groups.find(g => g.canonicalName === '修炼' || g.canonicalName === '修练' || g.canonicalName === '修行');
            expect(cultivationGroup).toBeDefined();
            expect(cultivationGroup!.count).toBe(3);
            expect(cultivationGroup!.confidence).toBeGreaterThan(0.6);
        });

        it('正确分组角色别名（克莱恩/小克）', () => {
            const names = ['克莱恩', '小克', '灰雾之门', '罗塞尔'];
            const groups = SemanticAnalyzer.findAliases(names);
            
            const kleinGroup = groups.find(g => g.canonicalName === '克莱恩' || g.canonicalName === '小克');
            expect(kleinGroup).toBeDefined();
            expect(kleinGroup!.count).toBe(2);
        });
    });

    describe('规范名选择', () => {
        it('优先选择完整名（克莱恩 > 小克）', () => {
            const names = ['小克', '克莱恩'];
            const groups = SemanticAnalyzer.findAliases(names);
            expect(groups[0].canonicalName).toBe('克莱恩');
            expect(groups[0].aliases).toContain('小克');
        });

        it('优先选择带姓氏的名（李云龙 > 云龙）', () => {
            const names = ['云龙', '李云龙'];
            const groups = SemanticAnalyzer.findAliases(names);
            expect(groups[0].canonicalName).toBe('李云龙');
        });
    });

    describe('同指消解（语义等价实体正确合并）', () => {
        it('合并语义等价实体', () => {
            const names = ['克莱恩', '小克', '克总', '灰雾之主', '愚者', '罗塞尔', '大帝'];
            const groups = SemanticAnalyzer.findAliases(names);
            
            const kleinGroup = groups.find(g => g.canonicalName === '克莱恩');
            expect(kleinGroup).toBeDefined();
            expect(kleinGroup!.count).toBeGreaterThanOrEqual(2);
            expect(kleinGroup!.confidence).toBeGreaterThan(0.5);
        });

        it('不同实体不被错误合并', () => {
            const names = ['克莱恩', '灰雾之门', '罗塞尔'];
            const groups = SemanticAnalyzer.findAliases(names);
            
            expect(groups.length).toBeGreaterThanOrEqual(3);
            
            const kleinGroup = groups.find(g => g.canonicalName === '克莱恩');
            const doorGroup = groups.find(g => g.canonicalName === '灰雾之门');
            const rosellGroup = groups.find(g => g.canonicalName === '罗塞尔');
            
            expect(kleinGroup).toBeDefined();
            expect(doorGroup).toBeDefined();
            expect(rosellGroup).toBeDefined();
        });
    });
});

describe('SemanticAnalyzer - 实体提取和过滤', () => {
    it('从文本中提取名词实体', () => {
        const text = '克莱恩手持传国玉佩，来到了太古秘境。九阳神功在他体内流转。';
        const entities = SemanticAnalyzer.extractEntities(text);
        
        expect(entities).toContain('克莱恩');
        expect(entities).toContain('传国玉佩');
        expect(entities).toContain('太古秘境');
        expect(entities).toContain('九阳神功');
    });

    it('过滤噪声词（动词/副词/虚词）', () => {
        const words = ['修炼', '非常', '的', '克莱恩', '传国玉佩', '突然', '了'];
        const filtered = SemanticAnalyzer.filterNoiseWords(words);
        
        expect(filtered).toContain('克莱恩');
        expect(filtered).toContain('传国玉佩');
        expect(filtered).not.toContain('修炼');
        expect(filtered).not.toContain('非常');
        expect(filtered).not.toContain('的');
        expect(filtered).not.toContain('突然');
        expect(filtered).not.toContain('了');
    });

    it('归一化实体名（去掉前缀）', () => {
        expect(SemanticAnalyzer.normalizeEntityName('小克莱恩')).toBe('克莱恩');
        expect(SemanticAnalyzer.normalizeEntityName('老周')).toBe('周');
        expect(SemanticAnalyzer.normalizeEntityName('阿强')).toBe('强');
    });
});

describe('SemanticAnalyzer - 边界场景', () => {
    it('空字符串返回虚词', () => {
        const result = SemanticAnalyzer.analyzeWord('');
        expect(result.type).toBe('function');
    });

    it('单字返回未知', () => {
        const result = SemanticAnalyzer.analyzeWord('剑');
        expect(result.type).toBe('unknown');
    });

    it('中英文混排返回未知', () => {
        const result = SemanticAnalyzer.analyzeWord('Klein克莱恩');
        expect(result.type).toBe('unknown');
    });

    it('特殊字符返回未知', () => {
        const result = SemanticAnalyzer.analyzeWord('@#$');
        expect(result.type).toBe('unknown');
    });
});
