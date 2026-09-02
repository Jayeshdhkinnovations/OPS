import React, { useEffect, useState } from "react";
import Table from "react-bootstrap/Table";
import Parse from "parse";
import { useTranslation } from "react-i18next";
import { getTrash } from "../constant/Utils";
import ModalUi from "../primitives/ModalUi";
import Loader from "../primitives/Loader";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function daysLeft(archivedAt) {
  if (!archivedAt) return 30;
  const archivedTime = new Date(archivedAt).getTime();
  const remainingMs = archivedTime + THIRTY_DAYS_MS - Date.now();
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
}

function OpensignTrash() {
  const { t } = useTranslation();
  const [trashData, setTrashData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState();
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [restoringId, setRestoringId] = useState("");

  const fetchTrash = async () => {
    setIsLoading(true);
    const res = await getTrash();
    if (res && res.error) {
      setError(t("something-went-wrong-mssg"));
    } else if (Array.isArray(res)) {
      setTrashData(res);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchTrash();
    // eslint-disable-next-line
  }, []);

  const handleRestore = async (doc) => {
    setRestoringId(doc.objectId);
    try {
      await Parse.Cloud.run("restoredocument", { docId: doc.objectId });
      setTrashData((prev) => prev.filter((d) => d.objectId !== doc.objectId));
    } catch (err) {
      console.error("Err restoring document", err);
      setError(t("something-went-wrong-mssg"));
    } finally {
      setRestoringId("");
    }
  };

  const handlePermanentDelete = async () => {
    if (!deleteTarget) return;
    try {
      await Parse.Cloud.run("permanentlydeletedocument", {
        docId: deleteTarget.objectId
      });
      setTrashData((prev) =>
        prev.filter((d) => d.objectId !== deleteTarget.objectId)
      );
    } catch (err) {
      console.error("Err permanently deleting document", err);
      setError(t("something-went-wrong-mssg"));
    } finally {
      setDeleteTarget();
      setDeleteConfirmText("");
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-[100vh] w-full">
        <Loader />
      </div>
    );
  }

  return (
    <div className="bg-base-100 text-base-content rounded-box w-full shadow-md">
      <div className="flex flex-row justify-between items-center px-[15px] md:px-[25px] pt-2 md:pt-[20px] pb-2">
        <span className="text-[18px] font-medium">{t("sidebar.Trash")}</span>
      </div>
      {error && (
        <div className="px-[15px] md:px-[25px] text-[red] text-[13px] pb-2">
          {error}
        </div>
      )}
      {trashData.length === 0 ? (
        <div className="flex justify-center items-center w-full h-[50vh]">
          <span className="text-base-content font-bold">{t("no-data")}</span>
        </div>
      ) : (
        <div className="container-fluid px-0" style={{ overflowX: "auto" }}>
          <Table striped bordered hover>
            <thead>
              <tr>
                <th>{t("report-heading.Name")}</th>
                <th>{t("report-heading.Type")}</th>
                <th>{t("report-heading.created-date")}</th>
                <th>{t("days-left", { defaultValue: "Days left" })}</th>
                <th>{t("restore", { defaultValue: "Restore" })}</th>
                <th>{t("delete-permanently", {
                  defaultValue: "Delete permanently"
                })}</th>
              </tr>
            </thead>
            <tbody>
              {trashData.map((data) => (
                <tr key={data.objectId}>
                  <td className="flex items-center gap-2">
                    <i
                      className={`fa-light ${data.Type === "Folder" ? "fa-folder" : "fa-file"}`}
                      aria-hidden="true"
                    ></i>
                    <span className="text-[12px] font-medium">
                      {data.Name}
                    </span>
                  </td>
                  <td>{data.Type === "Folder" ? t("folder") : t("pdf")}</td>
                  <td>
                    {data.ArchivedAt
                      ? new Date(
                          data.ArchivedAt.iso || data.ArchivedAt
                        ).toLocaleDateString()
                      : "-"}
                  </td>
                  <td>{daysLeft(data.ArchivedAt?.iso || data.ArchivedAt)}</td>
                  <td>
                    <i
                      onClick={() => {
                        if (restoringId !== data.objectId) {
                          handleRestore(data);
                        }
                      }}
                      className="fa-light fa-rotate-left op-text-primary cursor-pointer"
                      aria-hidden="true"
                    ></i>
                  </td>
                  <td>
                    <i
                      onClick={() => {
                        setDeleteTarget(data);
                        setDeleteConfirmText("");
                      }}
                      className="fa-light fa-trash op-text-primary cursor-pointer"
                      aria-hidden="true"
                    ></i>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <ModalUi
        isOpen={!!deleteTarget}
        title={t("delete-permanently", { defaultValue: "Delete permanently" })}
        handleClose={() => {
          setDeleteTarget();
          setDeleteConfirmText("");
        }}
      >
        <div className="h-full p-[20px] text-base-content">
          <p>
            {t("delete-permanently-alert", {
              defaultValue:
                'This will permanently destroy "{{name}}". This cannot be undone. To confirm, type its name below.',
              name: deleteTarget?.Name
            })}
          </p>
          <input
            type="text"
            autoFocus
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={deleteTarget?.Name}
            className="op-input op-input-bordered op-input-sm w-full mt-2"
          />
          <div className="h-[1px] w-full bg-[#9f9f9f] my-[15px]"></div>
          <button
            disabled={deleteConfirmText !== deleteTarget?.Name}
            onClick={handlePermanentDelete}
            type="button"
            className="op-btn op-btn-primary mr-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("yes")}
          </button>
          <button
            onClick={() => {
              setDeleteTarget();
              setDeleteConfirmText("");
            }}
            type="button"
            className="op-btn op-btn-neutral"
          >
            {t("no")}
          </button>
        </div>
      </ModalUi>
    </div>
  );
}

export default OpensignTrash;
