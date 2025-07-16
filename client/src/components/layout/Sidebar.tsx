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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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

  return (
    <Link to={href} className="block" onClick={handleClick}>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "w-full justify-start gap-3 transition-all duration-300 ease-in-out h-9 my-1 rounded-md",
          isActive
            ? "bg-muted/70 font-medium"
            : "font-normal hover:bg-muted/40",
          collapsed ? "justify-center px-2" : ""
        )}
        title={collapsed ? title : undefined}
      >
        <span
          className={cn(
            "transition-transform duration-300 ease-in-out",
            collapsed ? "transform scale-110" : "",
            isActive ? "text-primary/80" : "text-muted-foreground"
          )}
        >
          {icon}
        </span>
        <span
          className={cn(
            "transition-all duration-300 ease-in-out whitespace-nowrap text-sm",
            collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100 w-auto",
            isActive ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {title}
        </span>
      </Button>
    </Link>
  );
};

interface SidebarProps {
  onNavigate?: () => void;
  collapsed?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ onNavigate, collapsed = false }) => {
  const { logout } = useAuth();

  return (
    <div
      className={cn(
        "flex flex-col border-r bg-card/60 h-full transition-all duration-300 ease-in-out",
        collapsed ? "w-[70px]" : "w-64"
      )}
    >
      {/* Logo and title */}
      <div className="h-16 flex items-center px-4">
        <div className="flex items-center gap-3 overflow-hidden">
          <Logo
            width={collapsed ? 30 : 28}
            height={collapsed ? 30 : 28}
            className="transition-all duration-300"
          />
          <h1
            className={`font-medium tracking-tight whitespace-nowrap transition-all duration-300 origin-left ${
              collapsed
                ? "opacity-0 scale-90 w-0"
                : "opacity-100 w-auto text-base"
            }`}
          >
            Lumina <span className="text-primary/80">Outreach</span>
          </h1>
        </div>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="space-y-0.5">
          <SidebarItem
            href="/dashboard"
            icon={<LayoutDashboard size={19} />}
            title="Dashboard"
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
          <SidebarItem
            href="/leads"
            icon={<Users size={19} />}
            title="Lead Management"
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
          <SidebarItem
            href="/campaigns"
            icon={<Megaphone size={19} />}
            title="Campaigns"
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
          <SidebarItem
            href="/calls"
            icon={<PhoneCall size={19} />}
            title="Call History"
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
          <SidebarItem
            href="/analytics"
            icon={<BarChart3 size={19} />}
            title="Analytics"
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
          <SidebarItem
            href="/configuration"
            icon={<Settings size={19} />}
            title="Configuration"
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
          <SidebarItem
            href="/knowledge"
            icon={<BookOpen size={19} />}
            title="Knowledge Base"
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
        </nav>
      </ScrollArea>

      {/* Logout */}
      <div className="p-3">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "w-full gap-3 text-muted-foreground transition-all duration-300 ease-in-out h-9 rounded-md hover:bg-muted/50 hover:text-foreground",
            collapsed ? "justify-center px-2" : "justify-start"
          )}
          onClick={logout}
          title={collapsed ? "Sign Out" : undefined}
        >
          <span
            className={cn(
              "transition-transform duration-300 ease-in-out",
              collapsed ? "transform scale-110" : ""
            )}
          >
            <LogOut size={19} />
          </span>
          <span
            className={cn(
              "transition-all duration-300 ease-in-out whitespace-nowrap text-sm",
              collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100 w-auto"
            )}
          >
            Sign Out
          </span>
        </Button>
      </div>
    </div>
  );
};

export default Sidebar;
