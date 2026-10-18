// Server component: a selectable, wrapping code block in the poster's mono
// voice. No copy button on purpose (the page has no client state); the text
// is plain so triple-click or long-press selects it.
export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <pre
      aria-label={label}
      className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-[14px] border-[1.5px] border-ink bg-ink px-4 py-3 font-mono text-[13px] leading-relaxed text-cream-50 shadow-stamp-sm [overflow-wrap:anywhere]"
    >
      <code>{children}</code>
    </pre>
  );
}
