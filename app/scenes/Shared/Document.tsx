import { observer } from "mobx-react";
import type { PublicTeam } from "@shared/types";
import { TOCPosition } from "@shared/types";
import type DocumentModel from "~/models/Document";
import DocumentComponent from "~/scenes/Document/components/Document";
import { useDocumentContext } from "~/components/DocumentContext";
import { useTeamContext } from "~/components/TeamContext";
import { useEffect, useMemo, useRef } from "react";
import useCurrentUser from "~/hooks/useCurrentUser";
import useShare from "@shared/hooks/useShare";
import useQuery from "~/hooks/useQuery";

type Props = {
  document: DocumentModel;
};

function SharedDocument({ document }: Props) {
  const { shareId } = useShare();
  const query = useQuery();
  const searchTerm = query.get("q") || undefined;
  const team = useTeamContext() as PublicTeam | undefined;
  useCurrentUser({ rejectOnEmpty: false });
  const { hasHeadings, setDocument, isEditorInitialized, editor } =
    useDocumentContext();
  const abilities = useMemo(() => ({}), []);
  const searchTermProcessed = useRef<string | null>(null);

  const tocPosition = hasHeadings
    ? (team?.tocPosition ?? TOCPosition.Left)
    : false;
  setDocument(document);

  // Highlight search term when navigating from search results
  useEffect(() => {
    if (
      isEditorInitialized &&
      editor &&
      searchTerm &&
      searchTermProcessed.current !== searchTerm
    ) {
      searchTermProcessed.current = searchTerm;
      editor.commands.find({ text: searchTerm });
    }
  }, [isEditorInitialized, editor, searchTerm]);

  return (
    <>
      <DocumentComponent
        abilities={abilities}
        document={document}
        shareId={shareId}
        tocPosition={tocPosition}
        readOnly
      />
    </>
  );
}

export const Document = observer(SharedDocument);
