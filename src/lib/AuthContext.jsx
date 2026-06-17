import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import * as Sentry from '@sentry/react';

// Clear all BillTap-specific client state on logout
function clearBillTapStorage() {
  const keysToRemove = [
    'billtap-active-session',
    'billtap_participant_id',
    'billtap_participant_name',
    'billtap-session-cache',
    'billtap-last-session',
    'divvy_participant_id',   // legacy key
    'divvy_participant_name', // legacy key
  ];
  keysToRemove.forEach(k => localStorage.removeItem(k));

  // Clear any per-session guest keys
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('billtap-guest-name-') || k.startsWith('participant-') || k.startsWith('claimed-')) {
      localStorage.removeItem(k);
    }
  });

  sessionStorage.clear();

  // Clear Sentry identity
  Sentry.setUser(null);
  Sentry.setTag('split_mode', null);
}

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingAuth(true);
      setAuthError(null);
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      // Set Sentry user identity on login
      if (currentUser) {
        Sentry.setUser({ id: currentUser.id, email: currentUser.email });
      }
    } catch (error) {
      setIsAuthenticated(false);
      setUser(null);
      if (error?.status === 403 && error?.data?.extra_data?.reason) {
        const reason = error.data.extra_data.reason;
        if (reason === 'user_not_registered') {
          setAuthError({ type: 'user_not_registered', message: 'User not registered' });
        }
        // auth_required and other 403s: treat as unauthenticated (no forced redirect)
      }
      // If unauthenticated (401/403) or no token, just leave user as null — app is public
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const logout = () => {
    setUser(null);
    setIsAuthenticated(false);
    clearBillTapStorage();
    // base44.auth.logout() invalidates the JWT server-side and redirects
    base44.auth.logout('/');
  };

  const navigateToLogin = () => {
    base44.auth.redirectToLogin(window.location.href);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};