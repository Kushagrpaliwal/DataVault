import { useEffect, useRef } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ExternalLink } from "lucide-react";
import { sourceUrlForSectionKey } from "@data-vault/notes";

/**
 * A heading that names where the pieces under it came from.
 *
 * The heading is the one place the source is written, so the pieces below it
 * do not have to repeat it. The little arrow opens the page or website the
 * section was made for.
 */
export function SectionHeadingView({ node }: NodeViewProps) {
  const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 2)));
  const key = typeof node.attrs?.sectionKey === "string" ? node.attrs.sectionKey : null;
  const url = sourceUrlForSectionKey(key);
  const Tag = (`h${level}` as "h1" | "h2" | "h3");
  const wrapper = useRef<HTMLElement>(null);

  /**
   * The wrapper is told which tag to use and leaves that on the element.
   * It is taken off again, so what the browser gets is plain HTML.
   */
  useEffect(() => {
    wrapper.current?.removeAttribute("as");
  }, []);

  return (
    <NodeViewWrapper ref={wrapper} as={Tag} className="datavault-section-heading">
      <NodeViewContent<"span"> as="span" />
      {url ? (
        <a className="datavault-section-link" href={url} target="_blank" rel="noreferrer noopener" title={url}>
          <ExternalLink className="size-3.5" />
          <span className="sr-only">Open the source of this section</span>
        </a>
      ) : null}
    </NodeViewWrapper>
  );
}
