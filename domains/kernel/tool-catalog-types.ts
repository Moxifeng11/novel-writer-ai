/** 工具目录中的一个按钮：展示信息 + 对应命令 ID。 */
export interface ToolButton {
    /** 中文展示名（zh 兜底；渲染请用 toolLabel() 取当前语言） */
    label: string;
    /** i18n 键（toolCatalog.<mode>.tool.<slug>） */
    labelKey?: string;
    /** 中文描述（zh 兜底；渲染请用 toolDesc() 取当前语言） */
    desc: string;
    /** i18n 键（...Desc） */
    descKey?: string;
    icon: string;
    commandId: string;
}

/** 工具分组；`defaultCollapsed` 控制初始折叠状态。 */
export interface ToolGroup {
    /** 中文分组名（zh 兜底；渲染请用 toolGroupLabel() 取当前语言） */
    label: string;
    /** i18n 键（toolCatalog.<mode>.group.<slug>） */
    labelKey?: string;
    buttons: ToolButton[];
    defaultCollapsed?: boolean;
}
