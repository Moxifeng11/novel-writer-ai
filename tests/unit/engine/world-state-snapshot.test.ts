import { describe, expect, it } from 'vitest';
import {
    buildChapterWorldStateSnapshot,
    formatChapterStateSnapshot,
    formatSnapshotForPrompt,
} from '../../../engine/world-state-snapshot';
import type { SceneTask } from '../../../engine/scene-generation-loop';

function scene(overrides: Partial<SceneTask> = {}): SceneTask {
    return {
        num: 1,
        name: '夜探',
        pov: '林晚',
        time: '亥时',
        location: '书房外',
        objective: '找密信',
        entryState: '警惕',
        conflict: '父亲在门内',
        turn: '听见咳血',
        exitState: '决定破门',
        emotionArc: '警惕 → 恐惧',
        sensoryHook: '血腥味',
        memoryTrigger: '无',
        bodyReaction: '手指发凉',
        subtext: '不敢推门',
        relationshipShift: '怨恨 → 担忧',
        keyScene: '否',
        dialogueFunction: '揭露病情',
        cliffhanger: '',
        characters: '林晚、父亲',
        rawBlock: '',
        ...overrides,
    };
}

describe('world-state-snapshot — 构建与格式化', () => {
    it('章节结束状态取最后一个场景，并选出相关人物', () => {
        const snap = buildChapterWorldStateSnapshot({
            chapterNum: 3,
            chapterName: '第3章',
            scenes: [scene(), scene({ num: 2, time: '子时', location: '书房内', exitState: '拿到密信' })],
            entityStates: [
                { name: '林晚', status: '受伤', emotion: '恐惧', location: '书房内', goal: '救父', knows: ['密信在柜中'], injuries: '左臂', items: '匕首' },
                { name: '父亲', status: '昏迷', emotion: '无', location: '书房内', goal: '', knows: [], injuries: '咳血', items: '' },
                { name: '路人', status: 'active', emotion: '', location: '街头', goal: '', knows: [], injuries: '', items: '' },
            ],
            relationships: [
                { a: '林晚', b: '父亲', trust: 80, attraction: 0, fear: 10, resentment: 20, dependence: 60, status: '父女' },
                { a: '路人', b: '父亲', trust: 10, attraction: 0, fear: 0, resentment: 0, dependence: 0, status: '陌生' },
            ],
            unresolvedForeshadows: ['密信', '咳血'],
        });

        expect(snap.time).toBe('子时');
        expect(snap.pov).toBe('林晚');
        expect(snap.locations).toEqual(['书房外', '书房内']);
        expect(snap.characters.map(c => c.name)).toEqual(['林晚', '父亲']);
        expect(snap.relationships).toHaveLength(1);
        expect(snap.unresolvedForeshadows).toEqual(['密信', '咳血']);
    });

    it('结算更新但实体表缺失的角色也保留一行', () => {
        const snap = buildChapterWorldStateSnapshot({
            chapterNum: 3,
            chapterName: '第3章',
            scenes: [],
            entityStates: [],
            updatedChars: ['新角色'],
        });
        expect(snap.characters[0]).toMatchObject({ name: '新角色', status: '未知' });
    });

    it('Markdown 包含人物/关系/承诺/伏笔固定表头', () => {
        const snap = buildChapterWorldStateSnapshot({
            chapterNum: 3,
            chapterName: '第3章',
            scenes: [scene()],
            entityStates: [
                { name: '林晚', status: '受伤', emotion: '恐惧', location: '书房内', goal: '救父', knows: ['密信'], injuries: '', items: '' },
            ],
            relationships: [
                { a: '林晚', b: '父亲', trust: 80, attraction: 0, fear: 10, resentment: 20, dependence: 60, status: '父女' },
            ],
            openPromises: ['答应救父'],
            unresolvedForeshadows: ['密信'],
        });
        const md = formatChapterStateSnapshot(snap);
        expect(md).toContain('## 人物状态');
        expect(md).toContain('| 角色 | 状态 | 情绪 | 位置 | 当前目标 | 已知信息 | 伤势/物品 |');
        expect(md).toContain('## 关系状态');
        expect(md).toContain('## 未兑现承诺');
        expect(md).toContain('- 答应救父');
        expect(md).toContain('## 未回收伏笔');
    });

    it('prompt 摘要包含硬约束句与人物状态', () => {
        const snap = buildChapterWorldStateSnapshot({
            chapterNum: 3,
            chapterName: '第3章',
            scenes: [scene()],
            entityStates: [
                { name: '林晚', status: '受伤', emotion: '恐惧', location: '书房内', goal: '救父', knows: ['密信'], injuries: '', items: '' },
            ],
        });
        const text = formatSnapshotForPrompt(snap);
        expect(text).toContain('【上一章结束状态（硬约束）】');
        expect(text).toContain('林晚');
        expect(text).toContain('本章开头必须与此状态一致');
    });
});
