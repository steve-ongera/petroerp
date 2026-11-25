export default function TableSkeleton({ rows = 8, columns = 6 }) {
  return (
    <div className="table-wrap" aria-busy="true" aria-label="Loading">
      <div className="table-responsive">
        <table className="table mb-0">
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r} className="table-loading-row">
                {Array.from({ length: columns }).map((__, c) => (
                  <td key={c}><div className="skeleton" /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}