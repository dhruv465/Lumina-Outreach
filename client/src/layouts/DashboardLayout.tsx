import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

const DashboardLayout = () => {
  const { user, isLoading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-4 border-primary/30 border-t-primary animate-spin"></div>
          <p className="text-sm text-muted-foreground">Loading resources...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-background via-background to-muted/10">
      {/* Desktop Sidebar - hidden on mobile */}
      <div className={`hidden lg:flex flex-shrink-0 transition-all duration-300 ease-in-out ${collapsed ? 'lg:w-[70px]' : 'lg:w-64'}`}>
        <Sidebar collapsed={collapsed} />
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0">
          <Header toggleSidebar={() => setCollapsed(!collapsed)} sidebarCollapsed={collapsed} />
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-muted/30">
          <div className="container max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
            <div className="space-y-6">
              <TooltipProvider>
                <Outlet />
              </TooltipProvider>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
