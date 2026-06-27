import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from '~/components/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders title, description, and confirm label when open', () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Delete item?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Delete item?')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Delete item?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not render when open is false', () => {
    render(
      <ConfirmDialog
        open={false}
        onOpenChange={vi.fn()}
        title="Delete item?"
        description="This cannot be undone."
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('uses "Confirm" as the default label', () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Are you sure?"
        description="Proceeding will make a change."
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('applies destructive class to confirm button when variant is destructive', () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Delete?"
        description="Gone forever."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete' }).className).toMatch(/destructive/);
  });
});
