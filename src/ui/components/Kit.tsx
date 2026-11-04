/** Ceyrom UI kit: buttons, cards, segmented controls, sliders, dialogs, top bars. */
import { ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { audio } from '../../game/audio';
import { useApp } from '../../store/stores';
import { IconBack } from './Icons';

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  wide,
  type = 'button',
  label,
  id,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  disabled?: boolean;
  wide?: boolean;
  type?: 'button' | 'submit';
  label?: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type={type}
      className={`btn btn-${variant} btn-${size}${wide ? ' btn-wide' : ''}${!children ? ' btn-icon' : ''}`}
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={() => {
        audio.unlock();
        audio.play('ui');
        onClick?.();
      }}
    >
      {icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  id,
}: {
  value: T;
  options: { value: T; label: ReactNode; hint?: string; locked?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  id: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label} id={id}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.locked}
          className={o.value === value ? 'on' : ''}
          title={o.hint}
          onClick={() => {
            audio.unlock();
            audio.play('ui');
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ id, value, onChange, label, min = 0, max = 1, step = 0.01, format }: { id: string; value: number; onChange: (v: number) => void; label: string; min?: number; max?: number; step?: number; format?: (v: number) => string }) {
  return (
    <label className="slider" htmlFor={id}>
      <span className="slider-label">{label}</span>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }} />
      <output htmlFor={id}>{format ? format(value) : Math.round(((value - min) / (max - min)) * 100)}</output>
    </label>
  );
}

export function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle" htmlFor={id}>
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden />
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function TopBar({ title, right, onBack }: { title: string; right?: ReactNode; onBack?: () => void }) {
  const { t } = useTranslation();
  const goBack = useApp((s) => s.goBack);
  return (
    <header className="topbar">
      <Button variant="ghost" icon={<IconBack />} label={t('common.back')} onClick={onBack ?? goBack} />
      <h1>{title}</h1>
      <div className="topbar-right">{right}</div>
    </header>
  );
}

export function Screen({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <main className={`screen ${className}`} id={id}>
      {children}
    </main>
  );
}

export function Dialog({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={(e) => (e.preventDefault(), onClose())} aria-labelledby="dialog-title">
      <div className="dialog-card">
        <h2 id="dialog-title">{title}</h2>
        <div className="dialog-body">{children}</div>
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </dialog>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
