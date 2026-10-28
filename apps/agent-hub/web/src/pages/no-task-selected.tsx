import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { paths } from '../app/paths';
import { focusRing } from '../lib/format';

export function NoTaskSelected(): ReactElement {
  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-neutral-700">
      <p>
        未选择任务。
        <Link to={paths.newTask()} className={`ml-2 text-brand-700 underline ${focusRing}`}>
          新建任务
        </Link>
      </p>
    </div>
  );
}
