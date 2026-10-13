import { formatAgorot } from '@pinkas/shared';
import { Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { CategoryShare } from '../lib/report';

const palette = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#ea580c',
  '#4f46e5',
  '#0d9488',
  '#9333ea',
];

export const colorAt = (i: number): string => palette[i % palette.length] ?? '#2563eb';

export function CategoryDonut({
  data,
  onSelect,
}: {
  data: CategoryShare[];
  onSelect: (c: CategoryShare) => void;
}) {
  return (
    <div dir="ltr" className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data.map((c, i) => ({ ...c, fill: colorAt(i) }))}
            dataKey="amountAgorot"
            nameKey="nameHe"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={1}
            onClick={(_, index) => {
              const c = data[index];
              if (c) onSelect(c);
            }}
          />
          <Tooltip
            formatter={(value: unknown) => formatAgorot(typeof value === 'number' ? value : 0)}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
