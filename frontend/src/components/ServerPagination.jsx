/**
 * Server-side pager (page + count). Use for lists where the API paginates
 * (`?page=N`) instead of returning everything for usePagination to slice.
 *
 * Place at src/components/ServerPagination.jsx
 *
 * <ServerPagination page={page} count={count} onChange={setPage} />
 */
export default function ServerPagination({ page, count, onChange, size = 25 }) {
  const pages = Math.max(1, Math.ceil((count || 0) / size));
  if (!count || count <= size) return null;
  return (
    <div className="pagination pagination--bordered">
      <span className="pagination__info">Page <strong>{page}</strong> of <strong>{pages}</strong> · {count} items</span>
      <div className="pagination__list">
        <button className="pagination__btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
        <button className="pagination__btn active">{page}</button>
        <button className="pagination__btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
      </div>
    </div>
  );
}