import { useState } from 'react'
import { deleteImageGroup, saveImageGroup, useStore } from '../store'
import { useT } from '../hooks/useI18n'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'

export default function GroupManager({ onClose }: { onClose: () => void }) {
  const t = useT()
  const groups = useStore((state) => state.groups)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | undefined>()
  const [error, setError] = useState('')
  useCloseOnEscape(true, onClose)
  return <div data-no-drag-select className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label={t('manageGroups')} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(event) => event.stopPropagation()}>
      <div className="mb-4 flex justify-between"><h3>{t('manageGroups')}</h3><button onClick={onClose} aria-label={t('close')}>✕</button></div>
      <form className="flex gap-2" onSubmit={(event) => {
        event.preventDefault()
        try { saveImageGroup(name, editing); setName(''); setEditing(undefined); setError('') }
        catch (err) { setError(err instanceof Error ? err.message : String(err)) }
      }}>
        <input aria-label={t('groupName')} maxLength={40} value={name} onChange={(event) => setName(event.target.value)} placeholder={t('groupName')} className="min-w-0 flex-1 rounded-lg border px-3 py-2 dark:border-white/10 dark:bg-gray-800" />
        <button className="rounded-lg bg-blue-500 px-3 py-2 text-white">{t(editing ? 'confirm' : 'newGroup')}</button>
        {editing && <button type="button" onClick={() => { setEditing(undefined); setName('') }}>{t('cancel')}</button>}
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
      <div className="mt-3 max-h-[50vh] overflow-y-auto">
        {groups.map((group) => <div key={group.id} className="flex items-center gap-2 border-b py-3 dark:border-white/10">
          <span className="min-w-0 flex-1 truncate">{group.name}</span>
          <button className="text-xs text-blue-500" onClick={() => { setEditing(group.id); setName(group.name) }}>{t('renameGroup')}</button>
          <button className="text-xs text-red-500" onClick={() => useStore.getState().setConfirmDialog({
            title: t('deleteGroup'), message: t('deleteGroupHint', { name: group.name }),
            action: async () => {
              try { await deleteImageGroup(group.id); if (editing === group.id) { setEditing(undefined); setName('') } }
              catch (err) { setError(err instanceof Error ? err.message : String(err)) }
            },
          })}>{t('deleteGroup')}</button>
        </div>)}
      </div>
      <p className="mt-3 text-xs text-gray-500">{t('groupScopeHint')}</p>
    </div>
  </div>
}
