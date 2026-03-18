import { useNavigate, useLocation } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

const ROOT_PATHS = ["/", "/Home", "/Dashboard", "/NewReceipt"];

export default function AppHeader({ title, rightAction, forceBack, backTo }) {
  const navigate = useNavigate();
  const location = useLocation();

  const isRoot = ROOT_PATHS.includes(location.pathname) && !forceBack;
  const showBack = !isRoot || forceBack;

  const handleBack = () => {
    if (backTo) {
      navigate(backTo);
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/Dashboard");
    }
  };

  if (!title && !showBack && !rightAction) return null;

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-gray-100 flex items-center h-14 px-2">
      {/* Back button — always 44px tap target */}
      <div className="w-11 flex items-center justify-center">
        {showBack && (
          <button
            onClick={handleBack}
            className="w-11 h-11 flex items-center justify-center rounded-xl text-gray-600 active:bg-gray-100 transition-colors"
            aria-label="Go back"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* Title */}
      <div className="flex-1 text-center">
        {title && <span className="font-bold text-gray-900 text-base">{title}</span>}
      </div>

      {/* Right action slot — 44px min */}
      <div className="w-11 flex items-center justify-center">
        {rightAction && (
          <div className="min-w-[44px] min-h-[44px] flex items-center justify-center">
            {rightAction}
          </div>
        )}
      </div>
    </header>
  );
}