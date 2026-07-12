import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  LayoutDashboard,
  Users,
  PhoneCall,
  Settings,
  Megaphone,
  BarChart3,
  LogOut,
  BookOpen,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Logo from "@/components/Logo";

interface SidebarItemProps {
  href: string;
  icon: React.ReactNode;
  title: string;
  onNavigate?: () => void;
  collapsed?: boolean;
  badge?: string | number;
}

const SidebarItem: React.FC<SidebarItemProps> = ({
  href,
  icon,
  title,
  onNavigate,
  collapsed,
  badge,
}) => {
  const { pathname } = useLocation();
  const isActive = pathname === href;

  const handleClick = () => {
    onNavigate?.();
  };

  const buttonContent = (
    <Link to={href} className="block" onClick={handleClick}>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "w-full justify-start gap-3 transition-all duration-200 h-10 rounded-lg group relative",
          isActive
            ? "bg-primary/10 text-primary font-medium hover:bg-primary/15 shadow-sm"
            : "font-normal hover:bg-accent/50 text-muted-foreground hover:text-foreground",
          collapsed ? "justify-center px-2" : "px-3"
        )}
      >
        {/* Active indicator */}
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
        )}
        
        <span
          className={cn(
            "transition-all duration-200 shrink-0",
            isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
          )}
        >
          {icon}
        </span>
        
        <span
          className={cn(
            "transition-all duration-200 whitespace-nowrap text-sm flex-1 text-left",
            collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
          )}
        >
          {title}
        </span>

        {badge && !collapsed && (
          <span className="ml-auto px-2 py-0.5 text-xs font-medium bg-primary/20 text-primary rounded-full">
            {badge}
          </span>
        )}

        {!collapsed && (
          <ChevronRight
            size={14}
            className={cn(
              "ml-auto opacity-0 group-hover:opacity-100 transition-opacity",
              isActive && "opacity-100"
            )}
          />
        )}
      </Button>
    </Link>
  );

  if (collapsed) {
    return (
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {title}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return buttonContent;
};

interface SidebarSectionProps {
  title: string;
  collapsed?: boolean;
}

const SidebarSection: React.FC<SidebarSectionProps> = ({ title, collapsed }) => {
  if (collapsed) return null;
  
  return (
    <div className="px-3 py-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {title}
      </h3>
    </div>
  );
};

interface SidebarProps {
  onNavigate?: () => void;
  collapsed?: boolean;
  isMobile?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ onNavigate, collapsed = false, isMobile = false }) => {
  const { logout } = useAuth();

  return (
    <div
      className={cn(
        "flex flex-col h-full transition-all duration-300 ease-in-out",
        isMobile ? "bg-transparent" : "bg-card/50 backdrop-blur-sm border-r",
        collapsed ? "w-[70px]" : "w-64"
      )}
    >
      {/* Logo and title */}
      <div className="h-16 flex items-center px-4">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className={cn(
            "shrink-0 transition-all duration-300",
            collapsed ? "scale-110" : "scale-100"
          )}>
            <Logo
              width={28}
              height={28}
            />
          </div>
          <div
            className={cn(
              "transition-all duration-300 origin-left overflow-hidden",
              collapsed ? "opacity-0 w-0" : "opacity-100 w-auto"
            )}
          >
            <h1 className="font-semibold tracking-tight whitespace-nowrap text-base">
              Lumina <span className="text-primary">Outreach</span>
            </h1>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-4">
        <nav className="space-y-1 px-2">
          {/* Main Section */}
          <SidebarSection title="Main" collapsed={collapsed} />
          <SidebarItem
            href="/dashboard"
            icon={<LayoutDashboard size={20} />}
            title="Dashboard"
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
          <SidebarItem
            href="/leads"
            icon={<Users size={20} />}
            title="Lead Management"
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
          <SidebarItem
            href="/campaigns"
            icon={<Megaphone size={20} />}
            title="Campaigns"
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
          <SidebarItem
            href="/calls"
            icon={<PhoneCall size={20} />}
            title="Call History"
            onNavigate={onNavigate}
            collapsed={collapsed}
          />

          {/* Analytics Section */}
          <div className="pt-4">
            <SidebarSection title="Insights" collapsed={collapsed} />
            <SidebarItem
              href="/analytics"
              icon={<BarChart3 size={20} />}
              title="Analytics"
              onNavigate={onNavigate}
              collapsed={collapsed}
            />
          </div>

          {/* Settings Section */}
          <div className="pt-4">
            <SidebarSection title="Resources" collapsed={collapsed} />
            <SidebarItem
              href="/knowledge"
              icon={<BookOpen size={20} />}
              title="Knowledge Base"
              onNavigate={onNavigate}
              collapsed={collapsed}
            />
            <SidebarItem
              href="/configuration"
              icon={<Settings size={20} />}
              title="Configuration"
              onNavigate={onNavigate}
              collapsed={collapsed}
            />
          </div>
        </nav>
      </ScrollArea>

      {/* Logout */}
      <div className="p-3">
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "w-full gap-3 text-muted-foreground transition-all duration-200 h-10 rounded-lg hover:bg-destructive/10 hover:text-destructive",
                  collapsed ? "justify-center px-2" : "justify-start px-3"
                )}
                onClick={logout}
              >
                <LogOut size={20} className="shrink-0" />
                <span
                  className={cn(
                    "transition-all duration-200 whitespace-nowrap text-sm",
                    collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
                  )}
                >
                  Sign Out
                </span>
              </Button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right" className="font-medium">
                Sign Out
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
};

export default Sidebar;
