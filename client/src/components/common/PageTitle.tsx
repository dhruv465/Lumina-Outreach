import { useLocation } from 'react-router-dom';

export function PageTitle() {
  const location = useLocation();
  const pathname = location.pathname;

  // Map routes to readable titles
  const getTitleFromPath = (path: string): string => {
    const routes: Record<string, string> = {
      '/dashboard': 'Dashboard',
      '/leads': 'Lead Management',
      '/campaigns': 'Campaigns',
      '/calls': 'Call History',
      '/analytics': 'Analytics',
      '/configuration': 'Configuration',
    };
    
    return routes[path] || 'Page';
  };

  const pageTitle = getTitleFromPath(pathname);

  return (
    <div className="mb-8">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">{pageTitle}</h1>
    </div>
  );
}
