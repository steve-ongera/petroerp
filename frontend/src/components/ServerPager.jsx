/**
 * Pager for server-paginated lists (DRF PageNumberPagination: { count, results }).
 * Client-side lists keep using usePagination() + <Pagination /> from ./Pagination.
 *
 *   <ServerPager page={page} count={count} onChange={setPage} size={25} label="entries" />
 */
export default function ServerPager({ page, count, onChange, size = 25, label = 'items' }) {
  const total = count || 0;
  if (total <= size) return null;
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination pagination--bordered">
      <span className="pagination__info">
        Page <strong>{page}</strong> of <strong>{pages}</strong> · {total} {label}
      </span>
      <div className="pagination__list">
        <button type="button" className="pagination__btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
        <button type="button" className="pagination__btn active">{page}</button>
        <button type="button" className="pagination__btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
      </div>
    </div>
  );
}