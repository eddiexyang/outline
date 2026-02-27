import { observer } from "mobx-react";
import * as React from "react";
import styled from "styled-components";
import type Document from "~/models/Document";
import type Share from "~/models/Share";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import usePolicy from "~/hooks/usePolicy";
import { Separator } from "../components";
import PublicAccess from "./PublicAccess";

type Props = {
  /** The document being shared. */
  document: Document;
  /** The existing share model, if any. */
  share: Share | null | undefined;
  /** The existing share parent model, if any. */
  sharedParent: Share | null | undefined;
  /** Callback fired when the popover requests to be closed. */
  onRequestClose: () => void;
  /** Whether the popover is visible. */
  visible: boolean;
};

export const AccessControlList = observer(
  ({ document, share, sharedParent, onRequestClose, visible }: Props) => {
    const team = useCurrentTeam();
    const can = usePolicy(document);
    const collectionSharingDisabled = document.collection?.sharing === false;
    const publicAccessRef = React.useRef<HTMLDivElement | null>(null);

    if (
      !visible ||
      !team.sharing ||
      !can.share ||
      collectionSharingDisabled
    ) {
      return null;
    }

    return (
      <Wrapper>
        <Separator />
        <PublicAccess
          ref={publicAccessRef}
          document={document}
          share={share}
          sharedParent={sharedParent}
          onRequestClose={onRequestClose}
        />
      </Wrapper>
    );
  }
);

const Wrapper = styled.div`
  padding-bottom: 4px;
`;
