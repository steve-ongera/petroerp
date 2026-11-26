/**
 * Small layout helpers for detail and form pages, so every page-card section looks like
 * the "Product List" block on the Products page.
 *
 * Usage:
 *   <section className="page-card">
 *     <SectionHeader first icon="bi-info-circle" title="Details" subtitle="3 items">
 *       <button className="btn btn-sm btn-primary">Action</button>
 *     </SectionHeader>
 *     <SectionBody><KV items={[['Label', 'Value']]} /></SectionBody>
 *   </section>
 *
 * Place at src/components/PageSection.jsx
 */

/** Header strip. Pass `first` for the first section in a card (no top border). */
export function SectionHeader({ icon = 'bi-list-ul', title, subtitle, first, children }) {
  return (
    <div className="table-wrap__header" style={first ? undefined : { borderTop: '1px solid var(--border-color)' }}>
      <span className="panel-title">
        <i className={`bi ${icon} text-brand`}></i>
        {title}
      </span>
      {subtitle && <span className="chart-card__subtitle">{subtitle}</span>}
      {children}
    </div>
  );
}

/** Padded body for forms, key/value blocks and free content. */
export function SectionBody({ children }) {
  return <div style={{ padding: '1rem 1.25rem' }}>{children}</div>;
}

/** Key/value grid. items = [[label, value], ...]; value may include a `danger` flag via {value, danger}. */
export function KV({ items }) {
  return (
    <div className="kv">
      {items.map(([label, value, danger]) => (
        <div className="kv__item" key={label}>
          <div className="kv__label">{label}</div>
          <div className={`kv__value ${danger ? 'text-danger' : ''}`}>{value}</div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon = 'bi-inbox', title, text }) {
  return (
    <div className="empty-state">
      <i className={`bi ${icon}`}></i>
      <h6>{title}</h6>
      {text && <p className="text-muted-soft">{text}</p>}
    </div>
  );
}