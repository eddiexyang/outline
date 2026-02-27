import { observer } from "mobx-react";
import * as React from "react";
import type Document from "~/models/Document";
import useKeyDown from "~/hooks/useKeyDown";
import useStores from "~/hooks/useStores";
import { Wrapper } from "../components";
import { AccessControlList } from "./AccessControlList";

type Props = {
  /** The document to share. */
  document: Document;
  /** Callback fired when the popover requests to be closed. */
  onRequestClose: () => void;
  /** Whether the popover is visible. */
  visible: boolean;
};

function SharePopover({ document, onRequestClose, visible }: Props) {
  const { shares } = useStores();
  const share = shares.getByDocumentId(document.id);
  const sharedParent = shares.getByDocumentParents(document);
  const [hasRendered, setHasRendered] = React.useState(visible);

  useKeyDown(
    "Escape",
    (ev) => {
      if (!visible) {
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();

      onRequestClose();
    },
    {
      allowInInput: true,
    }
  );

  // Fetch share when the popover is opened
  React.useEffect(() => {
    if (visible) {
      void document.share();
      setHasRendered(true);
    }
  }, [document, visible]);

  if (!hasRendered) {
    return null;
  }

  return (
    <Wrapper>
      <AccessControlList
        document={document}
        share={share}
        sharedParent={sharedParent}
        visible={visible}
        onRequestClose={onRequestClose}
      />
    </Wrapper>
  );
}

export default observer(SharePopover);
