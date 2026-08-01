import { IconDatabaseOff } from '@tabler/icons-react';
import { MantineReactTable, useMantineReactTable } from 'mantine-react-table';

/* mantine-react-table wrapper — ui_mastercontext.md Section 4.2.
   Neumorphic container, uppercase header row, 48px hover rows, .neu-inset
   search input, neumorphic pagination, and the Section 10 empty state.
   Any other mantine-react-table option can be passed through and overrides
   the defaults below. */

export default function DataTable({
  columns,
  data,
  emptyMessage = 'No records found',
  emptyIcon: EmptyIcon = IconDatabaseOff,
  ...tableOptions
}) {
  const table = useMantineReactTable({
    columns,
    data,
    mantinePaperProps: {
      className: 'data-table-paper neu-raised',
      shadow: 'none',
      withBorder: false,
    },
    mantineTableProps: {
      className: 'data-table',
      highlightOnHover: false,
      striped: false,
    },
    mantineTableHeadCellProps: { className: 'data-table-head-cell' },
    mantineTableBodyRowProps: { className: 'data-table-row' },
    mantineSearchTextInputProps: {
      variant: 'unstyled',
      placeholder: 'Search',
      'aria-label': 'Search table',
    },
    mantinePaginationProps: {
      size: 'sm',
      radius: 'md',
    },
    initialState: { showGlobalFilter: true },
    renderEmptyRowsFallback: () => (
      <div className="empty-state">
        <EmptyIcon size={32} stroke={1.5} aria-hidden="true" />
        <span>{emptyMessage}</span>
      </div>
    ),
    ...tableOptions,
  });

  return <MantineReactTable table={table} />;
}
