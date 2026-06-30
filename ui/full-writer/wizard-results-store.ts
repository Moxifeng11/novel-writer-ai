import { Notice } from 'obsidian';

/**
 * v3.4.6 向导结果持久化：使用 Proxy 自动写入 localStorage。
 *
 * 从 FullWriterView._createPersistentWizardResults 外迁（D2）。
 * 行为逐字保留：storageKey 惰性求值，set/deleteProperty 写入 localStorage，
 * 读取/写入异常时降级为空对象并提示。
 *
 * @param getProject 返回当前项目名的惰性取值器（原代码用 self.project || 'global'）。
 */
export function createPersistentWizardResults(
    getProject: () => string
): Record<string, string> {
    const storageKey = () => `novel-writer-wizard-${getProject() || 'global'}`;
    // 尝试从 localStorage 恢复
    let initial: Record<string, string> = {};
    try {
        const key = storageKey();
        const saved = localStorage.getItem(key);
        if (saved) initial = JSON.parse(saved);
    } catch (e) {
        console.warn('[FullWriter] 存储失败:', e);
        new Notice('FullWriter：数据读取异常，部分功能可能受限');
    }
    return new Proxy(initial, {
        set(_target, prop, value) {
            _target[String(prop)] = value;
            try { localStorage.setItem(storageKey(), JSON.stringify(_target)); } catch (e) {
                console.warn('[FullWriter] 存储失败:', e);
                new Notice('FullWriter：数据读取异常，部分功能可能受限');
            }
            return true;
        },
        deleteProperty(_target, prop) {
            delete _target[String(prop)];
            try { localStorage.setItem(storageKey(), JSON.stringify(_target)); } catch (e) {
                console.warn('[FullWriter] 存储失败:', e);
                new Notice('FullWriter：数据读取异常，部分功能可能受限');
            }
            return true;
        }
    });
}
