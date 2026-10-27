import type { ToolGroup } from '../../ui/full-writer/tool-catalog';

export type DomainMode = 'long' | 'short' | 'script';

export interface DomainConfig {
    mode: DomainMode;
    label: string;
    icon: string;
    storageRoot: string;
    toolGroups: ToolGroup[];
    /** 该域不允许出现的其它域命令 id */
    forbiddenCommandIds?: string[];
}

export interface DomainCommandDefinition {
    id: string;
    name: string;
    description?: string;
    mode: DomainMode | 'kernel';
}
