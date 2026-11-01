/** 工具目录中的一个按钮：展示信息 + 对应命令 ID。 */
export interface ToolButton {
    label: string;
    desc: string;
    icon: string;
    commandId: string;
}

/** 工具分组；`defaultCollapsed` 控制初始折叠状态。 */
export interface ToolGroup {
    label: string;
    buttons: ToolButton[];
    defaultCollapsed?: boolean;
}
