/**
 * Auth Debug Utility
 * 
 * This utility adds enhanced logging for authentication-related operations
 * to help diagnose login/logout issues.
 */

// Enable debug mode in development environment
const isDebug = import.meta.env.DEV || localStorage.getItem('debugAuth') === 'true';

// Main debug logger
export const authDebug = {
  log: (...args: any[]) => {
    if (isDebug) {
      console.log('%c[Auth]', 'color: #2563eb; font-weight: bold;', ...args);
    }
  },
  
  warn: (...args: any[]) => {
    if (isDebug) {
      console.warn('%c[Auth]', 'color: #d97706; font-weight: bold;', ...args);
    }
  },
  
  error: (...args: any[]) => {
    // Always log errors
    console.error('%c[Auth]', 'color: #dc2626; font-weight: bold;', ...args);
  },
  
  // Log authentication state
  state: () => {
    if (isDebug) {
      try {
        const user = localStorage.getItem('user');
        const lastLoginTime = localStorage.getItem('lastLoginTime');
        const last401Time = localStorage.getItem('last401Time');
        
        const userObj = user ? JSON.parse(user) : null;
        const tokenPreview = userObj?.token ? 
          `${userObj.token.substring(0, 15)}...` : 
          'none';
        
        console.group('%c[Auth State]', 'color: #059669; font-weight: bold;');
        console.log('User:', userObj ? 
          { 
            id: userObj._id, 
            email: userObj.email, 
            role: userObj.role, 
            tokenPreview
          } : 'null');
        console.log('Last Login:', lastLoginTime ? 
          new Date(parseInt(lastLoginTime)).toLocaleString() : 
          'none');
        console.log('Last 401:', last401Time ? 
          new Date(parseInt(last401Time)).toLocaleString() : 
          'none');
        console.log('Location:', window.location.pathname);
        console.log('API Headers:', 
          'Check in Network tab');
        console.groupEnd();
      } catch (error) {
        console.error('Error logging auth state:', error);
      }
    }
  },
  
  // Enable debug mode
  enable: () => {
    localStorage.setItem('debugAuth', 'true');
    console.log('%c[Auth Debug Enabled]', 'color: #2563eb; font-weight: bold;');
  },
  
  // Disable debug mode
  disable: () => {
    localStorage.removeItem('debugAuth');
    console.log('%c[Auth Debug Disabled]', 'color: #2563eb; font-weight: bold;');
  }
};

// Set window.debugAuth for console access
if (typeof window !== 'undefined') {
  (window as any).debugAuth = authDebug;
}

export default authDebug;
