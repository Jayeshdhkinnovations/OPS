import { useState, useEffect } from "react";
import { lazyWithRetry } from "./utils/lazyWithRetry";
import { hideUpgradeProgress } from "./utils/upgradeProgress";
import { Routes, Route, BrowserRouter } from "react-router";
import PageNotFound from "./pages/PageNotFound";
import ValidateRoute from "./primitives/ValidateRoute";
import Validate from "./primitives/Validate";
import Lazy from "./primitives/LazyPage";
import Loader from "./primitives/Loader";
import { serverUrl_fn } from "./constant/appinfo";
import DragProvider from "./components/DragProivder";
import Title from "./components/Title";
const HomeLayout = lazyWithRetry(() => import("./layout/HomeLayout"));
const DocSuccessPage = lazyWithRetry(() => import("./pages/DocSuccessPage"));
const Form = lazyWithRetry(() => import("./pages/Form"));
const Report = lazyWithRetry(() => import("./pages/Report"));
const Dashboard = lazyWithRetry(() => import("./pages/Dashboard"));
const TemplatePlaceholder = lazyWithRetry(() => import("./pages/TemplatePlaceholder"));
const SignYourSelf = lazyWithRetry(() => import("./pages/SignyourselfPdf"));
const DraftDocument = lazyWithRetry(() => import("./components/pdf/DraftDocument"));
const PlaceHolderSign = lazyWithRetry(() => import("./pages/PlaceHolderSign"));
const PdfRequestFiles = lazyWithRetry(() => import("./pages/PdfRequestFiles"));
const UserList = lazyWithRetry(() => import("./pages/UserList"));
const DebugPdf = lazyWithRetry(() => import("./pages/DebugPdf"));
const ForgetPassword = lazyWithRetry(() => import("./pages/ForgetPassword"));
const GuestLogin = lazyWithRetry(() => import("./pages/GuestLogin"));
const ChangePassword = lazyWithRetry(() => import("./pages/ChangePassword"));
const UserProfile = lazyWithRetry(() => import("./pages/UserProfile"));
const Opensigndrive = lazyWithRetry(() => import("./pages/Opensigndrive"));
const ManageSign = lazyWithRetry(() => import("./pages/Managesign"));
const AddAdmin = lazyWithRetry(() => import("./pages/AddAdmin"));
const UpdateExistUserAdmin = lazyWithRetry(
  () => import("./pages/UpdateExistUserAdmin")
);
const Preferences = lazyWithRetry(() => import("./pages/Preferences"));
const Login = lazyWithRetry(() => import("./pages/Login"));
const Register = lazyWithRetry(() => import("./pages/Register"));
const WaitingApproval = lazyWithRetry(() => import("./pages/WaitingApproval"));
const VerifyDocument = lazyWithRetry(() => import("./pages/VerifyDocument"));
const EmailBuilder = lazyWithRetry(() => import("./pages/EmailBuilder"));

const AppLoader = () => {
  return (
    <div className="flex justify-center items-center h-[100vh]">
      <Loader />
    </div>
  );
};
function App() {
  const [isloading, setIsLoading] = useState(true);
  useEffect(() => {
    // initialize creds
    const id = process.env.REACT_APP_APPID ?? "opensign";
    localStorage.setItem("parseAppId", id);
    // Only seed the root URL when nothing is stored yet. Logging in replaces
    // this with the company's own mount (.../app/<slug>/); overwriting it on
    // every mount sent each later request back to the root server, where the
    // company's session token does not exist - which surfaced as "Invalid
    // session token" and a "something went wrong" toast on actions like
    // deleting a document, but only after a refresh or navigation.
    // Logging out clears storage, so a stale value cannot outlive a session.
    if (!localStorage.getItem("baseUrl")) {
      localStorage.setItem("baseUrl", `${serverUrl_fn()}/`);
    }
    hideUpgradeProgress();
    localStorage.removeItem("showUpgradeProgress");
    setIsLoading(false);
  }, []);

  return (
    <div className="bg-base-200">
      {isloading ? (
        <AppLoader />
      ) : (
        <BrowserRouter>
          <Title />
          <Routes>
            <Route element={<ValidateRoute />}>
              <Route exact path="/" element={<Lazy Page={Login} />} />
                  <Route path="/login" element={<Lazy Page={Login} />} />
                  <Route path="/register" element={<Lazy Page={Register} />} />
                  <Route path="/waiting-approval" element={<Lazy Page={WaitingApproval} />} />
                  <Route path="/addadmin" element={<Lazy Page={AddAdmin} />} />
                  <Route
                    path="/upgrade-2.1"
                    element={<Lazy Page={UpdateExistUserAdmin} />}
                  />
            </Route>
            <Route element={<Validate />}>
              <Route
                exact
                path="/load/recipientSignPdf/:docId/:contactBookId"
                element={<DragProvider Page={PdfRequestFiles} lazy />}
              />
            </Route>
            <Route
              path="/login/:base64url"
              element={<Lazy Page={GuestLogin} />}
            />
            <Route path="/debugpdf" element={<Lazy Page={DebugPdf} />} />
              <Route
                path="/forgetpassword"
                element={<Lazy Page={ForgetPassword} />}
              />
            <Route element={<Lazy Page={HomeLayout} />}>
                  <Route path="/users" element={<Lazy Page={UserList} />} />
                  <Route
                    path="/changepassword"
                    element={<Lazy Page={ChangePassword} />}
                  />
              <Route path="/form/:id" element={<Lazy Page={Form} />} />
              <Route path="/report/:id" element={<Lazy Page={Report} />} />
              <Route path="/dashboard/:id" element={<Lazy Page={Dashboard} />} />
              <Route path="/profile" element={<Lazy Page={UserProfile} />} />
              <Route path="/drive" element={<Lazy Page={Opensigndrive} />} />
              <Route path="/managesign" element={<Lazy Page={ManageSign} />} />
              <Route
                path="/template/:templateId"
                element={<DragProvider Page={TemplatePlaceholder} lazy />}
              />
              {/* signyouself route with no rowlevel data using docId from url */}
              <Route
                path="/signaturePdf/:docId"
                element={<DragProvider Page={SignYourSelf} lazy />}
              />
              {/* draft document route to handle and navigate route page according to document status */}
              <Route
                path="/draftDocument"
                element={<DragProvider Page={DraftDocument} lazy />}
              />
              {/* recipient placeholder set route with no rowlevel data using docId from url*/}
              <Route
                path="/placeHolderSign/:docId"
                element={<DragProvider Page={PlaceHolderSign} lazy />}
              />
              {/* recipient signature route with no rowlevel data using docId from url */}
              <Route
                path="/recipientSignPdf/:docId/:contactBookId"
                element={<DragProvider Page={PdfRequestFiles} lazy />}
              />
              <Route
                path="/recipientSignPdf/:docId"
                element={<DragProvider Page={PdfRequestFiles} lazy />}
              />
              <Route
                path="/verify-document"
                element={<Lazy Page={VerifyDocument} />}
              />
              <Route
                path="/preferences"
                element={<Lazy Page={Preferences} />}
              />
            </Route>
            <Route path="/success" element={<Lazy Page={DocSuccessPage} />} />
            <Route path="/emailbuilder" element={<EmailBuilder />} />
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </BrowserRouter>
      )}
    </div>
  );
}

export default App;
