import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function ContextMenu({ context, title, caption, items, onClose }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: context.clientX, top: context.clientY });
  useLayoutEffect(() => {
    const menu = ref.current;
    const rect = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(context.clientX, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(context.clientY, window.innerHeight - rect.height - 8)),
    });
    menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [context]);

  useEffect(() => {
    const outside = event => { if (!ref.current?.contains(event.target)) onClose(false); };
    const dismiss = () => onClose(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('wheel', outside, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('wheel', outside, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [onClose]);

  const handleKey = event => {
    event.stopPropagation();
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const active = document.activeElement;
      if (ref.current.contains(active) && active.getAttribute('role') === 'menuitem' && !active.disabled) active.click();
      return;
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault(); onClose(true); return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...ref.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const current = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return createPortal(<div ref={ref} className="context-menu" style={position}
    role="menu" aria-label={title} onKeyDown={handleKey} onContextMenu={event => event.preventDefault()}>
    <div className="context-menu-heading">{title}</div>
    {caption && <div className="context-menu-caption">{caption}</div>}
    {items.map((item, index) => item.separator
      ? <div key={`separator-${index}`} className="context-menu-separator" role="separator" />
      : <button key={item.id} type="button" role="menuitem" tabIndex={-1} data-command={item.id}
        className={item.danger ? 'is-danger' : ''} disabled={item.disabled} title={item.reason || undefined}
        onClick={() => { onClose(true); item.action(); }}>
        <span>{item.label}</span>{item.reason && <small>{item.reason}</small>}
      </button>)}
  </div>, document.body);
}
