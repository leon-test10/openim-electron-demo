import type { ReactNode } from "react";

const renderInline = (text: string): ReactNode[] =>
  text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code key={index} className="rounded bg-black/5 px-1 dark:bg-white/10">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );

export const SafeMarkdown = ({ text }: { text: string }) => {
  const blocks = text.split(/(```[\s\S]*?```)/g);
  return (
    <div className="break-words text-sm leading-6">
      {blocks.map((block, index) => {
        if (block.startsWith("```") && block.endsWith("```")) {
          const code = block.slice(3, -3).replace(/^\w+\n/, "");
          return (
            <pre
              key={index}
              className="my-2 overflow-auto rounded-md bg-[#111827] p-3 text-xs text-[#e5e7eb]"
            >
              <code>{code}</code>
            </pre>
          );
        }
        return block.split("\n").map((line, lineIndex) => (
          <div
            key={`${index}-${lineIndex}`}
            className="min-h-[1.25rem] whitespace-pre-wrap"
          >
            {renderInline(line)}
          </div>
        ));
      })}
    </div>
  );
};
