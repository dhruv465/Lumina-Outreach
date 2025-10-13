import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Menu,
  Moon,
  Sun,
  Monitor,
  User,
  PanelLeftClose,
  PanelLeft,
  LogOut,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import Sidebar from "./Sidebar";
import Logo from "@/components/Logo";

interface HeaderProps {
  toggleSidebar?: () => void;
  sidebarCollapsed?: boolean;
}

const Header = ({ toggleSidebar, sidebarCollapsed }: HeaderProps) => {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const getThemeIcon = () => {
    if (theme === "system") return <Monitor size={18} />;
    return theme === "dark" ? <Moon size={18} /> : <Sun size={18} />;
  };

  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-4 md:px-6">
        {/* Left side - Mobile menu and title */}
        <div className="flex items-center gap-2">
          {/* Mobile menu button */}
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0">
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <SheetDescription className="sr-only">
                Application navigation links and options
              </SheetDescription>
              <Sidebar onNavigate={() => setIsOpen(false)} collapsed={false} />
            </SheetContent>
          </Sheet>

          {/* Desktop sidebar toggle */}
          {toggleSidebar && (
            <Button
              variant="ghost"
              size="icon"
              className={`hidden lg:flex transition-all duration-300 ease-in-out ${
                sidebarCollapsed ? "cursor-e-resize" : "cursor-w-resize"
              } hover:bg-muted/60 rounded-md`}
              onClick={toggleSidebar}
            >
              {sidebarCollapsed ? (
                <PanelLeft size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
              <span className="sr-only">
                {sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              </span>
            </Button>
          )}

          {/* Page title - can be dynamically set based on current route */}
          <div className="flex items-center gap-2 lg:hidden">
            <Logo width={24} height={24} />
            <h1 className="text-lg font-semibold">Lumina Outreach</h1>
          </div>
        </div>

        {/* Right side actions - moved to absolute right */}
        <div className="flex items-center gap-1 ml-auto">
          {/* Theme toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-md">
                {getThemeIcon()}
                <span className="sr-only">Toggle theme</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setTheme("light")}
                className="cursor-pointer"
              >
                <Sun className="mr-2 h-4 w-4" />
                <span>Light</span>
                {theme === "light" && <Check className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTheme("dark")}
                className="cursor-pointer"
              >
                <Moon className="mr-2 h-4 w-4" />
                <span>Dark</span>
                {theme === "dark" && <Check className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTheme("system")}
                className="cursor-pointer"
              >
                <Monitor className="mr-2 h-4 w-4" />
                <span>System</span>
                {theme === "system" && <Check className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-md gap-2 pl-2 pr-3 ml-1"
              >
                <User size={16} />
                <span className="hidden md:inline text-sm font-normal truncate max-w-[100px]">
                  {user?.name?.split(" ")[0]}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <div className="px-4 py-3 border-b">
                <p className="text-sm font-medium mb-0.5">{user?.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.email}
                </p>
              </div>
              <div className="py-1.5">
                <DropdownMenuItem className="cursor-pointer">
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile Settings</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onClick={logout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};

export default Header;
