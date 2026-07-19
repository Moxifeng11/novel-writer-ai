import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {
        settings = {};
        app = {};
    },
}));

import { AIApiClient } from '../../../engine/ai-api-client';

function callIsDisconnectionError(error: unknown, statusCode?: number): boolean {
    return (AIApiClient.prototype as any).isDisconnectionError.call({}, error, statusCode);
}

describe('isDisconnectionError', () => {
    it('网络类 TypeError（fetch failed）应判为断连', () => {
        expect(callIsDisconnectionError(new TypeError('fetch failed'))).toBe(true);
    });

    it('非网络 TypeError（读取 undefined 属性）不应判为断连', () => {
        expect(
            callIsDisconnectionError(
                new TypeError('Cannot read properties of undefined (reading x)')
            )
        ).toBe(false);
    });

    it('statusCode 500/502/503/504/408 应判为断连', () => {
        for (const code of [500, 502, 503, 504, 408]) {
            expect(callIsDisconnectionError(new Error('x'), code)).toBe(true);
        }
    });

    it('statusCode 400/401/403/404 不应判为断连', () => {
        for (const code of [400, 401, 403, 404]) {
            expect(callIsDisconnectionError(new Error('x'), code)).toBe(false);
        }
    });

    it('AbortError 应判为断连', () => {
        expect(callIsDisconnectionError({ name: 'AbortError' })).toBe(true);
    });

    it('普通 Error 且 message 含 econnrefused 应判为断连', () => {
        expect(callIsDisconnectionError(new Error('connect ECONNREFUSED 127.0.0.1'))).toBe(true);
    });

    it('普通 Error 且 message 无网络关键字不应判为断连', () => {
        expect(callIsDisconnectionError(new Error('some logic error'))).toBe(false);
    });
});
