import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  PhoneCall,
  Settings,
  Megaphone,
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
}

const SidebarItem: React.FC<SidebarItemProps> = ({
  href,
  icon,
  title,
  onNavigate,
  collapsed,
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

interface SidebarProps {
  onNavigate?: () => void;
  collapsed?: boolean;
  isMobile?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ onNavigate, collapsed = false, isMobile = false }) => {
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
        </nav>
      </ScrollArea>
    </div>
  );
};

export default Sidebar;
