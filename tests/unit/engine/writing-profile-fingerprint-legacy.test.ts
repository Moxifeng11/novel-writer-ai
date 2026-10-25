import { describe, it, expect, vi } from 'vitest';

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        stringifyYaml: (value: any) => JSON.stringify(value),
    };
});

import { WritingProfileManager } from '../../../engine/writing-profile';

/**
 * 画像里的 `fingerprint.enabledProject` / `enabledGlobal` 全仓没有写入方、也没有消费方
 * （指纹启用状态的唯一真相源是指纹库），旧实现却因此让 11 步正文生成的指纹注入永远为空。
 * 字段删除后，旧画像文件里的这两个键必须被忽略，且不再写回。
 */

function makeManager(): WritingProfileManager {
    return Object.create(WritingProfileManager.prototype) as WritingProfileManager;
}

describe('WritingProfile — 旧指纹字段清理', () => {
    it('旧画像里的 enabledProject / enabledGlobal 被忽略，不进入结果对象', () => {
        const manager = makeManager();
        const normalized = (manager as any).normalizeProfile({
            projectName: '书甲',
            fingerprint: {
                enabledProject: ['fp_a'],
                enabledGlobal: ['fp_b'],
                templateInherited: ['tpl_1'],
                injectionStrength: 0.7,
            },
        });

        expect(normalized.fingerprint).toEqual({
            templateInherited: ['tpl_1'],
            injectionStrength: 0.7,
        });
        expect('enabledProject' in normalized.fingerprint).toBe(false);
        expect('enabledGlobal' in normalized.fingerprint).toBe(false);
    });

    it('缺少 fingerprint 时回落默认强度与空模板列表（回归）', () => {
        const manager = makeManager();
        const normalized = (manager as any).normalizeProfile({ projectName: '书乙' });

        expect(normalized.fingerprint).toEqual({
            templateInherited: [],
            injectionStrength: 0.5,
        });
    });

    it('再次保存不会再写出旧字段', () => {
        const manager = makeManager();
        const normalized = (manager as any).normalizeProfile({
            projectName: '书丙',
            fingerprint: { enabledProject: ['fp_a'], injectionStrength: 0.6 },
        });

        const serialized = (manager as any).serializeProfile(normalized);

        expect(serialized).not.toContain('enabledProject');
        expect(serialized).not.toContain('enabledGlobal');
        expect(serialized).toContain('"injectionStrength":0.6');
    });
});
