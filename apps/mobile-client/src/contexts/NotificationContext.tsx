import { createContext, useContext, useState, useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';

export interface AppNotification {
  id: string;
  type: 'message' | 'status_update' | 'bid';
  title: string;
  body: string;
  created_at: string;
  read: boolean;
  request_id?: string;
}

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  markAllRead: () => void;
  markRead: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  markAllRead: () => {},
  markRead: () => {},
});

export function useNotifications() {
  return useContext(NotificationContext);
}

const STATUS_LABELS: Record<string, string> = {
  accepted: '✅ Pedido aceito por um prestador',
  in_transit: '🚗 Prestador a caminho',
  in_progress: '🔧 Serviço iniciado',
  completed: '🎉 Serviço concluído',
  cancelled: '❌ Pedido cancelado',
};

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [userId, setUserId] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? '');
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return;

    function push(n: Omit<AppNotification, 'id' | 'created_at' | 'read'>) {
      setNotifications(prev => [
        { ...n, id: uid(), created_at: new Date().toISOString(), read: false },
        ...prev,
      ]);
    }

    const msgCh = supabase
      .channel(`client-notif-msg-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as any;
        if (msg.sender_id === userId) return;
        if (msg.sender_role !== 'provider') return;
        push({
          type: 'message',
          title: '💬 Nova mensagem do prestador',
          body: msg.content.length > 80 ? msg.content.slice(0, 80) + '...' : msg.content,
          request_id: msg.request_id,
        });
      })
      .subscribe();

    const reqCh = supabase
      .channel(`client-notif-req-${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'service_requests',
        filter: `client_id=eq.${userId}`,
      }, (payload) => {
        const next = payload.new as any;
        const prev = payload.old as any;
        if (next.status === prev.status) return;
        push({
          type: 'status_update',
          title: STATUS_LABELS[next.status] ?? '📋 Pedido atualizado',
          body: next.service_type ?? 'Atualização de status',
          request_id: next.id,
        });
      })
      .subscribe();

    const bidCh = supabase
      .channel(`client-notif-bids-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bids' }, (payload) => {
        const bid = payload.new as any;
        push({
          type: 'bid',
          title: '💰 Novo orçamento recebido',
          body: `R$ ${Number(bid.amount).toFixed(2)} — toque para ver`,
          request_id: bid.request_id,
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(msgCh);
      supabase.removeChannel(reqCh);
      supabase.removeChannel(bidCh);
    };
  }, [userId]);

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    Notifications.setBadgeCountAsync(unreadCount).catch(() => {});
  }, [unreadCount]);

  function markAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  function markRead(id: string) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAllRead, markRead }}>
      {children}
    </NotificationContext.Provider>
  );
}
