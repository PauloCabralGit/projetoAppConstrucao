import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';

// Tela da rota "/" — apenas um loading enquanto o RootLayout decide o destino
// (onboarding / login / tabs) e faz o router.replace.
//
// Ter um index.tsx é essencial: sem ele, o expo-router renderiza o Sitemap
// automático em "/", e o Sitemap acessa `window.location.origin` — que é
// undefined no React Native (Hermes), quebrando no iOS com
// "Cannot read property 'origin' of undefined".
export default function Index() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});
