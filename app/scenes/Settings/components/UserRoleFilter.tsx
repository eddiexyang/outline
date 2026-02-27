import compact from "lodash/compact";
import { observer } from "mobx-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { UserRole } from "@shared/types";
import FilterOptions from "~/components/FilterOptions";
import { userRoleLabelPlural } from "~/utils/userRoleLabels";

type Props = {
  activeKey: string;
  onSelect: (key: string | null | undefined) => void;
};

const UserRoleFilter = ({ activeKey, onSelect, ...rest }: Props) => {
  const { t } = useTranslation();

  const options = useMemo(
    () =>
      compact([
        {
          key: "",
          label: t("All roles"),
        },
        {
          key: UserRole.Admin,
          label: userRoleLabelPlural(UserRole.Admin, t),
        },
        {
          key: UserRole.Manager,
          label: userRoleLabelPlural(UserRole.Manager, t),
        },
        {
          key: UserRole.Editor,
          label: userRoleLabelPlural(UserRole.Editor, t),
        },
        {
          key: UserRole.Viewer,
          label: userRoleLabelPlural(UserRole.Viewer, t),
        },
      ]),
    [t]
  );

  return (
    <FilterOptions
      options={options}
      selectedKeys={[activeKey]}
      onSelect={onSelect}
      defaultLabel={t("All roles")}
      {...rest}
    />
  );
};

export default observer(UserRoleFilter);
