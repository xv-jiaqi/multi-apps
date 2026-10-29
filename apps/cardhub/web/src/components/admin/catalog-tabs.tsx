import { observer } from 'mobx-react-lite';
import { NavLink } from 'react-router';
import { t } from '@repo/shared';
import { useStores } from '../../stores/root-store';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-6 items-center rounded-md px-3 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
    isActive ? 'bg-neutral-900 text-white' : 'text-neutral-800 hover:bg-neutral-100'
  }`;

export const CatalogTabs = observer(function CatalogTabs() {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  return (
    <nav aria-label={tt('admin.catalog.title')} className="flex flex-wrap gap-2">
      <NavLink to="/admin/catalog" end className={tabClass}>
        {tt('admin.catalog.seriesTab')}
      </NavLink>
      <NavLink to="/admin/catalog/categories" className={tabClass}>
        {tt('admin.catalog.categoriesTab')}
      </NavLink>
    </nav>
  );
});
