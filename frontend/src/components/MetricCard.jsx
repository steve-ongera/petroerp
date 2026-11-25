// src/components/MetricCard.jsx
// Compact metric card. Styling lives in main.css (.dm-card), so there is no
// <style> block to inject. Legacy .stat-card markup is restyled by the same CSS.
//
// Usage:  <div className="stat-grid">
//           <MetricCard icon="bi-people" variant="primary" label="Students" value={412} sub="across 12 classes" />
//         </div>

// Kept so older imports of METRIC_CARD_CSS keep working (now a no-op).
export const METRIC_CARD_CSS = "";

export function MetricCard({ icon, variant = "primary", label, value, sub }) {
  return (
    <div className={`dm-card dm-card--${variant}`}>
      <div className="dm-card__top">
        <span className="dm-card__label">{label}</span>
        <span className="dm-card__icon"><i className={`bi ${icon}`} aria-hidden="true" /></span>
      </div>
      <div className="dm-card__num">{value}</div>
      {sub && <div className="dm-card__sub">{sub}</div>}
    </div>
  );
}

export default MetricCard;