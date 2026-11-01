// The injected function that reads a live tab's readable text, shared by AI Rename and the page
// agent's read_page_text.
//
// Chrome serializes an injected function's source and runs it in the page, so readReadablePage must
// stay self-contained: no imports, no module-level constants or helpers, only its arguments and
// nested functions. Types are fine: they are erased.

/**
 * `'article-first'` reads the first `article, main, [role="main"]`. `'main-first'` prefers `main`
 * and reads an `article` only when it is the page's only one.
 */
export type ReadablePageRoot = 'article-first' | 'main-first';

export interface ReadablePage
{
  url: string;
  title: string;
  description: string;
  language: string;
  markdownUrl?: string;
  /** innerText of the preferred root, spaces collapsed, newlines kept, cut at maxChars. */
  text: string;
  /** Length of the normalized text before the cut. */
  textLength: number;
}

export function readReadablePage(maxChars: number, rootRule: ReadablePageRoot): ReadablePage
{
  function preferredRoot(): Element | null
  {
    if (rootRule === 'article-first')
    {
      return document.querySelector('article, main, [role="main"]') || document.body;
    }
    const main = document.querySelector('main, [role="main"]');
    if (main) return main;
    // A feed or news front page has many articles and no main; one of them would hide the rest.
    const articles = document.querySelectorAll('article');
    return articles.length === 1 ? articles[0] : document.body;
  }

  const root = preferredRoot();
  // innerText reads only the rendered text, so hidden node content never reaches the model.
  const raw = root instanceof HTMLElement ? root.innerText : root?.textContent || '';
  // One character per whitespace run keeps lengths and cuts equal to collapsing every run to a
  // space, which AI Rename still does afterwards.
  const text = raw.replace(/\s+/g, run => (run.includes('\n') ? '\n' : ' ')).trim();
  const markdownLink = document.querySelector<HTMLLinkElement>('link[rel~="alternate"][type="text/markdown"]');

  return {
    url: location.href,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
    language: document.documentElement.lang || '',
    markdownUrl: markdownLink?.href,
    text: text.slice(0, maxChars),
    textLength: text.length,
  };
}
