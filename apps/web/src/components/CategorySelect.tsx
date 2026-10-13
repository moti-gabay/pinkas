import type { CategoryDto } from '@pinkas/shared';
import { useMemo } from 'react';
import { input } from './ui';

export function CategorySelect({
  categories,
  value,
  onChange,
  placeholder = 'ללא קטגוריה',
  className = '',
  disabled = false,
}: {
  categories: CategoryDto[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const groups = useMemo(() => {
    const bySort = (a: CategoryDto, b: CategoryDto) => a.sort - b.sort;
    const parents = categories.filter((c) => c.parentId === null).sort(bySort);
    return parents.map((p) => ({
      parent: p,
      children: categories.filter((c) => c.parentId === p.id).sort(bySort),
    }));
  }, [categories]);

  return (
    <select
      className={`${input} ${className}`}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => {
        onChange(e.target.value === '' ? null : e.target.value);
      }}
    >
      <option value="">{placeholder}</option>
      {groups.map(({ parent, children }) =>
        children.length === 0 ? (
          <option key={parent.id} value={parent.id}>
            {parent.nameHe}
          </option>
        ) : (
          <optgroup key={parent.id} label={parent.nameHe}>
            <option value={parent.id}>{parent.nameHe} (כללי)</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameHe}
              </option>
            ))}
          </optgroup>
        ),
      )}
    </select>
  );
}
