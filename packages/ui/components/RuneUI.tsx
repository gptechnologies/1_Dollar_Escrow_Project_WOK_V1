import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { X } from 'lucide-react';

type RuneWindowProps = { title: string; icon?: ReactNode; children: ReactNode; className?: string; closeHref?: string };

export function RuneWindow({ title, icon, children, className = '', closeHref = '#top' }: RuneWindowProps) {
  return <section className={`rune-window ${className}`}><div className="rune-window-titlebar"><span className="rune-title-icon" aria-hidden>{icon}</span><h2>{title}</h2><a className="rune-close" href={closeHref} aria-label={`Close ${title}`}><X size={16} /></a></div><div className="rune-window-content">{children}</div></section>;
}

export function RunePanel({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return <section className={`rune-panel ${className}`}>{title && <h3 className="rune-panel-title">{title}</h3>}{children}</section>;
}

type RuneButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'success' | 'fund' | 'warning' | 'danger' | 'ghost' };
export function RuneButton({ variant = 'primary', className = '', children, ...props }: RuneButtonProps) {
  return <button className={`rune-button rune-button-${variant} ${className}`} {...props}>{children}</button>;
}
