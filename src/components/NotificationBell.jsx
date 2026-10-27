import { useState, useEffect, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { useOrganizationId } from '@/lib/AppStateContext';
import { useProfile } from '@/lib/ProfileContext';
import { listByOrg } from '@/lib/orgScope';
import { getOperationalAlerts } from '@/lib/operationalAlerts';

export default function NotificationBell() {
  const orgId = useOrganizationId();
  const { activeProfileId } = useProfile();
  const [unreadCount, setUnreadCount] = useState(0);

  const loadUnread = useCallback(async () => {
    if (!orgId) return;
    try {
      const [rawNotifs, rawTrucks, rawDrivers, rawBrokers, rawLoads] = await Promise.all([
        listByOrg(base44.entities.Notification, orgId, '-created_date', 100),
        listByOrg(base44.entities.Truck, orgId),
        listByOrg(base44.entities.Driver, orgId),
        listByOrg(base44.entities.Broker, orgId),
        listByOrg(base44.entities.Load, orgId, '-created_date', 50),
      ]);

      const filterByProfile = (data, entity) => {
        const key = `profile_${entity}_${orgId}_${activeProfileId}`;
        const stored = localStorage.getItem(key);
        const profileIds = stored ? JSON.parse(stored) : null;
        return data.filter(item => {
          if (item.profile_id) return item.profile_id === activeProfileId;
          if (activeProfileId === '1' && profileIds === null) {
            const usedIds = [];
            for (let i = 2; i <= 5; i++) {
              const s = localStorage.getItem(`profile_${entity}_${orgId}_${i}`);
              if (s) usedIds.push(...JSON.parse(s));
            }
            return !usedIds.includes(item.id);
          }
          if (profileIds !== null) return profileIds.includes(item.id);
          return false;
        });
      };

      const trucks = filterByProfile(rawTrucks, 'trucks');
      const drivers = filterByProfile(rawDrivers, 'drivers');
      const brokers = filterByProfile(rawBrokers, 'brokers');
      const loads = filterByProfile(rawLoads, 'loads');

      const keyNotifs = `profile_notifs_${orgId}_${activeProfileId}`;
      const storedNotifs = localStorage.getItem(keyNotifs);
      const profileNotifIds = storedNotifs ? JSON.parse(storedNotifs) : null;

      let profileNotifs;
      if (activeProfileId === '1' && profileNotifIds === null) {
        const usedIds = [];
        for (let i = 2; i <= 5; i++) {
          const s = localStorage.getItem(`profile_notifs_${orgId}_${i}`);
          if (s) usedIds.push(...JSON.parse(s));
        }
        profileNotifs = rawNotifs.filter(n => (!n.profile_id || n.profile_id === '1') && !usedIds.includes(n.id));
      } else {
        profileNotifs = rawNotifs.filter(n => {
          if (n.profile_id) return n.profile_id === activeProfileId;
          return profileNotifIds && profileNotifIds.includes(n.id);
        });
      }

      const alerts = getOperationalAlerts({
        trucks,
        drivers,
        brokers,
        loads,
        notifications: profileNotifs,
      });

      // Contar solo las notificaciones y alertas operacionales no leídas
      const readKey = `read_alerts_${orgId}_${activeProfileId || '1'}`;
      const readIds = new Set(JSON.parse(localStorage.getItem(readKey) || '[]'));
      const unreadAlerts = alerts.filter(a => {
        const cleanId = a.id.startsWith('sys-notif-') ? a.id.replace('sys-notif-', '') : a.id;
        const isRead = !!a.leido || readIds.has(a.id) || readIds.has(cleanId) || readIds.has(`sys-notif-${cleanId}`);
        return !isRead;
      });

      setUnreadCount(unreadAlerts.length);
    } catch (e) {
      // mantener último conteo en caso de error de red
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
    <Link
      to="/notificaciones"
      className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title="Notificaciones"
    >
      <Bell className="w-5 h-5" />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-primary text-primary-foreground text-[9px] font-bold rounded-full flex items-center justify-center">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}