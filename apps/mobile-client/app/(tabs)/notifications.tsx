import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useNotifications, AppNotification } from '@/contexts/NotificationContext';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';

const TYPE_ICON: Record<AppNotification['type'], keyof typeof Ionicons.glyphMap> = {
  message: 'chatbubble-ellipses-outline',
  status_update: 'refresh-circle-outline',
  bid: 'cash-outline',
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  return `${Math.floor(hrs / 24)}d atrás`;
}

export default function NotificationsScreen() {
  const { notifications, unreadCount, markAllRead, markRead } = useNotifications();
  const { colors } = useTheme();

  function handleTap(item: AppNotification) {
    markRead(item.id);
    if (!item.request_id) return;
    if (item.type === 'message') {
      router.push(`/chat/${item.request_id}` as any);
    } else {
      router.push(`/tracking/${item.request_id}` as any);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.cardWhite, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Notificações</Text>
        {unreadCount > 0 && (
          <TouchableOpacity style={styles.markAllBtn} onPress={markAllRead}>
            <Text style={styles.markAllText}>Marcar todas como lidas</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={notifications}
        keyExtractor={item => item.id}
        contentContainerStyle={notifications.length === 0 && styles.emptyContainer}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.border }]} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="notifications-off-outline" size={56} color={colors.border} />
            <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>Nenhuma notificação</Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Você será avisado aqui sobre mensagens, atualizações de pedidos e orçamentos.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.item,
              { backgroundColor: colors.cardWhite },
              !item.read && { backgroundColor: colors.background },
            ]}
            onPress={() => handleTap(item)}
            activeOpacity={0.7}
          >
            <View style={[
              styles.iconWrap,
              { backgroundColor: colors.background },
              !item.read && { backgroundColor: '#FFE8DC' },
            ]}>
              <Ionicons name={TYPE_ICON[item.type]} size={22} color={item.read ? colors.textSecondary : Colors.primary} />
            </View>
            <View style={styles.textWrap}>
              <Text
                style={[styles.itemTitle, { color: colors.textSecondary }, !item.read && { color: colors.textPrimary, fontWeight: '700' }]}
                numberOfLines={1}
              >
                {item.title}
              </Text>
              <Text style={[styles.itemBody, { color: colors.textSecondary }]} numberOfLines={2}>{item.body}</Text>
              <Text style={[styles.itemTime, { color: colors.textSecondary }]}>{timeAgo(item.created_at)}</Text>
            </View>
            {!item.read && <View style={styles.dot} />}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: { fontSize: 22, fontWeight: '800' },
  markAllBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  markAllText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  emptyContainer: { flex: 1 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12, marginTop: 60 },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  separator: { height: 1, marginLeft: 72 },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textWrap: { flex: 1, gap: 3 },
  itemTitle: { fontSize: 14, fontWeight: '600' },
  itemBody: { fontSize: 13, lineHeight: 18 },
  itemTime: { fontSize: 11, marginTop: 2 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
    marginTop: 6,
  },
});
