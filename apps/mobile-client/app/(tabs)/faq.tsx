import { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';

const WHATSAPP_NUMBER = '5511999999999';
const SUPPORT_EMAIL = 'suporte@construconnect.app';

const FAQ_ITEMS = [
  {
    q: 'Como faço um pedido de serviço?',
    a: 'Na tela "Solicitar", selecione a categoria do serviço, preencha a descrição e o endereço e toque em "Solicitar". Os prestadores disponíveis serão notificados.',
  },
  {
    q: 'Como escolho um prestador?',
    a: 'Na aba "Profissionais", você pode pesquisar por nome ou especialidade e filtrar por avaliação, preço e disponibilidade. Para contratar diretamente, acesse o perfil do prestador e toque em "Contratar".',
  },
  {
    q: 'Como funciona o orçamento?',
    a: 'Os prestadores enviam propostas com valor e observações. Você pode aceitar, rejeitar ou fazer uma contraproposta. Ao aceitar, o prestador é notificado e o serviço é agendado.',
  },
  {
    q: 'O pagamento é feito pelo app?',
    a: 'Sim! Após a conclusão do serviço você pode pagar via Pix diretamente no app. Você também pode combinar o pagamento diretamente com o prestador.',
  },
  {
    q: 'Como avalio o prestador?',
    a: 'Após o serviço ser marcado como concluído, um botão de avaliação (1 a 5 estrelas) aparece na tela do pedido. Avalie para ajudar outros clientes e manter a qualidade da plataforma.',
  },
  {
    q: 'Posso cancelar um pedido?',
    a: 'Sim. Enquanto o pedido estiver com status "Solicitado", você pode cancelá-lo diretamente na tela de acompanhamento. Depois de aceito, entre em contato com o prestador pelo chat.',
  },
  {
    q: 'Como funciona o rastreamento do prestador?',
    a: 'Após o pedido ser aceito, você pode acompanhar a localização do prestador em tempo real na tela de rastreamento. Uma notificação é enviada quando ele está a menos de 500 metros.',
  },
  {
    q: 'E se tiver algum problema com o serviço?',
    a: 'Na tela de detalhes do pedido concluído, toque em "Registrar reclamação" para abrir uma ocorrência formal que nossa equipe analisará.',
  },
];

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TouchableOpacity
      style={styles.faqItem}
      onPress={() => setOpen((v) => !v)}
      activeOpacity={0.7}
    >
      <View style={styles.faqHeader}>
        <Text style={styles.faqQuestion}>{question}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textSecondary} />
      </View>
      {open && <Text style={styles.faqAnswer}>{answer}</Text>}
    </TouchableOpacity>
  );
}

export default function FAQScreen() {
  function openWhatsApp() {
    const url = Platform.OS === 'ios'
      ? `https://wa.me/${WHATSAPP_NUMBER}`
      : `whatsapp://send?phone=${WHATSAPP_NUMBER}`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://wa.me/${WHATSAPP_NUMBER}`)
    );
  }

  function openEmail() {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Suporte%20ConstruConnect`);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Ionicons name="help-circle-outline" size={28} color={Colors.primary} />
        <Text style={styles.headerTitle}>FAQ e Suporte</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Perguntas frequentes</Text>

        <View style={styles.faqList}>
          {FAQ_ITEMS.map((item, i) => (
            <FAQItem key={i} question={item.q} answer={item.a} />
          ))}
        </View>

        <Text style={styles.sectionTitle}>Falar com o suporte</Text>

        <TouchableOpacity style={styles.contactBtn} onPress={openWhatsApp}>
          <View style={[styles.contactIcon, { backgroundColor: '#25D366' }]}>
            <Ionicons name="logo-whatsapp" size={22} color="#fff" />
          </View>
          <View style={styles.contactInfo}>
            <Text style={styles.contactTitle}>WhatsApp</Text>
            <Text style={styles.contactDesc}>Resposta em até 30 minutos</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.contactBtn} onPress={openEmail}>
          <View style={[styles.contactIcon, { backgroundColor: Colors.primary }]}>
            <Ionicons name="mail-outline" size={22} color="#fff" />
          </View>
          <View style={styles.contactInfo}>
            <Text style={styles.contactTitle}>E-mail</Text>
            <Text style={styles.contactDesc}>{SUPPORT_EMAIL}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.versionBox}>
          <Text style={styles.versionText}>ConstruConnect v1.0 — Cliente</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.cardWhite,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8, marginBottom: 4,
  },
  faqList: {
    backgroundColor: Colors.cardWhite, borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
    overflow: 'hidden',
  },
  faqItem: {
    padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  faqHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  faqQuestion: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary, flex: 1, lineHeight: 20 },
  faqAnswer: { fontSize: 13, color: Colors.textSecondary, marginTop: 10, lineHeight: 20 },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.cardWhite, borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  contactIcon: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  contactInfo: { flex: 1 },
  contactTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  contactDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  versionBox: { alignItems: 'center', marginTop: 16 },
  versionText: { fontSize: 12, color: Colors.textSecondary },
});
