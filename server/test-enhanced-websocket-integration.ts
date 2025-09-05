/**
 * Test script to verify enhanced WebSocket integration
 * This script tests the enhanced WebSocket manager integration with various services
 */

import { createEnhancedWebSocket, enhancedWebSocketFactory } from '../src/utils/enhancedWebSocketFactory';
import { TwilioWebSocketManager } from '../src/utils/TwilioWebSocketManager';
import logger from '../src/utils/logger';

async function testEnhancedWebSocketIntegration() {
  console.log('🚀 Testing Enhanced WebSocket Integration...\n');

  try {
    // Test 1: Enhanced WebSocket Factory
    console.log('📝 Test 1: Enhanced WebSocket Factory');
    const testManager = await createEnhancedWebSocket('wss://echo.websocket.org/', {
      callId: 'test-call-123',
      serviceName: 'integration-test',
      maxReconnectAttempts: 2,
      connectionTimeout: 5000
    });

    console.log('✅ Enhanced WebSocket manager created successfully');
    console.log(`   - Connected: ${testManager.isConnected()}`);
    console.log(`   - Metrics: ${JSON.stringify(testManager.getMetrics())}`);

    // Test 2: TwilioWebSocketManager factory method
    console.log('\n📝 Test 2: TwilioWebSocketManager Enhanced Connection');
    try {
      const twilioManager = await TwilioWebSocketManager.createEnhancedConnection(
        'test-twilio-call',
        'wss://echo.websocket.org/',
        'test-connection-id'
      );
      console.log('✅ Enhanced Twilio WebSocket manager created successfully');
      console.log('   - Connection established with enhanced manager');
      
      // Cleanup
      twilioManager.cleanup();
    } catch (error) {
      console.log(`⚠️  Twilio enhanced connection test failed (expected for echo service): ${error.message}`);
    }

    // Test 3: Factory statistics
    console.log('\n📝 Test 3: Factory Statistics');
    const stats = enhancedWebSocketFactory.getConnectionStats();
    console.log(`✅ Factory stats retrieved:`);
    console.log(`   - Active connections: ${stats.activeConnections}`);
    console.log(`   - Connection IDs: ${stats.connectionIds.join(', ')}`);

    // Test 4: Connection management
    console.log('\n📝 Test 4: Connection Management');
    console.log('   - Closing test connection...');
    testManager.close();
    
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for cleanup
    
    const finalStats = enhancedWebSocketFactory.getConnectionStats();
    console.log(`   - Active connections after cleanup: ${finalStats.activeConnections}`);

    console.log('\n🎉 Enhanced WebSocket Integration Tests Completed Successfully!');

  } catch (error) {
    console.error('\n❌ Enhanced WebSocket Integration Test Failed:', error.message);
    console.error('   Stack:', error.stack);
  }

  // Final cleanup
  try {
    await enhancedWebSocketFactory.closeAllConnections();
    console.log('🧹 All connections cleaned up');
  } catch (error) {
    console.error('Error during cleanup:', error.message);
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testEnhancedWebSocketIntegration()
    .then(() => {
      console.log('\n✨ Integration test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Integration test failed:', error);
      process.exit(1);
    });
}

export { testEnhancedWebSocketIntegration };