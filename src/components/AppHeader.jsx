import { memo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useTabNav } from "@/lib/TabNavigationContext";

const ROOT_PATHS = ["/", "/home", "/Home", "/dashboard", "/Dashboard", "/new-receipt", "/NewReceipt", "/profile", "/Profile"];

const AppHeader = memo(/** @param {{ title?: any, rightAction?: any, forceBack?: any, backTo?: any, [key: string]: any }} props */
function AppHeader({ title, rightAction, forceBack, backTo }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { popScreen, canGoBack } = useTabNav();

  const isRoot = ROOT_PATHS.includes(location.pathname) && !forceBack;
  const showBack = !isRoot || forceBack || canGoBack;

  const handleBack = () => {
    if (backTo) {
      navigate(backTo);
    } else {
      const popped = popScreen();
      if (!popped) navigate("/dashboard");
    }
  };

  if (!title && !showBack && !rightAction) return null;

  return (
    <header className="sticky top-0 z-30 bg-surface-raised border-b border-border flex items-center h-14 px-2">
      <div className="w-11 flex items-center justify-center">
        {showBack && (
          <button
            onClick={handleBack}
            className="w-11 h-11 flex items-center justify-center rounded-xl text-muted-foreground active:bg-accent transition-colors"
            aria-label="Go back"
          >
            <ChevronLeft className="w-6 h-6" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="flex-1 text-center">
        {title && <span className="font-bold text-foreground text-base">{title}</span>}
      </div>
      <div className="w-11 flex items-center justify-center">
        {rightAction && (
          <div className="min-w-[44px] min-h-[44px] flex items-center justify-center">
            {rightAction}
          </div>
        )}
      </div>
    </header>
  );
});

export default AppHeader;