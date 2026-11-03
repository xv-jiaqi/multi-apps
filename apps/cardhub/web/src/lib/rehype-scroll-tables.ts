interface Element {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: RootContent[];
}
type RootContent = Element | { type: string };
interface Root {
  children: RootContent[];
}

function isElement(node: RootContent): node is Element {
  return node.type === 'element';
}

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/**
 * CH-220 v1.5 §2-4: a heading's accessible name — text nodes and image alt
 * joined in document order. hast-util-to-string skipped alt, so an
 * image-only heading came out empty.
 */
function accessibleText(nodes: RootContent[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') out += (node as { value?: string }).value ?? '';
    else if (isElement(node)) {
      if (node.tagName === 'img') {
        const alt = node.properties.alt;
        out += typeof alt === 'string' ? alt : '';
      } else out += accessibleText(node.children);
    }
  }
  return out;
}

/**
 * CH-220 §2-4: numbers Markdown tables in document order and records the
 * nearest preceding heading (any source level, pre-order). An empty name
 * counts as no heading; it does not fall back to an earlier one. Runs after
 * rehype-sanitize (and rehype-mentions on forum) so mention text counts.
 * Only writes when there are 2+ tables; MarkdownTable reads and drops them.
 */
export function rehypeScrollTables() {
  return (tree: Root) => {
    const tables: Array<{ node: Element; heading: string | undefined }> = [];
    let heading: string | undefined;
    const walk = (nodes: RootContent[]) => {
      for (const node of nodes) {
        if (!isElement(node)) continue;
        if (HEADINGS.has(node.tagName)) {
          const text = accessibleText(node.children).trim().replace(/\s+/g, ' ');
          heading = text || undefined;
          continue;
        }
        if (node.tagName === 'table') {
          tables.push({ node, heading });
          continue;
        }
        walk(node.children);
      }
    };
    walk(tree.children);
    if (tables.length < 2) return;
    tables.forEach(({ node, heading: h }, index) => {
      node.properties.dataScrollN = index + 1;
      if (h) node.properties.dataScrollHeading = h;
    });
  };
}
