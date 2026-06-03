/**
 * Jest Setup File
 * Configurações gerais para testes de performance
 */

// Aumentar timeout default para testes de carga
jest.setTimeout(180000); // 3 minutos

// Mock global vars
global.console = {
  ...console,
  // Supprimir alguns logs durante testes
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  // Manter warn e error
  warn: console.warn,
  error: console.error,
};

// Cleanup depois de cada test
afterEach(() => {
  jest.clearAllMocks();
});

// Log de start
console.log('🚀 Jest setup completo — Rodando testes de performance');
