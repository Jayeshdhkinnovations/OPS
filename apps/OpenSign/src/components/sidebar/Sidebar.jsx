import { useState, useEffect } from "react";
import Parse from "parse";
import Menu from "./Menu";
import Submenu from "./SubMenu";
import dp from "../../assets/images/dp.png";
import sidebarList, { subSetting } from "../../json/menuJson";
import { useNavigate } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import { useWindowSize } from "../../hook/useWindowSize";
import {
  setSelectedMenu,
  toggleSidebar
} from "../../redux/reducers/sidebarReducer";

// Bytes are unreadable in a sidebar; show the largest unit that stays short.
function formatStorageSize(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return "0 KB";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

const Sidebar = () => {
  const { width } = useWindowSize();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const isOpen = useSelector((state) => state.sidebar.isOpen);
  const [menuList, setmenuList] = useState([]);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const username = localStorage.getItem("username");
  const image = localStorage.getItem("profileImg") || dp;
  const tenantname = localStorage.getItem("Extand_Class")
    ? JSON.parse(localStorage.getItem("Extand_Class"))?.[0]?.Company
    : "";

  useEffect(() => {
    if (localStorage.getItem("accesstoken")) {
      menuItem();
    }
  }, []);

  const closeSidebar = () => {
    dispatch(setSelectedMenu(true));
    if (width <= 1023) {
      dispatch(toggleSidebar(false));
    }
  };

  const menuItem = async () => {
    try {
      if (localStorage.getItem("defaultmenuid")) {
        const Extand_Class = localStorage.getItem("Extand_Class");
        const extClass = Extand_Class && JSON.parse(Extand_Class);
        const userRole = extClass?.[0]?.UserRole || "contracts_User";
        const isAdmin =
          userRole === "contracts_Admin" || userRole === "contracts_OrgAdmin";
        const newSidebarList = sidebarList.map((item) => {
          if (item.title !== "Settings") return item;
          const newItem = { ...item };
          const baseChildren = isAdmin ? subSetting : subSetting?.slice(0, 1);
            const mysignature = newItem.children.slice(0, 1);
            newItem.children = [...mysignature, ...baseChildren];
          return newItem;
        });
        setmenuList(newSidebarList);
      }
    } catch (e) {
      console.error("Problem", e);
    }
  };

  const toggleSubmenu = (title) => {
    dispatch(setSelectedMenu(false));
    setSubmenuOpen({ [title]: !submenuOpen[title] });
  };

  const handleMenuItem = () => {
    dispatch(setSelectedMenu(true));
    closeSidebar();
    setSubmenuOpen({});
  };
  const handleProfile = () => {
    closeSidebar();
    navigate("/profile");
  };

  // Fetched once per mount from the same cloud function the Users page uses,
  // so the figure here and there can never disagree.
  const [storageUsed, setStorageUsed] = useState(null);
  useEffect(() => {
    let cancelled = false;
    Parse.Cloud.run("gettenantusage")
      .then((res) => {
        if (!cancelled) setStorageUsed(res?.usedStorage ?? 0);
      })
      .catch(() => {
        // Usage is informational - a failure just leaves the dash showing.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside
      className={`absolute max-lg:min-h-screen lg:relative bg-base-100 overflow-y-auto transition-all z-[500] shadow-lg hide-scrollbar flex flex-col
     ${isOpen ? "w-full md:w-64" : "w-0"}`}
    >
      <div className="flex px-2 py-3 gap-2 items-center shadow-md">
        <div
          onClick={() => handleProfile()}
          className="w-[75px] h-[75px] rounded-full ring-[2px] ring-offset-2 ring-gray-400 overflow-hidden cursor-pointer"
        >
          <img
            className="w-full h-full object-contain"
            src={image}
            alt="Profile"
          />
        </div>
        <div>
          <p
            onClick={handleProfile}
            className="text-[14px] font-bold text-base-content cursor-pointer"
          >
            {username}
          </p>
          <p
            onClick={handleProfile}
            className={`cursor-pointer text-[12px] text-base-content ${
              tenantname ? "mt-2" : ""
            }`}
          >
            {tenantname}
          </p>
        </div>
      </div>
      <nav
        className="op-menu op-menu-sm"
        aria-label="SignToowix Sidebar Navigation"
      >
        <ul
          className="text-sm"
          role="menubar"
          aria-label="SignToowix Sidebar Navigation"
        >
          {menuList.map((item) =>
            !item.children ? (
              <Menu
                key={item.title}
                item={item}
                isOpen={isOpen}
                closeSidebar={handleMenuItem}
              />
            ) : (
              <Submenu
                key={item.title}
                item={item}
                closeSidebar={closeSidebar}
                toggleSubmenu={toggleSubmenu}
                submenuOpen={submenuOpen}
              />
            )
          )}
        </ul>
      </nav>

      {/* Tenant storage, pinned to the foot of the sidebar so it is visible
          from every page rather than only the Users screen. */}
      {isOpen && (
        <div className="mt-auto border-t border-base-300 px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-base-content opacity-60">
            Storage used
          </div>
          <div className="mt-0.5 text-sm font-semibold text-base-content">
            {storageUsed === null ? "—" : formatStorageSize(storageUsed)}
          </div>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
