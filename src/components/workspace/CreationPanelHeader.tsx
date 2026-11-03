import { useT } from '../../hooks/useI18n'

export default function CreationPanelHeader({ title, collapsed, controls, onToggle }: {
  title: string; collapsed: boolean; controls: string; onToggle: () => void
}) {
  const t = useT()
  const label = t(collapsed ? 'expandGenerationPanel' : 'collapseGenerationPanel')
  return <div data-creation-panel-header className={`flex shrink-0 items-center gap-2 ${collapsed ? 'justify-center p-2' : 'justify-between p-4'}`}>
    {!collapsed && <h2 className="text-sm font-semibold">{title}</h2>}
    <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-controls={controls} aria-label={label} title={label}
      className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-2.5 text-gray-500 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-gray-400 dark:hover:bg-white/[0.06] md:min-h-10">
      <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth={1.5} />
        <path d="M9 4v16" strokeWidth={1.5} />
        <path d={collapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={`text-xs ${collapsed ? 'md:hidden' : ''}`}>{label}</span>
    </button>
  </div>
}
