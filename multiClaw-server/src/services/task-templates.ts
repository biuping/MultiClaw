/**
 * 任务模板服务
 * 
 * 预设常用任务模板，支持内置模板 + 用户自定义/导入模板
 */

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  titleTemplate: string;
  descriptionTemplate: string;
  defaultPriority: 'low' | 'medium' | 'high';
  suggestedCoordinatorRole?: string;
  agentId?: string;
  agentName?: string;
  source: 'builtin' | 'custom' | 'imported';
  createdAt?: string;
}

/** 内置任务模板 */
export const builtinTemplates: TaskTemplate[] = [
  {
    id: 'builtin-code-review',
    name: '代码审查',
    description: '分配技术负责人审查代码质量和安全性',
    icon: '🔍',
    category: '开发',
    titleTemplate: '代码审查: {项目/模块名}',
    descriptionTemplate: '请对以下代码进行全面审查：\n\n1. 代码质量和可读性\n2. 潜在的安全漏洞\n3. 性能优化建议\n4. 最佳实践合规性\n\n审查范围: {具体文件/模块}',
    defaultPriority: 'high',
    suggestedCoordinatorRole: '技术',
    source: 'builtin',
  },
  {
    id: 'builtin-bug-fix',
    name: 'Bug 修复',
    description: '分析并修复报告的 Bug',
    icon: '🐛',
    category: '开发',
    titleTemplate: 'Bug修复: {Bug简述}',
    descriptionTemplate: 'Bug 描述: {详细描述}\n\n复现步骤:\n1. {步骤1}\n2. {步骤2}\n\n期望行为: {期望}\n实际行为: {实际}',
    defaultPriority: 'high',
    suggestedCoordinatorRole: '程序',
    source: 'builtin',
  },
  {
    id: 'builtin-feature-dev',
    name: '功能开发',
    description: '从需求分析到编码实现的新功能开发流程',
    icon: '✨',
    category: '开发',
    titleTemplate: '新功能: {功能名称}',
    descriptionTemplate: '功能需求: {需求描述}\n\n目标用户: {目标用户}\n验收标准:\n- {标准1}\n- {标准2}\n\n技术方案建议: {如有}',
    defaultPriority: 'medium',
    suggestedCoordinatorRole: '产品',
    source: 'builtin',
  },
  {
    id: 'builtin-doc-writing',
    name: '文档编写',
    description: '编写技术文档、API文档或用户手册',
    icon: '📝',
    category: '文档',
    titleTemplate: '文档编写: {文档类型}',
    descriptionTemplate: '文档类型: {技术文档/API文档/用户手册}\n\n覆盖范围: {需要文档化的模块/功能}\n\n目标读者: {开发者/用户/运维}\n\n特殊要求: {如有}',
    defaultPriority: 'medium',
    source: 'builtin',
  },
  {
    id: 'builtin-tech-research',
    name: '技术调研',
    description: '调研技术方案、竞品分析或可行性评估',
    icon: '🔬',
    category: '研究',
    titleTemplate: '技术调研: {调研主题}',
    descriptionTemplate: '调研主题: {主题}\n\n调研目标:\n- {目标1}\n- {目标2}\n\n需要对比的方案/产品: {如有}\n\n输出格式: 调研报告 + 推荐方案',
    defaultPriority: 'medium',
    suggestedCoordinatorRole: '技术',
    source: 'builtin',
  },
  {
    id: 'builtin-project-planning',
    name: '项目规划',
    description: '制定项目计划、任务分解和排期',
    icon: '📋',
    category: '管理',
    titleTemplate: '项目规划: {项目名}',
    descriptionTemplate: '项目概述: {简要描述}\n\n项目目标:\n- {目标1}\n- {目标2}\n\n时间要求: {截止日期/里程碑}\n可用资源: {团队成员/技术栈}\n\n需要输出: WBS + 排期 + 风险评估',
    defaultPriority: 'high',
    suggestedCoordinatorRole: '管理',
    source: 'builtin',
  },
  {
    id: 'builtin-code-refactor',
    name: '代码重构',
    description: '改善代码结构、消除技术债务',
    icon: '🔧',
    category: '开发',
    titleTemplate: '重构: {模块/文件名}',
    descriptionTemplate: '重构目标: {改善什么}\n\n当前问题:\n- {问题1}\n- {问题2}\n\n约束条件:\n- 保持向后兼容\n- 不改变外部接口\n\n期望结果: {期望}',
    defaultPriority: 'medium',
    suggestedCoordinatorRole: '程序',
    source: 'builtin',
  },
  {
    id: 'builtin-test-writing',
    name: '测试编写',
    description: '编写单元测试、集成测试或E2E测试',
    icon: '🧪',
    category: '开发',
    titleTemplate: '测试: {测试范围}',
    descriptionTemplate: '测试范围: {模块/功能名}\n\n测试类型: {单元测试/集成测试/E2E}\n\n覆盖要求: {覆盖率目标}\n\n已有测试框架: {Jest/Vitest/Mocha等}\n\n重点测试场景:\n- {场景1}\n- {场景2}',
    defaultPriority: 'medium',
    suggestedCoordinatorRole: '程序',
    source: 'builtin',
  },
];

// 内存中存储自定义/导入模板（可后续迁移到数据库）
let customTemplates: TaskTemplate[] = [];

/**
 * 获取所有模板（内置 + 自定义）
 */
export function getAllTemplates(): TaskTemplate[] {
  return [...builtinTemplates, ...customTemplates];
}

/**
 * 按 ID 获取模板
 */
export function getTemplateById(id: string): TaskTemplate | undefined {
  return builtinTemplates.find(t => t.id === id) || customTemplates.find(t => t.id === id);
}

/**
 * 按分类获取模板
 */
export function getTemplatesByCategory(category: string): TaskTemplate[] {
  return getAllTemplates().filter(t => t.category === category);
}

/**
 * 获取所有分类
 */
export function getCategories(): string[] {
  return [...new Set(getAllTemplates().map(t => t.category))];
}

/**
 * 创建自定义模板
 */
export function createTemplate(data: Omit<TaskTemplate, 'id' | 'createdAt'>): TaskTemplate {
  const template: TaskTemplate = {
    ...data,
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    source: data.source || 'custom',
  };
  customTemplates.push(template);
  return template;
}

/**
 * 更新自定义模板
 */
export function updateTemplate(id: string, data: Partial<TaskTemplate>): TaskTemplate | null {
  const idx = customTemplates.findIndex(t => t.id === id);
  if (idx === -1) return null;
  customTemplates[idx] = { ...customTemplates[idx], ...data, id };
  return customTemplates[idx];
}

/**
 * 删除自定义模板（内置模板不可删除）
 */
export function deleteTemplate(id: string): boolean {
  if (id.startsWith('builtin-')) return false;
  const idx = customTemplates.findIndex(t => t.id === id);
  if (idx === -1) return false;
  customTemplates.splice(idx, 1);
  return true;
}

/**
 * 填充模板变量（{变量名} 格式）
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => vars[key] || match);
}
