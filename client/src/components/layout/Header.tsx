import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { useLocation } from "react-router-dom";
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
  Settings,
  ChevronRight,
  Bell,
  UserPlus,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import Sidebar from "./Sidebar";
import Logo from "@/components/Logo";
import { cn } from "@/lib/utils";

interface HeaderProps {
  toggleSidebar?: () => void;
  sidebarCollapsed?: boolean;
}

const Header = ({ toggleSidebar, sidebarCollapsed }: HeaderProps) => {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const location = useLocation();

  const getThemeIcon = () => {
    if (theme === "system") return <Monitor size={18} />;
    return theme === "dark" ? <Moon size={18} /> : <Sun size={18} />;
  };

  // Get page title from route
  const getPageTitle = () => {
    const path = location.pathname.split("/")[1];
    const titles: Record<string, string> = {
      dashboard: "Dashboard",
      leads: "Lead Management",
      campaigns: "Campaigns",
      calls: "Call History",
      configuration: "Configuration",
      knowledge: "Knowledge Base",
    };
    return titles[path] || "Dashboard";
  };

  // Get initials for avatar
  const getInitials = () => {
    if (!user?.name) return "U";
    return user.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header className="sticky top-0 z-10 border-b bg-background/50 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 shadow-sm">
      <div className="flex h-16 items-center justify-between gap-4 px-4 md:px-6">
        {/* Left side - Mobile menu, sidebar toggle, and breadcrumb */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile menu button */}
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden shrink-0"
              >
                <Menu size={20} />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="p-0 w-72 bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/80"
            >
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <SheetDescription className="sr-only">
                Application navigation links and options
              </SheetDescription>
              <Sidebar
                onNavigate={() => setIsOpen(false)}
                collapsed={false}
                isMobile={true}
              />
            </SheetContent>
          </Sheet>

          {/* Desktop sidebar toggle */}
          {toggleSidebar && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "hidden lg:flex shrink-0 transition-all duration-200",
                "hover:bg-accent/50 active:scale-95"
              )}
              onClick={toggleSidebar}
            >
              {sidebarCollapsed ? (
                <PanelLeft size={20} />
              ) : (
                <PanelLeftClose size={20} />
              )}
              <span className="sr-only">
                {sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              </span>
            </Button>
          )}

          {/* Breadcrumb / Page title */}
          <div className="hidden lg:flex items-center gap-2 text-sm min-w-0">
            <Logo width={20} height={20} className="shrink-0" />
            <ChevronRight
              size={14}
              className="text-muted-foreground shrink-0"
            />
            <span className="font-medium truncate">{getPageTitle()}</span>
          </div>

          {/* Mobile logo and title */}
          <div className="flex items-center gap-2 lg:hidden">
            <Logo width={24} height={24} />
            <h1 className="text-base font-semibold">Lumina</h1>
          </div>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {/* Notifications - Mobile Sheet */}
          <Sheet open={notificationsOpen} onOpenChange={setNotificationsOpen}>
            <SheetTrigger asChild className="sm:hidden">
              <Button variant="ghost" size="icon" className="relative h-9 w-9">
                <Bell size={18} />
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px]"
                >
                  3
                </Badge>
                <span className="sr-only">Notifications</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-md p-0">
              <SheetTitle className="sr-only">Notifications</SheetTitle>
              <SheetDescription className="sr-only">
                View your recent notifications
              </SheetDescription>
              
              <div className="flex flex-col h-full">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-4 border-b">
                  <h3 className="text-lg font-medium">Notifications</h3>
                  <Badge variant="secondary" className="text-xs">3 new</Badge>
                </div>

                {/* Notifications List */}
                <div className="flex-1 overflow-y-auto">
                  {/* Notification 1 */}
                  <div className="px-4 py-4 border-b hover:bg-accent/50 cursor-pointer transition-colors">
                    <div className="flex gap-3">
                      <div className="shrink-0">
                        <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                          <UserPlus size={18} className="text-blue-600 dark:text-blue-400" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm">New lead assigned</p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">2m</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          John Doe has been assigned to your campaign
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Notification 2 */}
                  <div className="px-4 py-4 border-b hover:bg-accent/50 cursor-pointer transition-colors">
                    <div className="flex gap-3">
                      <div className="shrink-0">
                        <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                          <CheckCircle2 size={18} className="text-green-600 dark:text-green-400" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm">Campaign completed</p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">1h</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Summer Sale campaign has finished successfully
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Notification 3 */}
                  <div className="px-4 py-4 border-b hover:bg-accent/50 cursor-pointer transition-colors">
                    <div className="flex gap-3">
                      <div className="shrink-0">
                        <div className="h-10 w-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                          <Sparkles size={18} className="text-purple-600 dark:text-purple-400" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm">System update</p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">3h</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          New features are now available in your dashboard
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t">
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={() => setNotificationsOpen(false)}
                  >
                    View All
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>

          {/* Notifications - Desktop Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild className="hidden sm:flex">
              <Button variant="ghost" size="icon" className="relative h-9 w-9">
                <Bell size={18} />
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px]"
                >
                  3
                </Badge>
                <span className="sr-only">Notifications</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent 
              align="end" 
              className="w-96"
              sideOffset={8}
            >
              <div className="flex items-center justify-between px-4 py-3">
                <h3 className="text-lg font-medium">Notifications</h3>
                <Badge variant="secondary" className="text-xs">3 new</Badge>
              </div>
              <DropdownMenuSeparator />
              
              <div className="max-h-[400px] overflow-y-auto">
                {/* Notification 1 */}
                <DropdownMenuItem className="cursor-pointer px-4 py-3 focus:bg-accent/50">
                  <div className="flex gap-3 w-full">
                    <div className="shrink-0">
                      <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                        <UserPlus size={16} className="text-blue-600 dark:text-blue-400" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-sm">New lead assigned</p>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">2m</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        John Doe has been assigned to your campaign
                      </p>
                    </div>
                  </div>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Notification 2 */}
                <DropdownMenuItem className="cursor-pointer px-4 py-3 focus:bg-accent/50">
                  <div className="flex gap-3 w-full">
                    <div className="shrink-0">
                      <div className="h-8 w-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                        <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-sm">Campaign completed</p>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">1h</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        Summer Sale campaign has finished successfully
                      </p>
                    </div>
                  </div>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Notification 3 */}
                <DropdownMenuItem className="cursor-pointer px-4 py-3 focus:bg-accent/50">
                  <div className="flex gap-3 w-full">
                    <div className="shrink-0">
                      <div className="h-8 w-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                        <Sparkles size={16} className="text-purple-600 dark:text-purple-400" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-sm">System update</p>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">3h</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        New features are now available in your dashboard
                      </p>
                    </div>
                  </div>
                </DropdownMenuItem>
              </div>

              <DropdownMenuSeparator />
              <div className="p-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  className="w-full"
                >
                  View All
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Theme toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9">
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
                className="h-9 gap-2 px-2 hover:bg-accent/50"
              >
                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground text-xs font-medium">
                  {getInitials()}
                </div>
                <span className="hidden md:inline text-sm font-medium max-w-[100px] truncate">
                  {user?.name?.split(" ")[0]}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <div className="flex items-center gap-3 px-3 py-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground text-sm font-medium">
                  {getInitials()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user?.email}
                  </p>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:text-destructive"
                onClick={logout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sign out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};

export default Header;
