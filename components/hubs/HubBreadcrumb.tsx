import Link from "next/link";

export interface BreadcrumbItem {
  label: string;
  /** Omitted on the current page, which renders as plain text with aria-current. */
  href?: string;
}

/**
 * Home › Ski Cams › {Label}. Server-rendered; the matching BreadcrumbList
 * JSON-LD is emitted by the page so the two can never disagree about the trail.
 */
export function HubBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-bark">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${index}-${item.label}`} className="flex items-center gap-2">
              {item.href && !last ? (
                <Link href={item.href} className="font-bold text-ink underline-offset-2 hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "text-bark" : "font-bold text-ink"}>
                  {item.label}
                </span>
              )}
              {!last && <span aria-hidden>›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
