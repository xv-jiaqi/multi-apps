import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TopicForm } from './topic-form';

const labels = {
  titleLabel: '标题',
  titlePlaceholder: '',
  bodyLabel: '正文',
  bodyPlaceholder: '',
  markdownHint: '',
  mentionHint: '',
  showPreviewLabel: '预览',
  hidePreviewLabel: '收起预览',
  previewEmptyLabel: '空',
  cancelLabel: '取消',
  submitLabel: '发布',
  submittingLabel: '发布中',
};

describe('TopicForm preview (CH-221 §2-2)', () => {
  it('renders a source "# x" in the preview as h2, not h1', async () => {
    render(
      <TopicForm
        {...labels}
        initialTitle="t"
        initialBody={'# x\n\n### z'}
        error={null}
        isSubmitting={false}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: '预览' }));
    expect(document.querySelector('h1')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'x' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'z' })).toBeInTheDocument();
  });
});
