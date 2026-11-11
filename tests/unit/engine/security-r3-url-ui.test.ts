/**
 * S3-13 / S3-14（安全 r3）回归：
 * 1. 自定义更新 URL 必须 https、无内嵌凭据、非本机/内网（盲 SSRF）；
 * 2. 密钥/口令输入框统一禁自动填充与密码管理器接管。
 */

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isPrivateHost } from '../../../shared/private-host';
import { SECRET_INPUT_ATTRS } from '../../../shared/secret-display';

vi.mock('../../../main', () => ({ default: class NovelWriterPlugin {} }));

import { UpdateChecker } from '../../../services/update-checker';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function makeChecker(customUrl: string): UpdateChecker {
    const cache = {
        getUpdateLastCheck: () => null,
        setUpdateLastCheck: () => undefined,
        getUpdateLastResult: () => null,
        setUpdateLastResult: () => undefined,
    };
    return new UpdateChecker('4.81.1', cache as never, {
        enabled: true,
        source: 'custom',
        customUrl,
        checkIntervalHours: 1,
    });
}

describe('S3-13 自定义更新 URL 校验', () => {
    it('私网/回环地址被拒绝（盲 SSRF）', async () => {
        for (const url of ['https://127.0.0.1/update.json', 'https://localhost/x', 'https://[::1]/x', 'https://192.168.1.9/x']) {
            const result = await makeChecker(url).checkForUpdates(true);
            expect(result.errorKind, url).toBe('config');
            expect(result.error, url).toContain('本机/内网');
        }
    });

    it('http / 内嵌凭据被拒绝', async () => {
        const http = await makeChecker('http://example.com/update.json').checkForUpdates(true);
        expect(http.error).toContain('https');

        const creds = await makeChecker('https://user:pass@example.com/update.json').checkForUpdates(true);
        expect(creds.error).toContain('账号密码');
    });

    it('isPrivateHost 与考据服务同源（shared 单一实现）', () => {
        expect(isPrivateHost('localhost')).toBe(true);
        expect(isPrivateHost('fc00::1')).toBe(true);
        expect(isPrivateHost('example.com')).toBe(false);
        expect(read('services/canon-research-service.ts')).toContain("export { isPrivateHost } from '@/shared/private-host';");
    });
});

describe('S3-14 密钥输入框属性', () => {
    it('共享属性禁止自动填充/密码管理器', () => {
        expect(SECRET_INPUT_ATTRS.autocomplete).toBe('new-password');
        expect(SECRET_INPUT_ATTRS['data-1p-ignore']).toBe('true');
        expect(SECRET_INPUT_ATTRS['data-lpignore']).toBe('true');
    });

    it('四个密钥/口令输入点都接入', () => {
        for (const rel of [
            'ui/settings/api-section.ts',
            'ui/manage-providers-modal.ts',
        ]) {
            expect(read(rel)).toContain('SECRET_INPUT_ATTRS');
        }
        for (const rel of ['ui/password-modal.ts', 'ui/settings/general-sections.ts']) {
            const src = read(rel);
            expect(src).toContain("'autocomplete', 'new-password'");
            expect(src).toContain("'data-1p-ignore', 'true'");
        }
    });
});
