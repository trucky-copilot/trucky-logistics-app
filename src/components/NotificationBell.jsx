import { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { useOrganizationId } from '@/lib/AppStateContext';
import { filterByOrg } from '@/lib/orgScope';

export default function NotificationBell() {
  const orgId = useOrganizationId();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const loadUnread = async () => {
      try {
        const notifs = await filterByOrg(base44.entities.Notification, orgId, { leido: false });
        setUnreadCount(notifs.length);
      } catch (e) {
        // keep last count on network/timeout errors
      }
    };
    loadUnread();
    const interval = setInterval(loadUnread, 30000);
    return () => clearInterval(interval);
  }, [orgId]);

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