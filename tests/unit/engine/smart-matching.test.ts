import { describe, it, expect } from 'vitest';
import { fuzzyMatchName, smartMatchName } from '../../../engine/cross-volume-outline-validator';

describe('fuzzyMatchName — 基础测试', () => {
    it('空名称返回 false', () => {
        expect(fuzzyMatchName('', '一些文本内容')).toBe(false);
    });

    it('空文本返回 false', () => {
        expect(fuzzyMatchName('某个事件名称', '')).toBe(false);
    });

    it('短名称（≤4字）返回 false', () => {
        expect(fuzzyMatchName('测试', '这是一段测试文本')).toBe(false);
        expect(fuzzyMatchName('abcd', '这是一段测试文本')).toBe(false);
    });

    it('匹配场景返回 true', () => {
        const name = '苍穹之痕觉醒之战';
        const text = '苍穹之痕迎来了觉醒之战，整个大陆为之震动';
        expect(fuzzyMatchName(name, text)).toBe(true);
    });

    it('不匹配场景返回 false', () => {
        const name = '苍穹之痕觉醒之战';
        const text = '林辰在公司加班改方案到凌晨，完全没有提到任何相关内容';
        expect(fuzzyMatchName(name, text)).toBe(false);
    });
});

describe('fuzzyMatchName — 粘连关键词场景（误报修复验证）', () => {
    it('"冥渊之谋暴露" 在 "冥渊的阴谋终于暴露，整个修真界为之震动" 中返回 true', () => {
        expect(fuzzyMatchName('冥渊之谋暴露', '冥渊的阴谋终于暴露，整个修真界为之震动')).toBe(true);
    });

    it('"苍穹之痕新平衡" 在 "苍穹之痕迎来了新的平衡，各方势力重新划分地盘" 中返回 true', () => {
        expect(fuzzyMatchName('苍穹之痕新平衡', '苍穹之痕迎来了新的平衡，各方势力重新划分地盘')).toBe(true);
    });

    it('"夜无痕真相揭露" 在 "夜无痕的真相终于被揭露，原来他是..." 中返回 true', () => {
        expect(fuzzyMatchName('夜无痕真相揭露', '夜无痕的真相终于被揭露，原来他是...')).toBe(true);
    });
});

describe('fuzzyMatchName — 多分隔符长名称场景（漏检修复验证）', () => {
    it('"冥渊与苏尘首次对峙" 在完全无关文本中返回 false', () => {
        expect(fuzzyMatchName('冥渊与苏尘首次对峙', '小明今天去超市买了很多水果，有苹果、香蕉和橙子')).toBe(false);
    });

    it('"苏家灭门真凶线索（天穹星宫暗部）" 在 "苏家灭门的真凶线索指向天穹星宫暗部" 中返回 true', () => {
        expect(fuzzyMatchName('苏家灭门真凶线索（天穹星宫暗部）', '苏家灭门的真凶线索指向天穹星宫暗部')).toBe(true);
    });
});

describe('fuzzyMatchName — 完全无关场景（不误通过验证）', () => {
    it('玄幻名称在都市职场文本中返回 false', () => {
        const name = '天帝证道之战';
        const text = '林辰在公司加班改方案到凌晨，第二天还要开早会汇报工作进度';
        expect(fuzzyMatchName(name, text)).toBe(false);
    });

    it('历史名称在科幻文本中返回 false', () => {
        const name = '玄武门之变真相';
        const text = '星际舰队在银河系边缘发现了外星文明的遗迹，科学家们兴奋不已';
        expect(fuzzyMatchName(name, text)).toBe(false);
    });
});

describe('smartMatchName — 双策略测试', () => {
    it('精确匹配能通过的场景，smartMatchName 也通过', () => {
        const name = '宗门覆灭';
        const text = '## 宗门覆灭\n反派攻陷宗门，主角被迫逃亡';
        expect(smartMatchName(name, text)).toBe(true);
    });

    it('精确匹配失败但模糊匹配通过的场景，smartMatchName 通过', () => {
        const name = '苍穹之痕觉醒之战';
        const text = '苍穹之痕迎来了觉醒之战，整个大陆为之震动';
        expect(smartMatchName(name, text)).toBe(true);
    });

    it('完全无关内容，smartMatchName 返回 false', () => {
        const name = '天帝证道之战';
        const text = '林辰在公司加班改方案到凌晨';
        expect(smartMatchName(name, text)).toBe(false);
    });
});

describe('smartMatchName — 跨题材测试（核心）', () => {
    it('玄幻："天帝证道之战" vs "最终天帝证道之战爆发，三界震动" → true', () => {
        expect(smartMatchName('天帝证道之战', '最终天帝证道之战爆发，三界震动')).toBe(true);
    });

    it('玄幻："天帝证道之战" vs "林辰在公司加班改方案到凌晨" → false', () => {
        expect(smartMatchName('天帝证道之战', '林辰在公司加班改方案到凌晨')).toBe(false);
    });

    it('都市："总裁契约妻归来" vs "三年后，总裁的契约妻带着孩子归来了" → true', () => {
        expect(smartMatchName('总裁契约妻归来', '三年后，总裁的契约妻带着孩子归来了')).toBe(true);
    });

    it('都市："总裁契约妻归来" vs "修士渡劫飞升，引来九天雷劫" → false', () => {
        expect(smartMatchName('总裁契约妻归来', '修士渡劫飞升，引来九天雷劫')).toBe(false);
    });

    it('历史："玄武门之变真相" vs "玄武门之变的真相终于被史官记录下来" → true', () => {
        expect(smartMatchName('玄武门之变真相', '玄武门之变的真相终于被史官记录下来')).toBe(true);
    });

    it('历史："玄武门之变真相" vs "星际舰队在银河系边缘发现了外星文明" → false', () => {
        expect(smartMatchName('玄武门之变真相', '星际舰队在银河系边缘发现了外星文明')).toBe(false);
    });

    it('科幻："星际穿越虫洞坍塌" vs "星际穿越时虫洞突然坍塌，船员们生死未卜" → true', () => {
        expect(smartMatchName('星际穿越虫洞坍塌', '星际穿越时虫洞突然坍塌，船员们生死未卜')).toBe(true);
    });

    it('科幻："星际穿越虫洞坍塌" vs "杨贵妃在马嵬坡下香消玉殒" → false', () => {
        expect(smartMatchName('星际穿越虫洞坍塌', '杨贵妃在马嵬坡下香消玉殒')).toBe(false);
    });

    it('言情："霸道总裁的替身娇妻" vs "霸道总裁的替身娇妻终于说出了真相" → true', () => {
        expect(smartMatchName('霸道总裁的替身娇妻', '霸道总裁的替身娇妻终于说出了真相')).toBe(true);
    });

    it('言情："霸道总裁的替身娇妻" vs "量子计算机突破了算力极限" → false', () => {
        expect(smartMatchName('霸道总裁的替身娇妻', '量子计算机突破了算力极限')).toBe(false);
    });
});
