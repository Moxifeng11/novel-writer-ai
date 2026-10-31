import { describe, expect, it } from 'vitest';
import {
    LEGACY_STORAGE_KEYS,
    NOVEL_WRITER_KEY_PREFIX,
    STORAGE_KEY_PREFIXES,
    STORAGE_KEYS,
    projectScopedKey,
} from '../../../shared/storage-keys';

describe('storage-keys — localStorage 键名唯一来源', () => {
    it('单值键保持既有键值（改值会让用户数据静默失效）', () => {
        expect(STORAGE_KEYS).toEqual({
            ideationFavorites: 'novel-writer-ideation-favorites',
            sidePanelCollapsed: 'novel-writer-side-panel-collapsed',
            timeEstimatorHistory: 'novel-writer-time-estimator-history',
        });
    });

    it('前缀键保持既有键值', () => {
        expect(STORAGE_KEY_PREFIXES).toEqual({
            operationConfirm: 'nw-op-confirm:',
            flowExport: 'novel-writer-flow-export-',
            wizardResults: 'novel-writer-wizard-',
        });
    });

    it('遗留键只用于清理，键值保持旧版', () => {
        expect(LEGACY_STORAGE_KEYS).toEqual([
            'novel-writer-reload-state',
            'novel-writer-user-reload',
        ]);
    });

    it('项目分桶键：项目名原样拼接，空项目落到 global', () => {
        expect(projectScopedKey(STORAGE_KEY_PREFIXES.wizardResults, '斗破')).toBe('novel-writer-wizard-斗破');
        expect(projectScopedKey(STORAGE_KEY_PREFIXES.wizardResults, '')).toBe('novel-writer-wizard-global');
        expect(projectScopedKey(STORAGE_KEY_PREFIXES.wizardResults, undefined)).toBe('novel-writer-wizard-global');
        expect(projectScopedKey(STORAGE_KEY_PREFIXES.wizardResults, null)).toBe('novel-writer-wizard-global');
    });

    it('所有键都落在已知命名空间内（novel-writer-* 或 nw-op-confirm:）', () => {
        const all = [
            ...Object.values(STORAGE_KEYS),
            ...Object.values(STORAGE_KEY_PREFIXES),
            ...LEGACY_STORAGE_KEYS,
        ];
        for (const key of all) {
            expect(key.startsWith(NOVEL_WRITER_KEY_PREFIX) || key.startsWith(STORAGE_KEY_PREFIXES.operationConfirm)).toBe(true);
        }
    });
});
