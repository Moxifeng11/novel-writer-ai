import { createLogger } from '../shared/logger';

const log = createLogger('InternalRegistry');
export class InternalRegistry {
    private commands = new Map<string, () => Promise<void>>();
    
    register(id: string, action: () => Promise<void>) {
        this.commands.set(id, action);
        log.info('[Registry] Command registered: ' + id);
    }

    /** 检查命令是否已注册 */
    has(id: string): boolean {
        return this.commands.has(id);
    }
    
    async execute(id: string) {
        const action = this.commands.get(id);
        if (action) {
            log.info('[Registry] Executing: ' + id);
            await action();
        } else {
            log.error('[Registry] Command ' + id + ' not found');
        }
    }
}
