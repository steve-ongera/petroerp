import { useEffect } from 'react';

const SIZE = { sm: 'modal-sm', lg: 'modal-lg', xl: 'modal-xl' };

/**
 * Shared modal, same props as the school portal's Modal:
 *   <Modal show onClose title subtitle icon="bi-..." size="lg|xl|sm" footer={<>...</>}>
 * Closes on Esc. `dismissOnBackdrop` also closes it on an outside click (use it only for read-only dialogs,
 * so a stray click never throws away a half-filled form).
 */
export default function Modal({ show, onClose, title, subtitle, icon, size, footer, dismissOnBackdrop = false, children }) {
  useEffect(() => {
    if (!show) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (dismissOnBackdrop && e.target === e.currentTarget) onClose?.(); }}
    >
      <div className={`modal-dialog ${SIZE[size] || ''}`}>
        <div className="modal-content">
          <div className="modal-header">
            {icon && <div className="modal-header__icon"><i className={`bi ${icon}`} aria-hidden="true" /></div>}
            <div className="modal-header__text">
              <h2 className="modal-title">{title}</h2>
              {subtitle && <p className="modal-subtitle">{subtitle}</p>}
            </div>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close">
              <i className="bi bi-x-lg" />
            </button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </div>
      </div>
    </div>
  );
}