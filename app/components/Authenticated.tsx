import { observer } from "mobx-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Redirect, useLocation } from "react-router-dom";
import useCurrentUser from "~/hooks/useCurrentUser";
import useStores from "~/hooks/useStores";
import { setPostLoginPath } from "~/hooks/useLastVisitedPath";
import { changeLanguage } from "~/utils/language";
import LoadingIndicator from "./LoadingIndicator";

type Props = {
  children: JSX.Element;
};

const Authenticated = ({ children }: Props) => {
  const { auth } = useStores();
  const { i18n } = useTranslation();
  const location = useLocation();
  const user = useCurrentUser({ rejectOnEmpty: false });
  const language = user?.language;
  const handledUnauthedRef = useRef(false);

  // Watching for language changes here as this is the earliest point we might have the user
  // available and means we can start loading translations faster
  useEffect(() => {
    void changeLanguage(language, i18n);
  }, [i18n, language]);

  useEffect(() => {
    if (auth.authenticated) {
      handledUnauthedRef.current = false;
      return;
    }

    if (auth.isFetching || handledUnauthedRef.current) {
      return;
    }

    handledUnauthedRef.current = true;
    setPostLoginPath(location.pathname + location.search);

    void auth.logout({
      savePath: false,
      clearCache: false,
      revokeToken: false,
    });
  }, [
    auth,
    auth.authenticated,
    auth.isFetching,
    location.pathname,
    location.search,
  ]);

  if (auth.authenticated) {
    return children;
  }

  if (auth.isFetching) {
    return <LoadingIndicator />;
  }

  if (auth.logoutRedirectUri) {
    window.location.href = auth.logoutRedirectUri;
    return null;
  }
  return <Redirect to="/" />;
};

export default observer(Authenticated);
