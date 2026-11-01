import React from 'react';
import clsx from 'clsx';
import type { MarkdownBlock, MarkdownHeadingLevel, MarkdownInline } from '../../utils/markdown';
import { safeLinkHref } from '../../utils/markdown';

const HEADING_CLASSES: Record<MarkdownHeadingLevel, string> = {
  1: 'text-[1.25em]',
  2: 'text-[1.15em]',
  3: 'text-[1.05em]',
  4: '',
  5: '',
  6: '',
};

const codeClass = 'rounded bg-gray-100 dark:bg-gray-800 font-mono text-[0.9em]';

/** A page agent answer, from the tree parseMarkdown builds. Every text goes in as a React text node. */
export const MarkdownView: React.FC<{ blocks: MarkdownBlock[]; className?: string }> = ({ blocks, className }) => (
  <div className={clsx('space-y-1.5 break-words', className)}>
    <Blocks blocks={blocks} />
  </div>
);

const Blocks: React.FC<{ blocks: MarkdownBlock[] }> = ({ blocks }) => (
  <>
    {blocks.map((block, index) => <Block key={index} block={block} />)}
  </>
);

const Block: React.FC<{ block: MarkdownBlock }> = ({ block }) =>
{
  switch (block.type)
  {
    case 'heading':
    {
      const Tag = `h${block.level}` as const;
      return (
        <Tag className={clsx('font-semibold leading-snug pt-0.5', HEADING_CLASSES[block.level])}>
          <Inlines inlines={block.children} />
        </Tag>
      );
    }
    case 'paragraph':
      return <p><Inlines inlines={block.children} /></p>;
    case 'codeBlock':
      return (
        <pre className={clsx(codeClass, 'overflow-x-auto p-1.5 whitespace-pre')}>
          <code>{block.text}</code>
        </pre>
      );
    case 'list':
    {
      const items = block.items.map((item, index) => (
        <li key={index} className="space-y-1">
          <Blocks blocks={item} />
        </li>
      ));
      return block.ordered
        ? <ol start={block.start} className="list-decimal pl-5 space-y-0.5">{items}</ol>
        : <ul className="list-disc pl-5 space-y-0.5">{items}</ul>;
    }
    case 'blockquote':
      return (
        <blockquote className="border-l-2 border-gray-300 dark:border-gray-600 pl-2 text-gray-600 dark:text-gray-300 space-y-1.5">
          <Blocks blocks={block.children} />
        </blockquote>
      );
    case 'rule':
      return <hr className="border-gray-200 dark:border-gray-700" />;
  }
};

const Inlines: React.FC<{ inlines: MarkdownInline[] }> = ({ inlines }) => (
  <>
    {inlines.map((inline, index) => <Inline key={index} inline={inline} />)}
  </>
);

const Inline: React.FC<{ inline: MarkdownInline }> = ({ inline }) =>
{
  switch (inline.type)
  {
    case 'text':
      return <>{inline.text}</>;
    case 'strong':
      return <strong className="font-semibold"><Inlines inlines={inline.children} /></strong>;
    case 'em':
      return <em><Inlines inlines={inline.children} /></em>;
    case 'code':
      return <code className={clsx(codeClass, 'px-1')}>{inline.text}</code>;
    case 'link':
    {
      // The parser keeps only http(s) links; checked again so this renderer never relies on it.
      const href = safeLinkHref(inline.href);
      if (href === null)
      {
        return <Inlines inlines={inline.children} />;
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">
          <Inlines inlines={inline.children} />
        </a>
      );
    }
    case 'break':
      return <br />;
  }
};
