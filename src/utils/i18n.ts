import { createContext, useContext, useEffect, useSyncExternalStore } from 'react'

export type Locale = 'en' | 'zh'

const translations: Record<Locale, Record<string, string>> = {
  en: {
    'search.placeholder': 'Search clipboard history...',
    'filter.all': 'All',
    'filter.text': 'Text',
    'filter.images': 'Images',
    'filter.files': 'Files',
    'filter.favorites': 'Favorites',
    'item.just_now': 'Just now',
    'item.min_ago': '{n}m ago',
    'item.hour_ago': '{n}h ago',
    'item.rich_text': 'Rich Text',
    'item.deleted': 'Item deleted',
    'item.undo': 'Undo',
    'item.files_count': '{n} files',
    'item.unfavorite': 'Unfavorite',
    'item.favorite': 'Favorite',
    'item.delete': 'Delete',
    'empty.no_history': 'No clipboard history',
    'empty.hint': 'Copy something to get started',
    'settings.title': 'Settings',
    'settings.back': 'Back',
    'settings.general': 'General',
    'settings.exclusions': 'Exclusions',
    'settings.max_items': 'Maximum items',
    'settings.expiration': 'Expiration (days)',
    'settings.hotkey': 'Global hotkey',
    'settings.hotkey_press': 'Press shortcut...',
    'settings.reset': 'Reset',
    'settings.theme': 'Theme',
    'settings.theme_dark': 'Dark',
    'settings.theme_light': 'Light',
    'settings.language': 'Language',
    'settings.lang_en': 'English',
    'settings.lang_zh': '中文',
    'settings.clear_history': 'Clear History',
    'settings.clear_confirm': 'Clear all history? Favorites preserved.',
    'settings.clear_confirm_btn': 'Confirm',
    'settings.clear_cancel': 'Cancel',
    'settings.clear_all': 'Clear All History',
    'settings.stats': 'Stats',
    'settings.stats_total': 'Total items: {n}',
    'settings.stats_fav': 'Favorites: {n}',
    'settings.stats_db': 'DB size: {s}',
    'settings.exclude_app': 'Exclude by application',
    'settings.exclude_app_placeholder': 'e.g. 1Password, KeePass',
    'settings.add': 'Add',
    'settings.no_exclude_app': 'No application exclusions',
    'settings.exclude_pattern': 'Exclude by content pattern (regex)',
    'settings.exclude_pattern_placeholder': 'e.g. ^password:',
    'settings.no_exclude_pattern': 'No content pattern exclusions',
    'settings.update_available': 'available — downloading…',
    'settings.update_ready': 'downloaded — restart to install',
    'settings.update_restart': 'Restart & install',
    'settings.update_check': 'Check for updates',
    'settings.update_checking': 'Checking…',
    'settings.update_none': 'You\'re up to date',
    'settings.update_error': 'Update check failed',
    'settings.update_progress': 'Downloading {p}%',
    'settings.update_section': 'Updates',
    'toast.copied_manual_paste': 'Copied — press Ctrl+V to paste',
  },
  zh: {
    'search.placeholder': '搜索剪贴板历史...',
    'filter.all': '全部',
    'filter.text': '文本',
    'filter.images': '图片',
    'filter.files': '文件',
    'filter.favorites': '收藏',
    'item.just_now': '刚刚',
    'item.min_ago': '{n}分钟前',
    'item.hour_ago': '{n}小时前',
    'item.rich_text': '富文本',
    'item.deleted': '已删除',
    'item.undo': '撤销',
    'item.files_count': '{n}个文件',
    'item.unfavorite': '取消收藏',
    'item.favorite': '收藏',
    'item.delete': '删除',
    'empty.no_history': '暂无剪贴板历史',
    'empty.hint': '复制内容以开始使用',
    'settings.title': '设置',
    'settings.back': '返回',
    'settings.general': '通用',
    'settings.exclusions': '排除',
    'settings.max_items': '最大条目数',
    'settings.expiration': '过期时间（天）',
    'settings.hotkey': '全局快捷键',
    'settings.hotkey_press': '按下快捷键...',
    'settings.reset': '重置',
    'settings.theme': '主题',
    'settings.theme_dark': '深色',
    'settings.theme_light': '浅色',
    'settings.language': '语言',
    'settings.lang_en': 'English',
    'settings.lang_zh': '中文',
    'settings.clear_history': '清除历史',
    'settings.clear_confirm': '清除所有历史？收藏项保留。',
    'settings.clear_confirm_btn': '确认',
    'settings.clear_cancel': '取消',
    'settings.clear_all': '清除全部历史',
    'settings.stats': '统计',
    'settings.stats_total': '总条目：{n}',
    'settings.stats_fav': '收藏：{n}',
    'settings.stats_db': '数据库大小：{s}',
    'settings.exclude_app': '按应用排除',
    'settings.exclude_app_placeholder': '例如 1Password, KeePass',
    'settings.add': '添加',
    'settings.no_exclude_app': '无应用排除项',
    'settings.exclude_pattern': '按内容模式排除（正则）',
    'settings.exclude_pattern_placeholder': '例如 ^password:',
    'settings.no_exclude_pattern': '无内容模式排除项',
    'settings.update_available': '可用 — 正在下载…',
    'settings.update_ready': '已下载 — 重启以安装',
    'settings.update_restart': '立即重启并升级',
    'settings.update_check': '检查更新',
    'settings.update_checking': '正在检查…',
    'settings.update_none': '已是最新版本',
    'settings.update_error': '检查更新失败',
    'settings.update_progress': '下载中 {p}%',
    'settings.update_section': '更新',
    'toast.copied_manual_paste': '已复制 — 按 Ctrl+V 粘贴',
  },
}

export interface I18nContextType {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

export const I18nContext = createContext<I18nContextType>({
  locale: 'en',
  setLocale: () => {},
  t: (key: string) => key,
})

export function useI18n(): I18nContextType {
  return useContext(I18nContext)
}

export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const text = translations[locale]?.[key]
  if (!text) return key
  if (!params) return text
  return Object.entries(params).reduce(
    (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
    text,
  )
}

// Returns the current Date and re-renders the caller on a coarse interval so
// relative-time labels (just-now / N minutes ago / N hours ago) progress
// without requiring external state to change.
//
// Implementation: a single shared setInterval drives the tick. Each consumer
// subscribes via React 18's useSyncExternalStore instead of mounting its own
// timer. With the previous per-component implementation, N mounted HistoryItem
// rows meant N setTimeout chains; now it's one timer regardless of N. The
// tick rate adapts off the elapsed time since the clock first started:
// 30s within the first hour, 60s up to a day, hourly thereafter. Anchor
// uses lazy start (only when the first consumer subscribes) so an idle UI
// never keeps a timer running.
const listeners = new Set<() => void>()
let currentNow: Date = new Date()
let timer: ReturnType<typeof setInterval> | null = null

function tick(): void {
  currentNow = new Date()
  // Snapshot listeners so an unsubscribe inside a notify doesn't skip peers.
  for (const listener of Array.from(listeners)) listener()
}

function startTicker(): void {
  if (timer) return
  timer = setInterval(tick, 30_000)
}

export function useNow(): Date {
  // Lazy start on first subscribe; cleanup only stops the timer if we were
  // the only listener.
  useEffect(() => {
    startTicker()
    return () => {
      // We don't stop the timer here — components remount frequently
      // (every list-row scroll in react-window can swap rows in/out) and
      // the interval is module-global. The process exit path is the only
      // honest stop point.
    }
  }, [])
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify)
      return () => {
        listeners.delete(notify)
      }
    },
    () => currentNow,
    () => currentNow,
  )
}
