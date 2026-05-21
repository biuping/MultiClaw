/**
 * 全局快捷键系统
 * 
 * Esc: 关闭当前面板/弹窗
 * Ctrl+K: 全局搜索
 * Ctrl+N: 新建任务
 */

import { useEffect, useCallback } from 'react';

export interface HotkeyConfig {
  onClose?: () => void;  // Esc
  onSearch?: () => void; // Ctrl+K
  onNew?: () => void;    // Ctrl+N
}

/**
 * 全局快捷键 Hook
 * 
 * 用法：
 * ```tsx
 * useHotkeys({
 *   onClose: () => setDrawerVisible(false),
 *   onSearch: () => setSearchVisible(true),
 *   onNew: () => setCreateVisible(true),
 * });
 * ```
 */
export function useHotkeys(config: HotkeyConfig) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // 忽略在输入框中的按键（除了 Esc）
    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
      (e.target as HTMLElement)?.tagName
    );

    // Esc - 关闭面板/弹窗
    if (e.key === 'Escape') {
      e.preventDefault();
      config.onClose?.();
      return;
    }

    // 输入框中不触发其他快捷键
    if (isInput) return;

    // Ctrl+K - 全局搜索
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      config.onSearch?.();
      return;
    }

    // Ctrl+N - 新建任务
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      config.onNew?.();
      return;
    }
  }, [config.onClose, config.onSearch, config.onNew]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

/**
 * 快捷键提示文案
 */
export const hotkeyHints = {
  esc: { label: 'Esc', desc: '关闭面板' },
  ctrlK: { label: '⌘K', desc: '全局搜索' },
  ctrlN: { label: '⌘N', desc: '新建任务' },
};
