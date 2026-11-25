import { useEffect, useMemo, useState } from 'react';

/**
 * Client-side paging helper for lists that are already fully loaded.
 *   const { pageRows, paginationProps } = usePagination(rows);
 *   ...map pageRows...   <Pagination {...paginationProps} />
 */
export function usePagination(rows, defaultSize = 25) {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(defaultSize);
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));

  // a new search/filter result set starts again on page 1
  useEffect(() => { setCurrentPage(1); }, [totalItems, itemsPerPage]);

  const startIndex = (currentPage - 1) * itemsPerPage;
  const pageRows = useMemo(() => rows.slice(startIndex, startIndex + itemsPerPage), [rows, startIndex, itemsPerPage]);

  return {
    pageRows,
    paginationProps: {
      currentPage,
      totalPages,
      onPageChange: (p) => { if (p >= 1 && p <= totalPages) setCurrentPage(p); },
      itemsPerPage,
      setItemsPerPage,
      startIndex,
      endIndex: startIndex + pageRows.length,
      totalItems,
    },
  };
}

function pageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) out.push('…l');
  for (let p = from; p <= to; p += 1) out.push(p);
  if (to < total - 1) out.push('…r');
  out.push(total);
  return out;
}

export default function Pagination({
  currentPage, totalPages, onPageChange, itemsPerPage, setItemsPerPage, startIndex, endIndex, totalItems,
}) {
  return (
    <div className="table-wrap__footer">
      <div className="table-wrap__footer-info">
        Showing <strong>{totalItems === 0 ? 0 : startIndex + 1}–{endIndex}</strong> of <strong>{totalItems}</strong>
      </div>

      <label className="per-page-select">
        <span>Rows</span>
        <select value={itemsPerPage} onChange={(e) => setItemsPerPage(Number(e.target.value))} aria-label="Rows per page">
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>

      <ul className="pagination">
        <li className={`page-item page-item--nav${currentPage === 1 ? ' disabled' : ''}`}>
          <button type="button" className="page-link" onClick={() => onPageChange(currentPage - 1)} aria-label="Previous page">
            <i className="bi bi-chevron-left" /> Prev
          </button>
        </li>
        {pageList(currentPage, totalPages).map((p) =>
          typeof p === 'string' ? (
            <li key={p} className="page-item page-ellipsis"><span className="page-link">…</span></li>
          ) : (
            <li key={p} className={`page-item${p === currentPage ? ' active' : ''}`}>
              <button type="button" className="page-link" onClick={() => onPageChange(p)} aria-current={p === currentPage ? 'page' : undefined}>
                {p}
              </button>
            </li>
          )
        )}
        <li className={`page-item page-item--nav${currentPage === totalPages ? ' disabled' : ''}`}>
          <button type="button" className="page-link" onClick={() => onPageChange(currentPage + 1)} aria-label="Next page">
            Next <i className="bi bi-chevron-right" />
          </button>
        </li>
      </ul>
    </div>
  );
}