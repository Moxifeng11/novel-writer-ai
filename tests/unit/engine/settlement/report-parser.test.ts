/**
 * tests/unit/engine/settlement/report-parser.test.ts
 * 验证 AI 分析报告指令解析 — 纯函数测试（P1-2 拆分后新增）。
 */
import { describe, it, expect } from 'vitest';
import { parseReport, parseFrontmatterFromText, parseFmList } from '../../../../engine/settlement/report-parser';

describe('parseReport', () => {
    it('解析 UPDATE_CHARACTER 指令', () => {
        const r = parseReport('UPDATE_CHARACTER: [[张三]] | 修为 | 金丹后期');
        expect(r.uc).toHaveLength(1);
        expect(r.uc[0]).toEqual({ name: '张三', field: '修为', value: '金丹后期' });
    });

    it('解析 UPDATE_FACTION / UPDATE_LOCATION / UPDATE_ITEM / UPDATE_FORESHADOW', () => {
        const txt = `UPDATE_FACTION: [[青云宗]] | 势力影响 | 大涨
UPDATE_LOCATION: [[望月城]] | 状态 | 战火中
UPDATE_ITEM: [[剑]] | 等级 | 灵器
UPDATE_FORESHADOW: [[神秘玉佩]] | 状态 | 揭示`;
        const r = parseReport(txt);
        expect(r.ufa[0].name).toBe('青云宗');
        expect(r.uloc[0].field).toBe('状态');
        expect(r.uitem[0].value).toBe('灵器');
        expect(r.uf[0].name).toBe('神秘玉佩');
    });

    it('解析 NEW_CHARACTER / NEW_LOCATION / NEW_FACTION / NEW_ITEM', () => {
        const txt = `NEW_CHARACTER: 李四 | 主角好友
NEW_LOCATION: 月华谷 | 灵气浓郁
NEW_FACTION: 万兽门 | 兽修势力
NEW_ITEM: 玄铁剑 | 锋利无比`;
        const r = parseReport(txt);
        expect(r.nc[0]).toEqual({ name: '李四', description: '主角好友' });
        expect(r.nl[0].name).toBe('月华谷');
        expect(r.nf[0].description).toBe('兽修势力');
        expect(r.ni[0].name).toBe('玄铁剑');
    });

    it('解析 NEW_FORESHADOW v1.3.0 五字段格式', () => {
        const r = parseReport('NEW_FORESHADOW: 神秘老者出现 | 第3章 | 第20章 | 张三,李四 | 主线A');
        expect(r.nfs).toHaveLength(1);
        expect(r.nfs[0]).toEqual({
            name: '神秘老者出现',
            chapter: '第3章',
            reveal: '第20章',
            relatedChars: '张三,李四',
            relatedPlotline: '主线A',
        });
    });

    it('解析 NEW_FORESHADOW 旧 3 字段格式（向后兼容）', () => {
        const r = parseReport('NEW_FORESHADOW: 隐秘宝藏 | 第1章 | 第10章');
        expect(r.nfs).toHaveLength(1);
        expect(r.nfs[0].name).toBe('隐秘宝藏');
        expect(r.nfs[0].relatedChars).toBeUndefined();
    });

    it('解析 RELATION / GROWTH / EMOTION', () => {
        const txt = `RELATION: 张三|李四|师徒|结拜兄弟
GROWTH: 张三|修为|金丹后期|顿悟突破
EMOTION: [[张三]] | 喜悦 | 突破后心情大好`;
        const r = parseReport(txt);
        expect(r.rel[0]).toEqual({ entityA: '张三', entityB: '李四', relType: '师徒', desc: '结拜兄弟' });
        expect(r.growth[0].value).toBe('金丹后期');
        expect(r.emotion[0].emotion).toBe('喜悦');
    });

    it('解析 DELETE_ENTITY v1.4.0', () => {
        const r = parseReport('DELETE_ENTITY: 人物 | 路人甲');
        expect(r.del[0]).toEqual({ entityType: '人物', entityName: '路人甲' });
    });

    it('解析 CHARACTER_BEHAVIOR 指令（v4.20 角色行为摘要）', () => {
        const report = [
            'CHARACTER_BEHAVIOR: 武昭 | 擦刀时认出守卫的徽记。',
            'CHARACTER_BEHAVIOR: 沈青 | 拒绝死神的交易，锁上第一扇门。',
            '不是指令的行',
        ].join('\n');
        const instr = parseReport(report);
        expect(instr.behavior).toEqual([
            { name: '武昭', summary: '擦刀时认出守卫的徽记。' },
            { name: '沈青', summary: '拒绝死神的交易，锁上第一扇门。' },
        ]);
    });

    it('忽略不匹配的行', () => {
        const r = parseReport('这是一段说明文字\n\n# 报告标题\nUPDATE_CHARACTER: [[张三]] | 修为 | 金丹');
        expect(r.uc).toHaveLength(1);
    });

    it('空报告返回全空结构', () => {
        const r = parseReport('');
        expect(r.uc).toHaveLength(0);
        expect(r.nfs).toHaveLength(0);
        expect(r.del).toHaveLength(0);
    });
});

describe('parseFrontmatterFromText', () => {
    it('解析基本 frontmatter', () => {
        const r = parseFrontmatterFromText('---\ntitle: 第1章\nstatus: completed\n---\n\n正文');
        expect(r).toEqual({ title: '第1章', status: 'completed' });
    });

    it('去除引号', () => {
        const r = parseFrontmatterFromText('---\nname: "张三"\n---');
        expect(r.name).toBe('张三');
    });

    it('无 frontmatter 返回空对象', () => {
        expect(parseFrontmatterFromText('纯文本内容')).toEqual({});
    });
});

describe('parseFmList', () => {
    it('JSON 数组格式', () => {
        expect(parseFmList('["张三","李四"]')).toEqual(['张三', '李四']);
    });

    it('中文逗号/英文逗号/顿号分隔', () => {
        expect(parseFmList('张三,李四，王五、赵六')).toEqual(['张三', '李四', '王五', '赵六']);
    });

    it('空字符串返回空数组', () => {
        expect(parseFmList('')).toEqual([]);
        expect(parseFmList(undefined)).toEqual([]);
    });

    it('JSON 解析失败回退到分隔符', () => {
        expect(parseFmList('[不合法的JSON')).toEqual(['[不合法的JSON']);
    });
});
