import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import ButtonLarge from "~/components/ButtonLarge";
import ChangeLanguage from "~/components/ChangeLanguage";
import Flex from "~/components/Flex";
import Heading from "~/components/Heading";
import Input from "~/components/Input";
import Text from "~/components/Text";
import { detectLanguage } from "~/utils/language";
import { BackButton } from "./BackButton";
import { Background } from "./Background";
import { Centered } from "./Centered";
import { Form } from "~/components/primitives/Form";

const WorkspaceSetup = ({ onBack }: { onBack?: () => void }) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = React.useState(false);

  const handleExpand = React.useCallback(() => {
    setIsExpanded(true);
  }, []);

  return (
    <Background>
      <BackButton onBack={onBack} />
      <ChangeLanguage locale={detectLanguage()} />
      <Centered gap={12}>
        <StyledHeading centered>{t("Create workspace")}</StyledHeading>
        <Content>
          {t(
            "Setup your workspace by providing a name and details for admin login. You can change these later."
          )}
        </Content>
        <SetupForm
          action="/api/installation.create"
          method="POST"
          $expanded={isExpanded}
        >
          <CollapsedPane $expanded={isExpanded}>
            <ButtonLarge
              type="button"
              fullwidth
              onClick={handleExpand}
              aria-expanded={isExpanded}
            >
              {t("Create workspace")}
            </ButtonLarge>
          </CollapsedPane>
          <ExpandedPane $expanded={isExpanded}>
            <Inputs column gap={12}>
              <Input
                name="teamName"
                type="text"
                label={t("Workspace name")}
                placeholder="Acme, Inc"
                required={isExpanded}
                autoFocus={isExpanded}
                disabled={!isExpanded}
                flex
              />
              <Input
                name="userName"
                type="text"
                label={t("Admin name")}
                required={isExpanded}
                disabled={!isExpanded}
                flex
              />
              <Input
                name="userEmail"
                type="email"
                label={t("Admin email")}
                required={isExpanded}
                disabled={!isExpanded}
                flex
              />
            </Inputs>
            <ButtonLarge type="submit" fullwidth>
              {t("Continue")} →
            </ButtonLarge>
          </ExpandedPane>
        </SetupForm>
      </Centered>
    </Background>
  );
};

const Inputs = styled(Flex)`
  width: 100%;
  text-align: left;
`;

const StyledHeading = styled(Heading)`
  margin: 0;
`;

const Content = styled(Text)`
  color: ${s("textSecondary")};
  text-align: center;
  margin-top: -8px;
`;

const SetupForm = styled(Form)<{ $expanded: boolean }>`
  position: relative;
  width: 100%;
  min-height: 56px;
  max-height: ${(props) => (props.$expanded ? "420px" : "56px")};
  overflow: hidden;
  transition:
    max-height 260ms ease,
    transform 260ms ease;

  ${(props) =>
    props.$expanded &&
    `
      transform: translateY(0);
    `}
`;

const CollapsedPane = styled.div<{ $expanded: boolean }>`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: ${(props) => (props.$expanded ? 0 : 1)};
  transform: ${(props) =>
    props.$expanded ? "scale(0.98) translateY(-4px)" : "scale(1) translateY(0)"};
  pointer-events: ${(props) => (props.$expanded ? "none" : "auto")};
  transition:
    opacity 180ms ease,
    transform 220ms ease;
`;

const ExpandedPane = styled.div<{ $expanded: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 12px;
  opacity: ${(props) => (props.$expanded ? 1 : 0)};
  transform: ${(props) =>
    props.$expanded ? "translateY(0)" : "translateY(12px)"};
  pointer-events: ${(props) => (props.$expanded ? "auto" : "none")};
  transition:
    opacity 220ms ease,
    transform 240ms ease;
`;

export default WorkspaceSetup;
