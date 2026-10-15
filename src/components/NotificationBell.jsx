import { useState, useEffect, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { useOrganizationId } from '@/lib/AppStateContext';
import { useProfile } from '@/lib/ProfileContext';
import { filterByOrg } from '@/lib/orgScope';

export default function NotificationBell() {
  const orgId = useOrganizationId();
  const { activeProfileId } = useProfile();
  const [unreadCount, setUnreadCount] = useState(0);

  const loadUnread = useCallback(async () => {
    if (!orgId) return;
    try {
      const notifs = await filterByOrg(base44.entities.Notification, orgId, { leido: false });
      
      const key = `profile_notifs_${orgId}_${activeProfileId}`;
      const stored = localStorage.getItem(key);
      const profileIds = stored ? JSON.parse(stored) : null;

      const profileNotifs = notifs.filter(n => {
        // 1. Si tiene profile_id en BD, compararlo directamente
        if (n.profile_id) {
          return n.profile_id === activeProfileId;
        }
        // 2. Si es perfil 1 sin reclamos específicos, hereda lo no reclamado
        if (activeProfileId === '1' && profileIds === null) {
          const usedIds = [];
          for (let i = 2; i <= 5; i++) {
            const s = localStorage.getItem(`profile_notifs_${orgId}_${i}`);
            if (s) usedIds.push(...JSON.parse(s));
          }
          return !usedIds.includes(n.id);
        }
        // 3. Si hay lista en localStorage para este perfil
        if (profileIds !== null) {
          return profileIds.includes(n.id);
        }
        return false;
      });

      setUnreadCount(profileNotifs.length);
    } catch (e) {
      // keep last count on network/timeout errors
    }
  }, [orgId, activeProfileId]);

  useEffect(() => {
    loadUnread();
    const interval = setInterval(loadUnread, 30000);
    window.addEventListener('notifications-updated', loadUnread);
    return () => {
      clearInterval(interval);
      window.removeEventListener('notifications-updated', loadUnread);
    };
  }, [loadUnread]);

  return (
    <Link to="/notificaciones" className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
      <Bell className="w-5 h-5" />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary text-primary-foreground text-[9px] font-bold rounded-full flex items-center justify-center">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Link>
  );
}