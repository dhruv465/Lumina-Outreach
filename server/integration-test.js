/**
 * Simple integration test to verify core services can be initialized
 */

async function testServiceIntegration() {
  console.log('🧪 Testing Service Integration...\n');
  
  try {
    // Test 1: Import core utilities
    console.log('1️⃣ Testing Core Utilities Import...');
    
    const { ConnectionHealthMonitor } = require('./dist/utils/ConnectionHealthMonitor.js');
    const { ConnectionCircuitBreaker } = require('./dist/utils/ConnectionCircuitBreaker.js');
    const { RealTimeHealthAssessment } = require('./dist/utils/RealTimeHealthAssessment.js');
    console.log('✅ Core utilities imported successfully');
    
    // Test 2: Create instances
    console.log('\n2️⃣ Testing Instance Creation...');
    
    const healthMonitor = new ConnectionHealthMonitor('test-connection');
    const circuitBreaker = new ConnectionCircuitBreaker('test-circuit');
    const healthAssessment = new RealTimeHealthAssessment(
      healthMonitor,
      circuitBreaker,
      'test-connection'
    );
    
    console.log('✅ Service instances created successfully');
    
    // Test 3: Basic functionality
    console.log('\n3️⃣ Testing Basic Functionality...');
    
    // Test health assessment
    const healthReport = healthAssessment.getHealthAssessmentReport();
    console.log('✅ Health assessment report generated:', !!healthReport);
    
    // Test circuit breaker
    const metrics = circuitBreaker.getMetrics();
    console.log('✅ Circuit breaker metrics retrieved:', !!metrics);
    
    // Test connection health
    const connectionHealth = healthMonitor.assessConnectionHealth();
    console.log('✅ Connection health assessment completed:', !!connectionHealth);
    
    console.log('\n🎉 Integration test completed successfully!');
    console.log('Core services are properly integrated and functional.');
    
    return true;
  } catch (error) {
    console.error('❌ Integration test failed:', error.message);
    console.error('Stack:', error.stack);
    return false;
  }
}

if (require.main === module) {
  testServiceIntegration()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Integration test crashed:', error);
      process.exit(1);
    });
}

module.exports = { testServiceIntegration };