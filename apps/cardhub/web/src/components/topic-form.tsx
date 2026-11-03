import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@repo/ui-web';
import { MarkdownView } from './markdown-view';

interface TopicFormValues {
  title: string;
  body: string;
}

interface TopicFormProps {
  titleLabel: string;
  titlePlaceholder: string;
  bodyLabel: string;
  bodyPlaceholder: string;
  markdownHint: string;
  mentionHint: string;
  showPreviewLabel: string;
  hidePreviewLabel: string;
  previewEmptyLabel: string;
  cancelLabel: string;
  submitLabel: string;
  submittingLabel: string;
  initialTitle?: string;
  initialBody?: string;
  error: string | null;
  isSubmitting: boolean;
  submitDisabled?: boolean;
  focusTitle?: boolean;
  onCancel: () => void;
  onSubmit: (values: TopicFormValues) => void;
}

export function TopicForm({
  titleLabel,
  titlePlaceholder,
  bodyLabel,
  bodyPlaceholder,
  markdownHint,
  mentionHint,
  showPreviewLabel,
  hidePreviewLabel,
  previewEmptyLabel,
  cancelLabel,
  submitLabel,
  submittingLabel,
  initialTitle = '',
  initialBody = '',
  error,
  isSubmitting,
  submitDisabled = false,
  focusTitle = false,
  onCancel,
  onSubmit,
}: TopicFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [showPreview, setShowPreview] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(initialTitle);
    setBody(initialBody);
  }, [initialBody, initialTitle]);

  useEffect(() => {
    if (focusTitle) titleInputRef.current?.focus();
  }, [focusTitle]);

  const unchanged = title === initialTitle && body === initialBody;
  const disabled =
    isSubmitting ||
    submitDisabled ||
    !title.trim() ||
    !body.trim() ||
    (unchanged && !!initialTitle);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({ title, body });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="topic-title" className="text-sm font-medium text-neutral-700">
          {titleLabel}
        </label>
        <input
          ref={titleInputRef}
          id="topic-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          className="w-full rounded-md border border-input hover:border-input-hover bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-card aria-invalid:border-danger-line"
          placeholder={titlePlaceholder}
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label htmlFor="topic-body" className="text-sm font-medium text-neutral-700">
            {bodyLabel}
          </label>
          <button
            type="button"
            onClick={() => setShowPreview((value) => !value)}
            className="text-xs text-link hover:underline"
          >
            {showPreview ? hidePreviewLabel : showPreviewLabel}
          </button>
        </div>
        {showPreview ? (
          <div className="min-h-[16rem] rounded-md border border-neutral-200 bg-card px-3 py-2">
            {body.trim() ? (
              <MarkdownView body={body} />
            ) : (
              <p className="text-sm text-muted">{previewEmptyLabel}</p>
            )}
          </div>
        ) : (
          <textarea
            id="topic-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            maxLength={10_000}
            className="w-full resize-y rounded-md border border-input hover:border-input-hover bg-card px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-card aria-invalid:border-danger-line"
            placeholder={bodyPlaceholder}
          />
        )}
        <p className="text-xs text-muted">{markdownHint}</p>
        <p className="text-xs text-neutral-600">{mentionHint}</p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {cancelLabel}
        </Button>
        <Button type="submit" disabled={disabled}>
          {isSubmitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
