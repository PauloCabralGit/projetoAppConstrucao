import { createContext, useContext, useState, useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';

export interface AppNotification {
  id: string;
  type: 'message' | 'new_job' | 'bid_accepted' | 'status_update' | 'payment';
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

    // ─ Mensagens do cliente
    const msgCh = supabase
      .channel(`provider-notif-msg-${userId}-${ts}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const msg = payload.new as any;
        if (msg.sender_id === userId) return;
        if (msg.sender_role !== 'client') return;
        const { data: req } = await supabase
          .from('service_requests')
          .select('provider_user_id')
          .eq('id', msg.request_id)
          .maybeSingle();
        if (!req || req.provider_user_id !== userId) return;
        push({
          type: 'message',
          title: '💬 Nova mensagem do cliente',
          body: msg.content.length > 80 ? msg.content.slice(0, 80) + '...' : msg.content,
          request_id: msg.request_id,
        });
      })
      .subscribe();

    // ─ Novos chamados disponíveis
    const jobCh = supabase
      .channel(`provider-notif-jobs-${userId}-${ts}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'service_requests',
      }, (payload) => {
        const req = payload.new as any;
        if (req.status !== 'requested') return;
        push({
          type: 'new_job',
          title: '🔔 Novo chamado disponível',
          body: CATEGORY_LABELS[req.category] ?? req.category ?? 'Novo serviço na sua área',
          request_id: req.id,
        });
      })
      .subscribe();

    // ─ Atualizações do chamado (status + pagamento)
    const srCh = supabase
      .channel(`provider-notif-sr-${userId}-${ts}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'service_requests',
        filter: `provider_user_id=eq.${userId}`,
      }, (payload) => {
        const next = payload.new as any;
        const prev = payload.old as any;
        const cat = CATEGORY_LABELS[next.category] ?? next.category ?? 'Serviço';

        // Notificações de status
        if (next.status !== prev.status) {
          const statusMap: Record<string, { title: string; emoji: string }> = {
            accepted: { emoji: '✅', title: 'Pedido aceito pelo cliente' },
            in_transit: { emoji: '🚗', title: 'Pronto para sair?' },
            in_progress: { emoji: '🔧', title: 'Serviço em progresso' },
            completed: { emoji: '🎉', title: 'Serviço finalizado' },
            cancelled: { emoji: '❌', title: 'Pedido cancelado' },
          };
          const info = statusMap[next.status];
          if (info) {
            push({
              type: 'status_update',
              title: `${info.emoji} ${info.title}`,
              body: cat,
              request_id: next.id,
            });
          }
        }

        // Notificação de pagamento confirmado
        if (next.payment_status === 'confirmed' && prev.payment_status !== 'confirmed') {
          push({
            type: 'payment',
            title: '💳 Pagamento recebido!',
            body: `R$ ${Number(next.quote_amount ?? 0).toFixed(2)} — ${cat}`,
            request_id: next.id,
          });
        }
      })
      .subscribe();

    // ─ Lance aceito pelo cliente
    const bidCh = supabase
      .channel(`provider-notif-bids-${userId}-${ts}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'bids',
        filter: `provider_user_id=eq.${userId}`,
      }, (payload) => {
        const bid = payload.new as any;
        const old = payload.old as any;
        if (bid.status !== 'accepted' || old.status === 'accepted') return;
        push({
          type: 'bid_accepted',
          title: '🎉 Seu orçamento foi aceito!',
          body: `R$ ${Number(bid.amount).toFixed(2)} — o cliente confirmou sua proposta`,
          request_id: bid.request_id,
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(msgCh);
      supabase.removeChannel(jobCh);
      supabase.removeChannel(srCh);
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
