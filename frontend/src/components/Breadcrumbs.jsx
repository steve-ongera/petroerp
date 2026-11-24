import { Link, useLocation } from 'react-router-dom';

import { NAV, titleFor } from '../navigation';

const isWithin = (pathname, path) => pathname === path || pathname.startsWith(`${path}/`);

/**
 * <Breadcrumbs />                         -> Home / Procurement / Suppliers (built from navigation.js)
 * <Breadcrumbs items={[{label, to}, ...]} /> -> custom trail; last item is the current page
 */
export default function Breadcrumbs({ items, backTo }) {
  const { pathname } = useLocation();

  let trail = items;
  if (!trail) {
    const group = NAV.find((n) => n.items?.some((i) => isWithin(pathname, i.path)));
    const page = group?.items.find((i) => isWithin(pathname, i.path));
    trail = [{ label: 'Home', to: '/' }];
    if (group) trail.push({ label: group.group });
    if (page && page.path !== pathname) trail.push({ label: page.label, to: page.path });
    trail.push({ label: titleFor(pathname) });
  }

  return (
    <nav aria-label="Breadcrumb">
      <ol className="breadcrumb">
        {backTo && (
          <li>
            <Link to={backTo} className="breadcrumb__back" aria-label="Back"><i className="bi bi-arrow-left" /></Link>
          </li>
        )}
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={`${c.label}-${i}`} className={`breadcrumb__item${last ? ' is-current' : ''}`} aria-current={last ? 'page' : undefined}>
              {c.to && !last ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}