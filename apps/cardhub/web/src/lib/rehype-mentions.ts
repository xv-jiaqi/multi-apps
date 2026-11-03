import { splitPlainMentions } from './mentions';

interface HastText {
  type: 'text';
  value: string;
}

interface HastElement {
  type: 'element';
  tagName: string;
  properties?: { className?: string[] };
  children: HastNode[];
}

type HastNode = HastText | HastElement | { type: string; children?: HastNode[]; value?: string };

function isElement(node: HastNode): node is HastElement {
  return node.type === 'element' && 'tagName' in node && Array.isArray(node.children);
}

function isText(node: HastNode): node is HastText {
  return node.type === 'text' && 'value' in node && typeof node.value === 'string';
}

const SKIP_TAGS = new Set(['a', 'code', 'pre']);

function mentionElement(value: string): HastElement {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['font-medium', 'text-link-strong'] },
    children: [{ type: 'text', value }],
  };
}

function childrenOf(node: HastNode): HastNode[] | null {
  if (!('children' in node) || !Array.isArray(node.children)) return null;
  return node.children;
}

function walk(node: HastNode, skip: boolean): void {
  const children = childrenOf(node);
  if (!children) return;
  const nextSkip = isElement(node) ? skip || SKIP_TAGS.has(node.tagName) : skip;
  const next: HastNode[] = [];
  for (const child of children) {
    if (!nextSkip && isText(child)) {
      const parts = splitPlainMentions(child.value);
      const hasMention = parts.some((part) => part.kind === 'mention');
      if (!hasMention) {
        next.push(child);
        continue;
      }
      for (const part of parts) {
        next.push(
          part.kind === 'mention'
            ? mentionElement(part.value)
            : { type: 'text', value: part.value },
        );
      }
      continue;
    }
    walk(child, nextSkip);
    next.push(child);
  }
  if (isElement(node) || node.type === 'root') node.children = next;
}

/** Runs after sanitize so mention spans are not stripped. Skips code and link text. */
export function rehypeMentions() {
  return (tree: HastNode) => {
    walk(tree, false);
  };
}
