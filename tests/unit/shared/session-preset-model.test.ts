/**
 * session-preset-model 单测：快照创建/适用性/差异/解析
 */

import { describe, expect, it } from 'vitest';
import {
    createSnapshot,
    diffPreset,
    parseSnapshot,
    presetFingerprint,
    SESSION_PRESET_VERSION,
    sessionPresetFileName,
    snapshotApplies,
    type SessionPresetPayload,
} from '@/shared/session-preset-model';

const payload: SessionPresetPayload = {
    provider: 'deepseek',
    model: 'deepseek-chat',
    wordTarget: 3000,
    mode: 'long',
    writingStyleId: 'style-a',
};

describe('presetFingerprint', () => {
    it('相同载荷指纹相同', () => {
        expect(presetFingerprint(payload)).toBe(presetFingerprint({ ...payload }));
    });

    it('任一字段变化指纹不同', () => {
        expect(presetFingerprint({ ...payload, model: 'other' })).not.toBe(presetFingerprint(payload));
    });
});

describe('createSnapshot', () => {
    it('带版本/会话/项目/时间与冻结载荷', () => {
        const snapshot = createSnapshot('s1', 'p/书A', payload, 1000);
        expect(snapshot.version).toBe(SESSION_PRESET_VERSION);
        expect(snapshot.sessionId).toBe('s1');
        expect(snapshot.project).toBe('p/书A');
        expect(snapshot.createdAt).toBe(1000);
        expect(snapshot.payload).toEqual(payload);
    });

    it('载荷是副本（后续修改不影响快照）', () => {
        const source = { ...payload };
        const snapshot = createSnapshot('s1', 'p', source, 1);
        source.model = 'changed';
        expect(snapshot.payload.model).toBe('deepseek-chat');
    });
});

describe('snapshotApplies', () => {
    const snapshot = createSnapshot('s1', 'p/书A', payload, 1);

    it('会话与项目一致时适用', () => {
        expect(snapshotApplies(snapshot, 's1', 'p/书A')).toBe(true);
    });

    it('会话不同不适用', () => {
        expect(snapshotApplies(snapshot, 's2', 'p/书A')).toBe(false);
    });

    it('项目不同不适用', () => {
        expect(snapshotApplies(snapshot, 's1', 'p/书B')).toBe(false);
    });

    it('版本不符不适用', () => {
        expect(snapshotApplies({ ...snapshot, version: 0 as never }, 's1', 'p/书A')).toBe(false);
    });
});

describe('diffPreset 变更提示', () => {
    const snapshot = createSnapshot('s1', 'p', payload, 1);

    it('无变化返回空数组', () => {
        expect(diffPreset(snapshot, { ...payload })).toEqual([]);
    });

    it('模型变化被识别', () => {
        expect(diffPreset(snapshot, { ...payload, model: 'deepseek-reasoner' })).toContain('模型');
    });

    it('多字段变化全部列出', () => {
        const changed = diffPreset(snapshot, { ...payload, wordTarget: 5000, mode: 'short' });
        expect(changed).toContain('目标字数');
        expect(changed).toContain('生成模式');
    });
});

describe('parseSnapshot 解析', () => {
    const raw = JSON.stringify(createSnapshot('s1', 'p', payload, 1));

    it('正常解析', () => {
        expect(parseSnapshot(raw)?.sessionId).toBe('s1');
    });

    it('版本不符返回 null', () => {
        expect(parseSnapshot(JSON.stringify({ version: 0, sessionId: 's1', project: 'p', payload }))).toBeNull();
    });

    it('缺少载荷返回 null', () => {
        expect(parseSnapshot(JSON.stringify({ version: 1, sessionId: 's1', project: 'p' }))).toBeNull();
    });

    it('损坏 JSON 返回 null', () => {
        expect(parseSnapshot('{oops')).toBeNull();
    });
});

describe('sessionPresetFileName', () => {
    it('非法字符被替换且长度受限', () => {
        const name = sessionPresetFileName('nw/项目:1 会话');
        expect(name.endsWith('.json')).toBe(true);
        expect(name).not.toContain('/');
        expect(name.length).toBeLessThanOrEqual(85);
    });
});
