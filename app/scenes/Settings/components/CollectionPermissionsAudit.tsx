import { observer } from "mobx-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Text from "@shared/components/Text";
import { type Column as TableColumn } from "~/components/Table";
import { SortableTable } from "~/components/SortableTable";
import { client } from "~/utils/ApiClient";

type PermissionRow = {
  id: string;
  subjectType: string;
  subjectId: string | null;
  subjectRole: string | null;
  subjectName?: string | null;
  resourceType: string;
  resourceId: string | null;
  permission: string;
  inheritMode: string;
  source: string;
};

const ROW_HEIGHT = 44;

export function CollectionPermissionsAudit() {
  const { t } = useTranslation();
  const [data, setData] = useState<PermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasNext, setHasNext] = useState(false);

  useEffect(() => {
    let mounted = true;
    const PAGE_SIZE = 100;

    const load = async () => {
      setLoading(true);
      try {
        const rows: PermissionRow[] = [];
        let offset = 0;
        let total = Infinity;

        while (offset < total) {
          const res = await client.post("/collections.permissions_all", {
            offset,
            limit: PAGE_SIZE,
          });
          const chunk: PermissionRow[] = res?.data ?? [];
          const paginationTotal: number | undefined = res?.pagination?.total;
          total = typeof paginationTotal === "number" ? paginationTotal : 0;
          rows.push(...chunk);

          if (!chunk.length || chunk.length < PAGE_SIZE) {
            break;
          }
          offset += PAGE_SIZE;
        }

        if (mounted) {
          setData(rows);
          setHasNext(false);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const columns = useMemo<TableColumn<PermissionRow>[]>(
    () => [
      {
        type: "data",
        id: "subject",
        header: t("Subject"),
        accessor: (row) =>
          row.subjectName ??
          row.subjectRole ??
          row.subjectId ??
          t("Unknown subject"),
        component: (row) => (
          <>
            {row.subjectName ??
              row.subjectRole ??
              row.subjectId ??
              t("Unknown subject")}
          </>
        ),
        width: "2fr",
      },
      {
        type: "data",
        id: "resource",
        header: t("Resource"),
        accessor: (row) =>
          row.resourceType === "workspace"
            ? "workspace"
            : `${row.resourceType}:${row.resourceId}`,
        component: (row) => (
          <>
            {row.resourceType === "workspace"
              ? t("Workspace")
              : `${row.resourceType}:${row.resourceId}`}
          </>
        ),
        width: "2fr",
      },
      {
        type: "data",
        id: "permission",
        header: t("Permission"),
        accessor: (row) => row.permission,
        component: (row) => <>{row.permission}</>,
        width: "1fr",
      },
      {
        type: "data",
        id: "inheritMode",
        header: t("Inheritance"),
        accessor: (row) => row.inheritMode,
        component: (row) => <>{row.inheritMode}</>,
        width: "1fr",
      },
      {
        type: "data",
        id: "source",
        header: t("Source"),
        accessor: (row) => row.source,
        component: (row) => <>{row.source}</>,
        width: "1fr",
      },
    ],
    [t]
  );

  return (
    <>
      <Text type="secondary" as="p">
        {t(
          "All collection permissions in the workspace, including inherited workspace grants."
        )}
      </Text>
      <SortableTable
        columns={columns}
        rowHeight={ROW_HEIGHT}
        data={data}
        loading={loading}
        sort={{ id: "subject", desc: false }}
        page={{ hasNext }}
      />
    </>
  );
}

export default observer(CollectionPermissionsAudit);
