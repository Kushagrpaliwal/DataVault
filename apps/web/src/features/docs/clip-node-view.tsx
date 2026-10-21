import { useEditorState, NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ExternalLink, X } from "lucide-react";
import { inlineClipIds } from "@data-vault/notes";

/**
 * A piece of a web page, shown as a card.
 *
 * The card says where the piece came from and offers the two things a
 * reader wants: a link to the original page, and a way to take the piece
 * back out.
 *
 * When the heading above already names the source, the card is dropped and
 * the piece is shown as plain text. The link is then only written once, at
 * the top of the group, instead of once for every box.
 */
export function ClipNodeView({ node, deleteNode, editor }: NodeViewProps) {
  const attrs = node.attrs as { sourceUrl?: string; sourceTitle?: string; domain?: string; capturedAt?: string; clipId?: string };

  /**
   * The section above this piece is found from the document, so a piece that
   * was moved under another heading changes the moment it is moved.
   */
  const inline = useEditorState({
    editor,
    selector: ({ editor: instance }) => inlineClipIds(instance.state.doc).has(String(attrs.clipId ?? "")),
  });

  if (inline) {
    return (
      <NodeViewWrapper
        className="datavault-clip datavault-clip-inline"
        data-has-footer="true"
        data-source-title={attrs.sourceTitle ?? ""}
        data-domain={attrs.domain ?? ""}
        data-clip-id={attrs.clipId ?? ""}
      >
        <button type="button" className="datavault-clip-remove" onClick={deleteNode} title="Remove this piece">
          <X className="size-3.5" />
          <span className="sr-only">Remove this piece</span>
        </button>
        <NodeViewContent />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      className="datavault-clip"
      data-has-footer="true"
      data-source-title={attrs.sourceTitle ?? ""}
      data-domain={attrs.domain ?? ""}
      data-clip-id={attrs.clipId ?? ""}
    >
      <div className="datavault-clip-bar">
        <span className="datavault-clip-source">
          {attrs.sourceUrl ? (
            <a href={attrs.sourceUrl} target="_blank" rel="noreferrer noopener">
              {attrs.sourceTitle || attrs.sourceUrl}
              <ExternalLink className="size-3" />
            </a>
          ) : (
            <span>{attrs.sourceTitle || "Saved text"}</span>
          )}
          {attrs.domain ? <span className="datavault-clip-domain">· {attrs.domain}</span> : null}
        </span>
        <button type="button" className="datavault-clip-remove" onClick={deleteNode} title="Remove this piece">
          <X className="size-3.5" />
          <span className="sr-only">Remove this piece</span>
        </button>
      </div>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}
