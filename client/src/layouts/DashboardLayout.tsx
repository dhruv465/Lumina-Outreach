import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { StatusBar } from '@/components/common/StatusBar';
import { useState } from 'react';

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
    <div className="flex h-screen overflow-hidden bg-background">
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
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-full mx-auto">
            <div className="space-y-6">
              <Outlet />
            </div>
          </div>
        </main>
        
        {/* Status bar */}
        <div className="flex-shrink-0">
          <StatusBar />
        </div>
      </div>
    </div>
  );
};

export default DashboardLayout;
