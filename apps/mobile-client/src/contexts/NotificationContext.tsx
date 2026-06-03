import { createContext, useContext, useState, useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';

export interface AppNotification {
  id: string;
  type: 'message' | 'status_update' | 'bid' | 'payment';
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

const CATEGORY_LABELS: Record<string, string> = {
  alvenaria: 'Alvenaria',
  hidraulica: 'Hidráulica',
  eletrica: 'Elétrica',
  pintura: 'Pintura',
  piso: 'Piso',
  acabamento: 'Acabamento',
  acessibilidade: 'Acessibilidade',
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

    const ts = Date.now();

    // ─ Mensagens do prestador
    const msgCh = supabase
      .channel(`client-notif-msg-${userId}-${ts}`)
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

    // ─ Atualizações de status do chamado do cliente
    const reqCh = supabase
      .channel(`client-notif-req-${userId}-${ts}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'service_requests',
        filter: `client_user_id=eq.${userId}`,
      }, (payload) => {
        const next = payload.new as any;
        const prev = (payload.old ?? {}) as any;

        const cat = CATEGORY_LABELS[next.category] ?? next.category ?? 'Serviço';
        const valor = `R$ ${Number(next.quote_amount ?? 0).toFixed(2).replace('.', ',')}`;

        // Notificações de status (só quando há mudança real)
        if (prev.status !== undefined && next.status !== prev.status) {
          push({
            type: 'status_update',
            title: STATUS_LABELS[next.status] ?? '📋 Pedido atualizado',
            body: cat,
            request_id: next.id,
          });
        }

        // Notificação de pagamento confirmado pelo prestador
        if (next.payment_status === 'confirmed' && prev.payment_status !== 'confirmed') {
          push({
            type: 'payment',
            title: '✅ Pagamento confirmado',
            body: `${cat} — ${valor}`,
            request_id: next.id,
          });
        }
      })
      .subscribe();

    // ─ Novos orçamentos recebidos
    const bidCh = supabase
      .channel(`client-notif-bids-${userId}-${ts}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bids' }, async (payload) => {
        const bid = payload.new as any;
        const { data: req } = await supabase
          .from('service_requests')
          .select('client_user_id')
          .eq('id', bid.request_id)
          .maybeSingle();
        if (!req || req.client_user_id !== userId) return;
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
