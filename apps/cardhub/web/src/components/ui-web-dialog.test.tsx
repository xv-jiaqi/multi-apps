import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  ConfirmPhraseField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  isConfirmPhraseValid,
} from '@repo/ui-web';

function DialogExample() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>打开 Dialog</Button>
      </DialogTrigger>
      <DialogContent closeLabel="关闭 Dialog">
        <DialogHeader>
          <DialogTitle>编辑内容</DialogTitle>
          <DialogDescription>说明文字</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">取消</Button>
          <Button>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AlertDialogExample({ busy = false }: { busy?: boolean }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button>打开提醒</Button>
      </AlertDialogTrigger>
      <AlertDialogContent busy={busy}>
        <AlertDialogHeader>
          <AlertDialogTitle>删除系列</AlertDialogTitle>
          <AlertDialogDescription>删除后不能撤销</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={busy}>确认删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ariaTargetText(element: HTMLElement, attribute: string) {
  const id = element.getAttribute(attribute);
  expect(id).toBeTruthy();
  return document.getElementById(id ?? '')?.textContent;
}

describe('ui-web Dialog', () => {
  it('wires role, aria-labelledby and aria-describedby', async () => {
    const user = userEvent.setup();
    render(<DialogExample />);

    await user.click(screen.getByRole('button', { name: '打开 Dialog' }));

    const dialog = screen.getByRole('dialog', { name: '编辑内容' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(ariaTargetText(dialog, 'aria-labelledby')).toBe('编辑内容');
    expect(ariaTargetText(dialog, 'aria-describedby')).toBe('说明文字');
  });

  it('traps focus inside while tabbing', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">背景按钮</button>
        <DialogExample />
      </>,
    );

    await user.click(screen.getByRole('button', { name: '打开 Dialog' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '取消' })).toHaveFocus());

    await user.tab();
    expect(screen.getByRole('button', { name: '保存' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: '关闭 Dialog' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
  });

  it('closes with Esc and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<DialogExample />);

    const trigger = screen.getByRole('button', { name: '打开 Dialog' });
    await user.click(trigger);
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

describe('ui-web AlertDialog', () => {
  it('wires alertdialog role, aria-labelledby and aria-describedby', async () => {
    const user = userEvent.setup();
    render(<AlertDialogExample />);

    await user.click(screen.getByRole('button', { name: '打开提醒' }));

    const dialog = screen.getByRole('alertdialog', { name: '删除系列' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(ariaTargetText(dialog, 'aria-labelledby')).toBe('删除系列');
    expect(ariaTargetText(dialog, 'aria-describedby')).toBe('删除后不能撤销');
  });

  it('focuses cancel first and keeps tab focus inside', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">背景按钮</button>
        <AlertDialogExample />
      </>,
    );

    await user.click(screen.getByRole('button', { name: '打开提醒' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '取消' })).toHaveFocus());

    await user.tab();
    expect(screen.getByRole('button', { name: '确认删除' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
  });

  it('closes with Esc unless busy', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AlertDialogExample />);

    const trigger = screen.getByRole('button', { name: '打开提醒' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();

    rerender(<AlertDialogExample busy />);
    await user.click(screen.getByRole('button', { name: '打开提醒' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('does not close when clicking the overlay', async () => {
    const user = userEvent.setup();
    render(<AlertDialogExample />);

    await user.click(screen.getByRole('button', { name: '打开提醒' }));
    await user.click(document.querySelector('[data-radix-alert-dialog-overlay]') as HTMLElement);

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('lets callers restore focus when the trigger is gone', async () => {
    const user = userEvent.setup();
    function RemovingTriggerExample() {
      const [open, setOpen] = React.useState(false);
      const [showTrigger, setShowTrigger] = React.useState(true);
      const statusRef = React.useRef<HTMLParagraphElement>(null);

      return (
        <>
          <p ref={statusRef} tabIndex={-1}>
            已删除
          </p>
          <AlertDialog open={open} onOpenChange={setOpen}>
            {showTrigger ? (
              <AlertDialogTrigger asChild>
                <Button>删除行</Button>
              </AlertDialogTrigger>
            ) : null}
            <AlertDialogContent
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                statusRef.current?.focus();
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>删除这一行</AlertDialogTitle>
                <AlertDialogDescription>删除后不能撤销</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => setShowTrigger(false)}>确认</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      );
    }

    render(<RemovingTriggerExample />);

    await user.click(screen.getByRole('button', { name: '删除行' }));
    await user.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByText('已删除')).toHaveFocus();
  });
});

describe('ConfirmPhraseField', () => {
  it('validates trimmed exact matches and keeps case sensitivity', () => {
    expect(isConfirmPhraseValid(' forge-of-titans ', 'forge-of-titans')).toBe(true);
    expect(isConfirmPhraseValid('Forge-of-titans', 'forge-of-titans')).toBe(false);
    expect(isConfirmPhraseValid('forge', 'forge-of-titans')).toBe(false);
  });

  it('reports changes through a controlled input', async () => {
    const user = userEvent.setup();
    function Example() {
      const [value, setValue] = React.useState('');
      const canConfirm = isConfirmPhraseValid(value, 'forge-of-titans');

      return (
        <>
          <ConfirmPhraseField
            id="confirm-slug"
            label="输入系列 slug 以确认"
            value={value}
            onValueChange={setValue}
            description="必须完全一致"
            descriptionId="confirm-slug-description"
          />
          <Button disabled={!canConfirm}>永久删除</Button>
        </>
      );
    }

    render(<Example />);

    const input = screen.getByLabelText('输入系列 slug 以确认');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('autocapitalize', 'none');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input).toHaveAttribute('aria-describedby', 'confirm-slug-description');
    expect(screen.getByRole('button', { name: '永久删除' })).toBeDisabled();

    await user.type(input, ' forge-of-titans ');

    expect(screen.getByRole('button', { name: '永久删除' })).toBeEnabled();
  });
});
