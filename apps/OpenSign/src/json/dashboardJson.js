const dashboardJson = [
  {
    id: "35KBoSgoAK",
    columns: [
      {
        colsize: "col-span-12 md:col-span-6 lg:col-span-6",
        widget: {
          type: "Card",
          icon: "fa-light fa-signature",
          bgColor:
            "bg-[linear-gradient(90deg,#24105F_0%,#35147D_25%,#5A27A8_50%,#8B35C9_75%,#D936B8_100%)]",
          textColor: "text-white",
          tooltipIconColor: "#FFFFFF",
          label: "Need your Signature",
          description: null,
          data: {
            id: "e04ee9dc-932d-6b80-0202-703fd154eb74",
            queryType: "",
            class: "contracts_Document",
            query:
              'where={"$and":[{"AuditTrail.UserPtr":{"$ne":{"__type":"Pointer","className": "contracts_Users","objectId":"#objectId#"}}},{"AuditTrail.Activity":{"$ne":"Signed"}}],"Signers":{"$in":[{"__type":"Pointer","className":"contracts_Users","objectId":"#objectId#"}]},"IsDeclined":{"$ne":true},"IsCompleted":{"$ne":true},"Type":{"$ne":"Folder"},"Placeholders":{"$ne":null},"ExpiryDate":{"#*gt":{"__type":"#Date#","iso":"#today#"}}}&count=1',
            key: "count",
            Redirect_type: "Report",
            Redirect_id: "4Hhwbp482K",
            tourSection: "tourcard1"
          }
        }
      },
      {
        colsize: "col-span-12 md:col-span-6 lg:col-span-6",
        widget: {
          type: "Card",
          icon: "fa-light fa-sign-out-alt",
          bgColor:
            "bg-[linear-gradient(90deg,#E5E0FF_0%,#DDD5FF_25%,#E8D7FA_50%,#F3D5F3_75%,#F8B9E5_100%)]",
          textColor: "text-[#3B1F7A]",
          tooltipIconColor: "#3B1F7A",
          label: "Out for signatures",
          description: null,
          data: {
            id: "c1935cc0-28d4-3d73-b72a-8c1e3d18a17f",
            queryType: "",
            class: "contracts_Document",
            query:
              'where={"Type":{"#*ne":"Folder"},"Signers":{"#*exists":true},"Placeholders":{"#*exists":true},"SignedUrl":{"#*exists":true},"IsCompleted":{"#*ne":true},"IsDeclined":{"#*ne":true},"IsArchive":{"#*ne":true},"CreatedBy":{"__type":"Pointer","className":"_User","objectId":"#UserId.objectId#"},"ExpiryDate":{"#*gt":{"__type":"#Date#","iso":"#today#"}}}&count=1&limit=0',
            key: "count",
            Redirect_type: "Report",
            Redirect_id: "1MwEuxLEkF",
            tourSection: "tourcard2"
          }
        }
      },
      {
        colsize: "col-span-12 md:col-span-6 lg:col-span-6",
        widget: {
          type: "report",
          reportId: "5Go51Q7T8r",
          label: "Recent signature requests",
          data: {
            tourSection: "tourreport1"
          }
        }
      },
      {
        colsize: "col-span-12 md:col-span-6 lg:col-span-6",
        widget: {
          type: "report",
          reportId: "d9k3UfYHBc",
          label: "Recently sent for signatures",
          data: {
            tourSection: "tourreport2"
          }
        }
      },
      {
        colsize: "col-span-12 md:col-span-12 lg:col-span-12",
        widget: {
          type: "report",
          reportId: "kC5mfynCi4",
          label: "Drafts",
          data: {
            tourSection: "tourreport3"
          }
        }
      }
    ]
  }
];
export default dashboardJson;
