import { CONNECT_TOOLS, MCP_RESOURCE_TEMPLATE } from "./links";

// Server component: the eight MCP tools plus the markdown resource, one line
// each. Stacks to two rows per tool under 640 px so it reads at 375 px.
export function ToolTable() {
  return (
    <div className="mt-4 overflow-hidden rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp">
      <table className="w-full border-collapse text-left text-[15px] leading-snug text-ink">
        <caption className="sr-only">PeakCam MCP tools and what each one answers</caption>
        <thead className="hidden sm:table-header-group">
          <tr className="border-b-[1.5px] border-ink bg-cream">
            <th scope="col" className="px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-bark">
              Tool
            </th>
            <th scope="col" className="px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-bark">
              What it answers
            </th>
          </tr>
        </thead>
        <tbody>
          {CONNECT_TOOLS.map((tool) => (
            <tr key={tool.name} className="block border-b-[1.5px] border-dashed border-bark/50 last:border-b-0 sm:table-row">
              <th scope="row" className="block px-4 pt-3 align-top font-mono text-[13px] font-bold text-ink sm:table-cell sm:w-[14rem] sm:py-3">
                {tool.name}
              </th>
              <td className="block px-4 pb-3 pt-1 align-top text-ink/90 sm:table-cell sm:py-3">{tool.summary}</td>
            </tr>
          ))}
          <tr className="block bg-cream sm:table-row">
            <th scope="row" className="block px-4 pt-3 align-top font-mono text-[13px] font-bold text-ink sm:table-cell sm:py-3">
              {MCP_RESOURCE_TEMPLATE}
            </th>
            <td className="block px-4 pb-3 pt-1 align-top text-ink/90 sm:table-cell sm:py-3">
              Resource: each resort as markdown, the same document as its <span className="font-mono text-[13px]">/index.md</span>{" "}
              page. Listed and completable by slug.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
