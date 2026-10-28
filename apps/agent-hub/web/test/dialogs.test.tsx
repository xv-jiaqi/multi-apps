import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HubAlertDialog, HubDialog } from '../src/components/hub-dialog';
import { Markdown } from '../src/components/markdown';
import { botPanel } from '../src/desktop/bot-panel';

describe('对话框和 Markdown', () => {
  it('HubDialog 打开时调用 botPanel.occlude', async () => {
    const spy = vi.spyOn(botPanel, 'occlude').mockReturnValue(() => undefined);
    render(<HubDialog open onOpenChange={() => undefined} title="本地服务的最后输出" />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    spy.mockRestore();
  });

  it('HubAlertDialog 在 Promise 结束前显示处理中且关不掉', async () => {
    const user = userEvent.setup();
    let finish = (): void => undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onOpenChange = vi.fn();
    render(
      <HubAlertDialog
        open
        onOpenChange={onOpenChange}
        title="确认"
        description="说明"
        confirmText="确定"
        onConfirm={() => pending}
      />,
    );
    await user.click(screen.getByRole('button', { name: '确定' }));
    expect(screen.getByRole('button', { name: '处理中…' })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    finish();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('Markdown 去掉脚本、事件属性和 javascript: 链接，图片变成链接', () => {
    const { container } = render(
      <Markdown
        text={[
          '正文',
          '',
          '<script>alert(1)</script>',
          '',
          '<img src="x" onerror="alert(1)">',
          '',
          '[坏链接](javascript:alert(1))',
          '',
          '![示意图](https://cdn.example/a.png)',
        ].join('\n')}
      />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML.toLowerCase()).not.toContain('onerror');
    expect(container.innerHTML.toLowerCase()).not.toContain('javascript:');
    const link = screen.getByRole('link', { name: '示意图' });
    expect(link.getAttribute('href')).toBe('https://cdn.example/a.png');
  });
});
