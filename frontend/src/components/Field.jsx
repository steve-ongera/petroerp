/** Labelled form field used inside .form-grid (span = full width). */
export default function Field({ label, required, err, span, hint, children }) {
  return (
    <div className={`field${span ? ' span-all' : ''}${err ? ' has-error' : ''}`}>
      <label className="form-label">
        {label}
        {required && <span className="req"> *</span>}
      </label>
      {children}
      {err && <span className="form-text-error">{err}</span>}
      {hint && <div className="form-text-hint">{hint}</div>}
    </div>
  );
}