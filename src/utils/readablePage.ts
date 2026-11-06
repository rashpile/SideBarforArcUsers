// The injected function that reads a live tab's readable text for the page agent's read_page_text.
//
// Chrome serializes an injected function's source and runs it in the page, so readReadablePage must
// stay self-contained: no imports, no module-level constants or helpers, only its arguments and
// nested functions. Types are fine: they are erased.

export interface ReadablePage
{
  url: string;
  title: string;
  /** innerText of the preferred root, spaces collapsed, newlines kept, cut at maxChars. */
  text: string;
  /** Length of the normalized text before the cut. */
  textLength: number;
}

export function readReadablePage(maxChars: number): ReadablePage
{
  function preferredRoot(): Element | null
  {
    const main = document.querySelector('main, [role="main"]');
    if (main) return main;
    // A feed or news front page has many articles and no main; one of them would hide the rest.
    const articles = document.querySelectorAll('article');
    return articles.length === 1 ? articles[0] : document.body;
  }

  const root = preferredRoot();
  // innerText reads only the rendered text, so hidden node content never reaches the model.
  const raw = root instanceof HTMLElement ? root.innerText : root?.textContent || '';
  // A whitespace run with a line break becomes one newline, so the model keeps the paragraph
  // breaks without spending characters on the page's indentation.
  const text = raw.replace(/\s+/g, run => (run.includes('\n') ? '\n' : ' ')).trim();

  return {
    url: location.href,
    title: document.title,
    text: text.slice(0, maxChars),
    textLength: text.length,
  };
}
