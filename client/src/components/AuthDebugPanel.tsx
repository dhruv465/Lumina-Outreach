import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import authDebug from '@/utils/authDebug';
import { useAuth } from '@/hooks/useAuth';

// Function to format time
const formatTime = (timestamp: string | null) => {
  if (!timestamp) return 'N/A';
  try {
    return new Date(parseInt(timestamp)).toLocaleTimeString();
  } catch (e) {
    return 'Invalid';
  }
};

// Function to calculate time since login
const getTimeSinceLogin = (timestamp: string | null) => {
  if (!timestamp) return 'N/A';
  try {
    const loginTime = parseInt(timestamp);
    const now = Date.now();
    const diff = now - loginTime;
    
    if (diff < 1000) return `${diff}ms`;
    if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
    return `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`;
  } catch (e) {
    return 'Invalid';
  }
};

const AuthDebugPanel = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [authState, setAuthState] = useState({
    user: null as any,
    lastLoginTime: null as string | null,
    last401Time: null as string | null
  });
  
  const { user } = useAuth();
  
  // Update auth state when user changes
  useEffect(() => {
    const updateAuthState = () => {
      try {
        const storedUser = localStorage.getItem('user');
        const lastLoginTime = localStorage.getItem('lastLoginTime');
        const last401Time = localStorage.getItem('last401Time');
        
        setAuthState({
          user: storedUser ? JSON.parse(storedUser) : null,
          lastLoginTime,
          last401Time
        });
      } catch (e) {
        console.error('Error updating auth state:', e);
      }
    };
    
    // Update now
    updateAuthState();
    
    // Set interval to update every second
    const intervalId = setInterval(updateAuthState, 1000);
    
    return () => clearInterval(intervalId);
  }, [user]);
  
  // Toggle visibility by pressing Alt+D
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'd') {
        setIsVisible(prev => !prev);
        authDebug.state();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  if (!isVisible) return null;
  
  // Get token preview
  const tokenPreview = authState.user?.token ? 
    `${authState.user.token.substring(0, 10)}...` : 
    'N/A';
  
  return (
    <div className="fixed bottom-0 right-0 z-50 bg-slate-900 text-white p-4 w-80 text-xs font-mono rounded-tl-lg shadow-lg">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold">Auth Debug Panel</h3>
        <button onClick={() => setIsVisible(false)} className="text-slate-400 hover:text-white">
          <X size={16} />
        </button>
      </div>
      
      <div className="space-y-2">
        <div>
          <div className="text-slate-400">User</div>
          {authState.user ? (
            <div>
              <div>{authState.user.name || 'N/A'}</div>
              <div>{authState.user.email || 'N/A'}</div>
              <div>Role: {authState.user.role || 'N/A'}</div>
              <div>Token: {tokenPreview}</div>
            </div>
          ) : (
            <div className="text-red-400">Not logged in</div>
          )}
        </div>
        
        <div>
          <div className="text-slate-400">Login Time</div>
          <div>{formatTime(authState.lastLoginTime)}</div>
          <div>Time since login: {getTimeSinceLogin(authState.lastLoginTime)}</div>
        </div>
        
        <div>
          <div className="text-slate-400">Last 401 Error</div>
          <div>{formatTime(authState.last401Time)}</div>
        </div>
        
        <div>
          <div className="text-slate-400">Current Route</div>
          <div>{window.location.pathname}</div>
        </div>
        
        <div className="pt-2 flex gap-2">
          <button 
            onClick={() => authDebug.enable()}
            className="bg-blue-600 px-2 py-1 rounded text-xs"
          >
            Enable Logs
          </button>
          <button 
            onClick={() => authDebug.disable()}
            className="bg-slate-600 px-2 py-1 rounded text-xs"
          >
            Disable Logs
          </button>
          <button 
            onClick={() => authDebug.state()}
            className="bg-green-600 px-2 py-1 rounded text-xs"
          >
            Log State
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthDebugPanel;
