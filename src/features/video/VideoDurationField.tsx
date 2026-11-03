import { useState } from 'react'
import { useT } from '../../hooks/useI18n'
import { durationPolicy, supportsDuration } from './models'
import { fieldClass } from './VideoSettings'

export default function VideoDurationField({ modelId, value, onChange }: {
  modelId: string; value: number; onChange: (seconds: number) => void
}) {
  const t = useT()
  const policy = durationPolicy(modelId)
  const valid = supportsDuration(modelId, value)
  const [custom, setCustom] = useState(false)
  const customVisible = custom || valid && value !== -1 && !policy.presets.includes(value)
  const selection = customVisible ? 'custom' : valid ? String(value) : ''
  return <div className="min-w-0 space-y-1">
    <label className="block text-xs">{t('时长')}
      <select aria-label={t('时长')} className={`${fieldClass} mt-1`} value={selection}
        onChange={event => {
          const next = event.target.value
          setCustom(next === 'custom')
          if (next !== 'custom') onChange(Number(next))
          else if (value === -1) onChange(Number.NaN)
        }}>
        {!valid && !customVisible && <option value="" disabled>{t('请选择时长')}</option>}
        {policy.automatic && <option value="-1">{t('智能时长')}</option>}
        {policy.presets.map(seconds => <option key={seconds} value={seconds}>{t('{0} 秒', { 0: seconds })}</option>)}
        <option value="custom">{t('自定义时长')}</option>
      </select>
    </label>
    {customVisible && <input type="number" aria-label={t('自定义时长秒数')} aria-describedby="video-duration-hint"
      aria-invalid={!valid || value === -1} min={policy.min} max={policy.max} step={1}
      className={fieldClass} placeholder={`${policy.min}–${policy.max}`}
      value={value === -1 || !Number.isFinite(value) ? '' : value}
      onChange={event => onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))} />}
    <p id="video-duration-hint" className="text-[11px] leading-relaxed text-gray-500">{t('支持 {0}–{1} 秒整数时长', { 0: policy.min, 1: policy.max })}</p>
    {!valid && <p role="alert" className="text-xs text-amber-600">{t('当前模型不支持原时长，请重新选择。')}</p>}
  </div>
}
