import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

interface Message {
  id: string;
  sender_id: string;
  sender_role: 'client' | 'provider';
  content: string;
  created_at: string;
  _pending?: boolean;
}

export default function ProviderChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const userIdRef = useRef<string>('');
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) userIdRef.current = user.id;
    });
    fetchMessages();

    const channel = supabase
      .channel(`chat-provider-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `request_id=eq.${id}` },
        (payload) => {
          const incoming = payload.new as Message;
          setMessages((prev) => {
            const withoutPending = prev.filter(
              (m) => !(m._pending && m.sender_id === incoming.sender_id && m.content === incoming.content)
            );
            if (withoutPending.find((m) => m.id === incoming.id)) return withoutPending;
            return [...withoutPending, incoming];
          });
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id]);

  async function fetchMessages() {
    setFetchError(false);
    try {
      const res = await fetch(`${API_BASE}/service-requests/${id}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages ?? []);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
      } else {
        setFetchError(true);
      }
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending || !userIdRef.current) return;

    const tempMsg: Message = {
      id: `temp-${Date.now()}`,
      sender_id: userIdRef.current,
      sender_role: 'provider',
      content: text,
      created_at: new Date().toISOString(),
      _pending: true,
    };
    setMessages((prev) => [...prev, tempMsg]);
    setInput('');
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);

    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/service-requests/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender_id: userIdRef.current, sender_role: 'provider', content: text }),
      });
      if (!res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id));
        setInput(text);
        Alert.alert('Erro', 'Não foi possível enviar a mensagem. Tente novamente.');
      } else {
        const dataRes = await res.json().catch(() => null);
        if (dataRes?.message) {
          setMessages((prev) => {
            const confirmed = dataRes.message as Message;
            const without = prev.filter((m) => m.id !== tempMsg.id && m.id !== confirmed.id);
            return [...without, confirmed];
          });
        }
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id));
      setInput(text);
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
    }
    setSending(false);
  }

  const renderItem = useCallback(({ item }: { item: Message }) => {
    const isMe = item.sender_id === userIdRef.current;
    return (
      <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, item._pending && { opacity: 0.6 }]}>
        {!isMe && <Text style={styles.bubbleSender}>Cliente</Text>}
        <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.content}</Text>
        <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
          {item._pending ? 'enviando...' : new Date(item.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Ionicons name="chatbubbles-outline" size={20} color={Colors.primary} />
          <Text style={styles.headerTitle}>Chat com cliente</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : fetchError ? (
        <View style={styles.errorWrap}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.dangerRed} />
          <Text style={styles.errorTitle}>Chat indisponível</Text>
          <Text style={styles.errorText}>Não foi possível carregar as mensagens agora. Verifique sua conexão e tente novamente.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchMessages}>
            <Text style={styles.retryBtnText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="chatbubble-ellipses-outline" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>Nenhuma mensagem ainda.{'\n'}Inicie a conversa!</Text>
            </View>
          }
        />
      )}

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Digite uma mensagem..."
          placeholderTextColor={Colors.textSecondary}
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!input.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator color={Colors.cardWhite} size="small" />
          ) : (
            <Ionicons name="send" size={18} color={Colors.cardWhite} />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingBottom: 12,
    backgroundColor: Colors.cardWhite, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center',
  },
  headerInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  errorText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  retryBtn: {
    marginTop: 8, paddingHorizontal: 24, paddingVertical: 10,
    backgroundColor: Colors.primary, borderRadius: 10,
  },
  retryBtnText: { fontSize: 14, fontWeight: '700', color: Colors.cardWhite },
  listContent: { padding: 16, gap: 8, flexGrow: 1 },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingTop: 60 },
  emptyText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  bubble: {
    maxWidth: '80%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, gap: 2,
  },
  bubbleMe: { alignSelf: 'flex-end', backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleThem: {
    alignSelf: 'flex-start', backgroundColor: Colors.cardWhite, borderBottomLeftRadius: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  bubbleSender: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary, marginBottom: 2 },
  bubbleText: { fontSize: 14, color: Colors.textPrimary, lineHeight: 20 },
  bubbleTextMe: { color: Colors.cardWhite },
  bubbleTime: { fontSize: 10, color: Colors.textSecondary, alignSelf: 'flex-end' },
  bubbleTimeMe: { color: 'rgba(255,255,255,0.7)' },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    padding: 12, paddingBottom: Platform.OS === 'ios' ? 32 : 12,
    backgroundColor: Colors.cardWhite, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  input: {
    flex: 1, minHeight: 44, maxHeight: 120,
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 14, color: Colors.textPrimary, backgroundColor: Colors.background,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
});
