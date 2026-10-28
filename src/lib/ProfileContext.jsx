import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { base44 } from '@/api/base44Client';
import { useAppState } from '@/lib/AppStateContext';
import { withOrg } from '@/lib/orgScope';
import { useDemo } from '@/lib/DemoContext';
import { useLanguage } from '@/lib/LanguageContext';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';

const ProfileContext = createContext(null);

export const MAX_PROFILES = 10;

export function ProfileProvider({ children }) {
  const { user } = useAuth();
  const { organization } = useAppState();
  const { isDemoUser, isPlan99, limits } = useDemo();
  const { t } = useLanguage();
  
  const maxProfilesAllowed = limits?.PROFILES ?? (isPlan99 ? 10 : (isDemoUser ? 3 : 5));
  
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [unsavedBlockers, setUnsavedBlockers] = useState({}); // { [componentId]: boolean }
  const [loading, setLoading] = useState(true);


  // Unsaved changes confirmation state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingProfileId, setPendingProfileId] = useState(null);

  // Load from backend on mount or when user changes
  useEffect(() => {
    if (!user?.email) {
      setLoading(false);
      return;
    }
    
    // 1. Carga INMEDIATA desde localStorage para no bloquear la UI
    const key = `profiles_${user.email}`;
    const stored = localStorage.getItem(key);
    
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        let loadedProfiles = parsed.profiles;
        if (!loadedProfiles || loadedProfiles.length === 0) {
          loadedProfiles = [{ id: '1', name: 'Perfil 1' }];
        }
        setProfiles(loadedProfiles);
        setActiveProfileId(parsed.activeProfileId || '1');
      } catch (e) {
        setProfiles([{ id: '1', name: 'Perfil 1' }]);
        setActiveProfileId('1');
      }
    } else {
      setProfiles([{ id: '1', name: 'Perfil 1' }]);
      setActiveProfileId('1');
    }

    // 2. Sincronizar con backend de forma no bloqueante (solo si hay organization)
    if (!organization?.id) {
      setLoading(false);
      return; 
    }

    const syncWithBackend = async () => {
      try {
        const dbProfiles = await base44.entities.Profile.filter({ usuario: user.email });
        
        if (dbProfiles.length > 0) {
          // Map DB records to state format
          const mapped = dbProfiles.map(p => ({
            id: p.profile_key,
            name: p.name,
            dbId: p.id // store backend ID for updates
          }));
          setProfiles(mapped);
          
          // Make sure activeProfileId is valid
          setProfiles(prev => {
            if (!prev.find(p => p.id === activeProfileId)) {
               setActiveProfileId(prev[0].id);
            }
            return prev;
          });
        } else {
          // No profiles in backend, create default
          const defaultProfile = {
            name: 'Perfil 1',
            usuario: user.email,
            profile_key: '1',
            is_default: true,
            color: 'blue'
          };
          const created = await base44.entities.Profile.create(withOrg(organization.id, defaultProfile));
          setProfiles([{ id: '1', name: 'Perfil 1', dbId: created.id }]);
        }
      } catch (err) {
        console.error('Error syncing profiles with backend:', err);
      } finally {
        setLoading(false);
      }
    };
    
    syncWithBackend();
  }, [user?.email, organization?.id]);

  // Persist to localStorage whenever they change
  useEffect(() => {
    if (!user?.email || profiles.length === 0) return;
    const key = `profiles_${user.email}`;
    localStorage.setItem(key, JSON.stringify({ profiles, activeProfileId }));
  }, [profiles, activeProfileId, user]);

  const addProfile = async (name) => {
    if (profiles.length >= maxProfilesAllowed) return false;
    const trimmed = (name || '').trim();
    if (!trimmed) return false;
    if (profiles.some(p => p.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      return false;
    }
    const newId = Date.now().toString();
    const newProfile = { id: newId, name: trimmed };
    
    // Optimistic update
    setProfiles(prev => [...prev, newProfile]);
    setActiveProfileId(newId);

    // Save to backend
    try {
      const created = await base44.entities.Profile.create(withOrg(organization.id, {
        name: trimmed,
        usuario: user.email,
        profile_key: newId,
        is_default: false,
        color: 'blue'
      }));
      
      // Update with DB ID
      setProfiles(prev => prev.map(p => p.id === newId ? { ...p, dbId: created.id } : p));
      return true;
    } catch (err) {
      console.error('Error creating profile in backend', err);
      return true;
    }
  };

  const renameProfile = async (id, newName) => {
    const trimmed = (newName || '').trim();
    if (!trimmed) return false;
    if (profiles.some(p => p.id !== id && p.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      return false;
    }
    setProfiles(prev => prev.map(p => p.id === id ? { ...p, name: trimmed } : p));
    
    const profileToUpdate = profiles.find(p => p.id === id);
    if (profileToUpdate?.dbId) {
      try {
        await base44.entities.Profile.update(profileToUpdate.dbId, { name: trimmed });
      } catch (err) {
        console.error('Error renaming profile in backend', err);
      }
    }
    return true;
  };

  const deleteProfile = async (id) => {
    if (profiles.length <= 1) return; // Cannot delete last profile
    
    const profileToDelete = profiles.find(p => p.id === id);
    
    setProfiles(prev => {
      const updated = prev.filter(p => p.id !== id);
      if (activeProfileId === id) {
        setActiveProfileId(updated[0].id);
      }
      return updated;
    });

    if (profileToDelete?.dbId) {
      try {
        await base44.entities.Profile.delete(profileToDelete.dbId);
      } catch (err) {
        console.error('Error deleting profile from backend', err);
      }
    }
  };

  const switchProfile = (id) => {
    const hasUnsaved = Object.values(unsavedBlockers).some(isBlocked => isBlocked);
    if (hasUnsaved) {
      setPendingProfileId(id);
      setConfirmOpen(true);
      return false; // Indicamos que NO se cambió sincrónicamente
    }
    setActiveProfileId(id);
    return true;
  };

  const handleConfirmSwitch = () => {
    if (pendingProfileId) {
      setActiveProfileId(pendingProfileId);
    }
    setConfirmOpen(false);
    setPendingProfileId(null);
  };

  const setUnsavedChanges = (componentId, isUnsaved) => {
    setUnsavedBlockers(prev => {
      if (prev[componentId] === isUnsaved) return prev;
      return { ...prev, [componentId]: isUnsaved };
    });
  };

  const value = {
    profiles,
    activeProfileId,
    activeProfile: profiles.find(p => p.id === activeProfileId) || profiles[0],
    addProfile,
    renameProfile,
    deleteProfile,
    switchProfile,
    setUnsavedChanges,
    maxProfilesAllowed,
    loading
  };

  return (
    <ProfileContext.Provider value={value}>
      {children}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t?.profiles?.unsavedTitle || 'Cambios sin guardar'}</AlertDialogTitle>
            <AlertDialogDescription>
              {t?.profiles?.unsavedDesc || 'Tienes cambios sin guardar en esta página. Si cambias de perfil, se perderán. ¿Quieres continuar y descartarlos?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOpen(false)}>{t?.profiles?.cancel || 'Cancelar'}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSwitch} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t?.profiles?.discard || 'Descartar Cambios'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
}
